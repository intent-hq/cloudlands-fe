import type { Task } from 'redux-saga';
import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  cancel,
  cancelled,
  delay,
  flush,
  fork,
  put,
  race,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';

import { sendMessage as sendAgentMessage } from '$features/agent/agent-send';
import { buildRecordedAttempt } from '$features/agent/utils/build-recorded-attempt';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import {
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
  agentSessionStopChatRequested,
} from '../../agent-session/agent-session-slice';
import {
  selectAgentIsResponding,
  selectAgentSession,
} from '../../agent-session/agent-session-selectors';
import {
  removeQueuedMessageFromAgentQueue,
  removeQueuedMessageRequested,
  replaceAgentQueue,
} from '../../agent-queue/agent-queue-slice';
import { selectAgentQueueMessages } from '../../agent-queue/agent-queue-selectors';
import { CHIEF_WORKSPACE_ID } from '../../sidebar-nav/sidebar-nav-types';
import {
  getChiefThreadTitle,
  isPlaceholderChiefThreadName,
} from '../../sidebar-nav/chief-thread-title';
import { clearChatDraft } from '../../transient-ui/transient-ui-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { requestUnarchiveWorkspace } from '../../workspace-operations/workspace-operations-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  chatErrorCleared,
  chatLastAttemptedMessageSet,
  chatModelUnavailableCleared,
  chatQueueProcessingReceived,
  chatQueuedRetryRecordSet,
  chatSendFailed,
  chatSendStarted,
  chatStopCompleted,
  chatStopInitiated,
  refreshChatTranscriptRequested,
  sendMessage,
  transcriptHydrationSettled,
} from '../chat-state-slice';
import { selectChatLastAttemptedMessage, selectTranscriptHydration } from '../chat-state-selectors';
import type { SendMessagePayload } from '../chat-state-types';

const logger = createLogger('ChatSendSaga');
const CANCELLED_ERROR = 'Chat send operation cancelled';

type SendAction = ReturnType<typeof sendMessage>;
type RemoveAction = ReturnType<typeof removeQueuedMessageRequested>;
type StopAction = ReturnType<typeof agentSessionStopChatRequested>;
type RetryAction = ReturnType<typeof agentSessionRetryLastMessageRequested>;
type RetryModelAction = ReturnType<typeof agentSessionRetryWithModelRequested>;
type ChatWork = SendAction | RemoveAction | StopAction | RetryAction | RetryModelAction;

const CHAT_WORK_TYPES = new Set([
  sendMessage.type,
  removeQueuedMessageRequested.type,
  agentSessionStopChatRequested.type,
  agentSessionRetryLastMessageRequested.type,
  agentSessionRetryWithModelRequested.type,
]);

type LifecycleSendOptions = {
  imageBlocks?: SendMessagePayload['imageBlocks'];
  noteIds?: string[];
  messageMetadata?: SendMessagePayload['messageMetadata'];
  model?: string;
  priority?: 'interrupt';
};

function getAgentId(action: ChatWork): string {
  return action.type === sendMessage.type
    ? (action as SendAction).payload.agentId
    : (action as RemoveAction).payload[0];
}

function isChatWork(action: unknown): action is ChatWork {
  return (
    !!action &&
    typeof action === 'object' &&
    'type' in action &&
    typeof action.type === 'string' &&
    CHAT_WORK_TYPES.has(action.type)
  );
}

function* waitForTranscriptRefresh(agentId: string, wsId: string): SagaGenerator<void> {
  while (true) {
    const { settled, unmounted, deleted } = yield* race({
      settled: take(transcriptHydrationSettled),
      unmounted: take(workspaceUnmounted),
      deleted: take(workspaceDeleted),
    });
    if (unmounted?.payload[0] === wsId || deleted?.payload[0] === wsId) return;
    if (!settled || settled.payload[0] !== agentId) continue;
    yield* delay(0);
    const status = yield* selectTranscriptHydration.effect(agentId);
    if (status !== 'loading') return;
  }
}

function* hydrateBeforeSend(agentId: string, wsId: string): SagaGenerator<void> {
  const session = yield* selectAgentSession.effect(agentId);
  if (session && session.messages.length > 0) return;
  yield* put(refreshChatTranscriptRequested(wsId, agentId));
  yield* call(waitForTranscriptRefresh, agentId, wsId);
}

function* renameChiefThreadIfPlaceholder(
  agentId: string,
  fallbackText?: string,
): SagaGenerator<void> {
  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  if (!session || !isPlaceholderChiefThreadName(session.name)) return;
  const hasUserMessage = session.messages.some((message) => message.role === 'user');
  const name = hasUserMessage ? getChiefThreadTitle(session) : (fallbackText?.trim() ?? '');
  if (isPlaceholderChiefThreadName(name)) return;
  try {
    const result = yield* call(
      [appClient.agents, appClient.agents.rename],
      agentId,
      name,
      undefined,
      { skipIfExplicitlySet: true },
    );
    if (!result.success)
      logger.warn('Chief thread rename was not applied', { agentId, error: result.error });
  } catch (error) {
    logger.warn('Chief thread rename failed', { agentId, error });
  }
}

function* sendQueuedNow(agentId: string, wsId: string, messageId: string): SagaGenerator<void> {
  try {
    const result = yield* call([appClient.agents, appClient.agents.sendQueuedNow], {
      agentId,
      workspaceId: wsId,
      messageId,
    });
    if (!result.success) {
      yield* put(chatLastAttemptedMessageSet(agentId, null));
      yield* put(chatSendFailed(agentId, result.error ?? m.agent_chatSend_sendNowRejected_error()));
    } else if (typeof result.turnId === 'string') {
      yield* put(chatQueueProcessingReceived(agentId, result.turnId));
    }
  } catch (error) {
    yield* put(chatLastAttemptedMessageSet(agentId, null));
    yield* put(chatSendFailed(agentId, error instanceof Error ? error.message : String(error)));
  }
}

async function suggestUnarchiveIfArchived(workspace: Workspace): Promise<void> {
  if (!workspace.archived && workspace.status !== WorkspaceStatusEnum.Archived) return;
  try {
    const { toast } = await import('svelte-sonner');
    toast.info(m.agent_chatSend_archivedWorkspace_toast(), {
      id: `chat-send-unarchive-${workspace.id}`,
      action: {
        label: m.agent_chatSend_archivedWorkspace_unarchive_label(),
        onClick: () => {
          void (async () => {
            try {
              const { store } = await import('../../../store');
              store.dispatch(requestUnarchiveWorkspace(workspace.id));
            } catch (error) {
              logger.error('Unarchive from chat-send suggestion toast failed', {
                workspaceId: workspace.id,
                error,
              });
            }
          })();
        },
      },
    });
  } catch (error) {
    logger.warn('Failed to surface archived-workspace suggestion toast', {
      workspaceId: workspace.id,
      error,
    });
  }
}

function* dispatchToLifecycle(
  agentId: string,
  wsId: string,
  text: string,
  workspaceContextStr: string | undefined,
  options: LifecycleSendOptions,
  skipQueueCheck: boolean,
): SagaGenerator<void> {
  const workspace = yield* selectWorkspaceById.effect(wsId);
  if (!workspace) {
    yield* put(chatSendFailed(agentId, m.agent_chatSend_workspaceNotFound_error({ id: wsId })));
    return;
  }
  yield* fork(suggestUnarchiveIfArchived, workspace);
  const content = workspaceContextStr ? `${workspaceContextStr}\n\n${text.trim()}` : text.trim();

  yield* call(hydrateBeforeSend, agentId, wsId);
  const recordedAttempt = buildRecordedAttempt(content, options);
  const isResponding = yield* selectAgentIsResponding.effect(agentId);
  if (!skipQueueCheck && isResponding) {
    yield* put(clearChatDraft(wsId, agentId));
    try {
      const result = options.imageBlocks
        ? yield* call([appClient.agents, appClient.agents.queue], agentId, content, {
            imageBlocks: options.imageBlocks,
          })
        : yield* call([appClient.agents, appClient.agents.queue], agentId, content);
      if (!result.success) {
        yield* put(chatLastAttemptedMessageSet(agentId, recordedAttempt));
        yield* put(chatSendFailed(agentId, result.error ?? m.agent_chatSend_queueRejected_error()));
        return;
      }
      yield* put(chatErrorCleared(agentId));
      yield* put(chatModelUnavailableCleared(agentId));
      const queuedMessage = result.queuedMessage;
      if (queuedMessage) {
        const turnId = result.turnId ?? queuedMessage.turnId;
        if (typeof turnId === 'string') {
          yield* put(chatQueuedRetryRecordSet(agentId, queuedMessage.id, recordedAttempt, turnId));
        }
        const existing = yield* selectAgentQueueMessages.effect(agentId);
        if (!existing.some((message) => message.id === queuedMessage.id)) {
          yield* put(replaceAgentQueue(agentId, [...existing, queuedMessage]));
        }
      }
      if (wsId === CHIEF_WORKSPACE_ID) {
        yield* call(renameChiefThreadIfPlaceholder, agentId, content);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield* put(chatLastAttemptedMessageSet(agentId, recordedAttempt));
      yield* put(chatSendFailed(agentId, m.agent_chatSend_queueFailed_error({ error: message })));
    }
    return;
  }

  yield* put(chatSendStarted(agentId, wsId));
  yield* put(chatLastAttemptedMessageSet(agentId, recordedAttempt));
  yield* put(clearChatDraft(wsId, agentId));
  try {
    yield* call(sendAgentMessage, agentId, content, workspace, options);
    if (wsId === CHIEF_WORKSPACE_ID) yield* call(renameChiefThreadIfPlaceholder, agentId);
  } catch (error) {
    yield* put(chatSendFailed(agentId, error instanceof Error ? error.message : String(error)));
  }
}

function* handleSend(action: SendAction): SagaGenerator<void> {
  const { agentId, payload } = action.payload;
  if (!agentId || !payload.wsId) return;
  if (payload.queuedMessageId) {
    yield* call(sendQueuedNow, agentId, payload.wsId, payload.queuedMessageId);
    return;
  }
  if (!payload.text) return;
  const forceSubmit = payload.forceSubmit === true;
  yield* dispatchToLifecycle(
    agentId,
    payload.wsId,
    payload.text,
    payload.workspaceContextStr,
    {
      imageBlocks: payload.imageBlocks,
      noteIds: payload.noteIds,
      messageMetadata: payload.messageMetadata,
      priority: forceSubmit ? 'interrupt' : undefined,
    },
    forceSubmit,
  );
}

function* handleRemove(action: RemoveAction): SagaGenerator<void> {
  const [agentId, messageId] = action.payload;
  if (!agentId || !messageId) return;
  yield* put(removeQueuedMessageFromAgentQueue(agentId, messageId));
  try {
    const result = yield* call(
      [appClient.agents, appClient.agents.removeQueued],
      agentId,
      messageId,
    );
    if (!result.success)
      logger.warn('Queue removal failed; keeping optimistic removal', {
        agentId,
        messageId,
        error: result.error,
      });
  } catch (error) {
    logger.error('Queue removal threw; keeping optimistic removal', { agentId, messageId, error });
  }
}

function* handleStop(action: StopAction): SagaGenerator<void> {
  const [agentId] = action.payload;
  let settled = false;
  try {
    const session = yield* selectAgentSession.effect(agentId);
    if (!session) {
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }
    yield* put(chatStopInitiated(agentId));
    try {
      const result = yield* call([appClient.agents, appClient.agents.stop], agentId);
      if (!result.success)
        logger.warn('Agent stop was not acknowledged', { agentId, error: result.error });
      yield* put(chatStopCompleted(agentId));
      yield* put(action.success(undefined as void));
      settled = true;
    } catch (error) {
      yield* put(chatStopCompleted(agentId));
      yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
      settled = true;
    }
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(chatStopCompleted(agentId));
      yield* put(action.failure(new Error(CANCELLED_ERROR)));
    }
  }
}

async function showNothingToRetry(): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.info(m.agent_chatSend_nothingToRetry_toast());
  } catch (error) {
    logger.error('Failed to surface retry no-op feedback', error);
  }
}

function* handleRetry(action: RetryAction | RetryModelAction): SagaGenerator<void> {
  const [agentId, wsId] = action.payload;
  const model =
    action.type === agentSessionRetryWithModelRequested.type
      ? (action as RetryModelAction).payload[2]
      : undefined;
  let settled = false;
  try {
    const lastAttempted = yield* selectChatLastAttemptedMessage.effect(agentId);
    if (!lastAttempted?.text.trim()) {
      yield* call(showNothingToRetry);
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }
    yield* call(
      dispatchToLifecycle,
      agentId,
      wsId,
      lastAttempted.text,
      undefined,
      {
        imageBlocks: lastAttempted.options?.imageBlocks,
        noteIds: lastAttempted.options?.noteIds,
        messageMetadata: lastAttempted.options?.messageMetadata,
        model: model ?? lastAttempted.options?.model,
      },
      false,
    );
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(CANCELLED_ERROR)));
    }
  }
}

function* handleWork(action: ChatWork): SagaGenerator<void> {
  if (action.type === sendMessage.type) return yield* call(handleSend, action as SendAction);
  if (action.type === removeQueuedMessageRequested.type)
    return yield* call(handleRemove, action as RemoveAction);
  if (action.type === agentSessionStopChatRequested.type)
    return yield* call(handleStop, action as StopAction);
  return yield* call(handleRetry, action as RetryAction | RetryModelAction);
}

function settlePendingCancellation(
  action: ChatWork,
): ReturnType<StopAction['failure']> | ReturnType<RetryAction['failure']> | undefined {
  if (action.type === agentSessionStopChatRequested.type) {
    return (action as StopAction).failure(new Error(CANCELLED_ERROR));
  }
  if (
    action.type === agentSessionRetryLastMessageRequested.type ||
    action.type === agentSessionRetryWithModelRequested.type
  ) {
    return (action as RetryAction).failure(new Error(CANCELLED_ERROR));
  }
  return undefined;
}

function* runAgentQueue(
  agentId: string,
  queues: Map<string, ChatWork[]>,
  workers: Map<string, Task | symbol>,
): SagaGenerator<void> {
  try {
    const queue = queues.get(agentId);
    while (queue && queue.length > 0) {
      const action = queue.shift();
      if (action) yield* call(handleWork, action);
    }
  } finally {
    workers.delete(agentId);
    if (!(yield* cancelled())) queues.delete(agentId);
  }
}

export function* chatSendSaga(): SagaGenerator<void> {
  const channel = yield* actionChannel(isChatWork, buffers.expanding<ChatWork>());
  const queues = new Map<string, ChatWork[]>();
  const workers = new Map<string, Task | symbol>();
  try {
    while (true) {
      const action: ChatWork = yield* take(channel);
      const agentId = getAgentId(action);
      if (!agentId) continue;
      const queue = queues.get(agentId) ?? [];
      if (!queues.has(agentId)) queues.set(agentId, queue);
      queue.push(action);
      if (!workers.has(agentId)) {
        const starting = Symbol(agentId);
        workers.set(agentId, starting);
        const task = yield* fork(runAgentQueue, agentId, queues, workers);
        if (workers.get(agentId) === starting) workers.set(agentId, task);
      }
    }
  } finally {
    const buffered: ChatWork[] = yield* flush(channel);
    channel.close();
    for (const task of [...workers.values()]) {
      if (typeof task !== 'symbol') yield* cancel(task);
    }
    for (const queue of queues.values()) {
      for (const action of queue) {
        const failure = settlePendingCancellation(action);
        if (failure) yield* put(failure);
      }
      queue.length = 0;
    }
    for (const action of buffered) {
      const failure = settlePendingCancellation(action);
      if (failure) yield* put(failure);
    }
    workers.clear();
    queues.clear();
  }
}

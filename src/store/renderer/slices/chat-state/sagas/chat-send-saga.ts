import {
  call,
  cancelled,
  delay,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { sendMessage as sendAgentMessage } from '$features/agent/agent-send';
import {
  getAgentQueueEventSnapshotSeq,
  hydrateAgentQueue,
} from '$features/agent/agent-queue-read-service';
import { buildRecordedAttempt } from '$features/agent/utils/build-recorded-attempt';
import {
  toImageReferenceBlocks,
  type WireImageBlock,
} from '$lib/components/chat/input/image-attachment-placement';
import { getActiveStalledEvent } from '$lib/components/chat/streaming-status-utils';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import {
  agentSessionRetryFromStalledRequested,
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
import { createChiefVirtualWorkspace } from '../../workspace-agents/chief-virtual-workspace';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
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
import {
  selectChatLastAttemptedMessage,
  selectChatLastChunkTime,
  selectChatStatusEvents,
  selectTranscriptHydration,
} from '../chat-state-selectors';
import type { SendMessagePayload } from '../chat-state-types';

const logger = createLogger('ChatSendSaga');
const CANCELLED_ERROR = 'Chat send operation cancelled';

type SendAction = ReturnType<typeof sendMessage>;
type RemoveAction = ReturnType<typeof removeQueuedMessageRequested>;
type StopAction = ReturnType<typeof agentSessionStopChatRequested>;
type RetryAction = ReturnType<typeof agentSessionRetryLastMessageRequested>;
type RetryModelAction = ReturnType<typeof agentSessionRetryWithModelRequested>;
type RetryFromStalledAction = ReturnType<typeof agentSessionRetryFromStalledRequested>;
type ChatCommand =
  SendAction | RemoveAction | StopAction | RetryAction | RetryModelAction | RetryFromStalledAction;

const ORDINARY_CHAT_COMMANDS = [
  sendMessage,
  removeQueuedMessageRequested,
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
  agentSessionRetryFromStalledRequested,
];

type LifecycleSendOptions = {
  imageBlocks?: SendMessagePayload['imageBlocks'];
  fileBlocks?: SendMessagePayload['fileBlocks'];
  noteIds?: string[];
  messageMetadata?: SendMessagePayload['messageMetadata'];
  userAppMessageId?: string;
  model?: string;
  priority?: 'interrupt';
};

function hasSendableMessageContent(
  text: string,
  blocks?: Pick<LifecycleSendOptions, 'imageBlocks' | 'fileBlocks'>,
): boolean {
  return (
    text.trim().length > 0 ||
    (blocks?.imageBlocks?.length ?? 0) > 0 ||
    (blocks?.fileBlocks?.length ?? 0) > 0
  );
}

function* waitForTranscriptRefresh(agentId: string, wsId: string): SagaGenerator<void> {
  while (true) {
    const { settled, unmounted } = yield* race({
      settled: take(transcriptHydrationSettled),
      unmounted: take(workspaceUnmounted),
    });
    if (unmounted?.payload[0] === wsId) return;
    if (!settled || settled.payload[0] !== agentId) continue;
    yield* delay(0);
    const status = yield* selectTranscriptHydration.effect(agentId);
    if (status !== 'loading') return;
  }
}

function* hydrateBeforeSend(agentId: string, wsId: string): SagaGenerator<void> {
  const session = yield* selectAgentSession.effect(agentId);
  if (session && session.messages.length > 0) return;
  const hydration = yield* selectTranscriptHydration.effect(agentId);
  if (session && hydration === 'settled') return;
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

function* dispatchToLifecycle(
  agentId: string,
  wsId: string,
  text: string,
  workspaceContextStr: string | undefined,
  options: LifecycleSendOptions,
  skipQueueCheck: boolean,
): SagaGenerator<void> {
  const workspace =
    wsId === CHIEF_WORKSPACE_ID
      ? createChiefVirtualWorkspace()
      : yield* selectWorkspaceById.effect(wsId);
  if (!workspace) {
    yield* put(chatSendFailed(agentId, m.agent_chatSend_workspaceNotFound_error({ id: wsId })));
    return;
  }
  const content = workspaceContextStr ? `${workspaceContextStr}\n\n${text.trim()}` : text.trim();

  // Pre-upload inline images (monorepo#3338): place each one into the
  // workspace's attachment registry (one placement request per image,
  // chunked when large) and swap the wire blocks to attachment references —
  // the send/queue frame stays constant-size. The chief workspace is
  // virtual (no attachment registry), so its sends keep the inline arm.
  // After success the recorded attempt carries the reference blocks (no
  // MB-scale base64 parked in Redux; a retry passes references through
  // untouched). Placement failure fails the send with the per-image reason
  // (never a silent drop) and records the ORIGINAL inline blocks so "Try
  // again" re-runs placement.
  if ((options.imageBlocks?.length ?? 0) > 0 && wsId !== CHIEF_WORKSPACE_ID) {
    try {
      options = {
        ...options,
        imageBlocks: yield* call(
          toImageReferenceBlocks,
          wsId,
          options.imageBlocks as WireImageBlock[],
        ),
      };
    } catch (error) {
      yield* put(chatLastAttemptedMessageSet(agentId, buildRecordedAttempt(content, options)));
      yield* put(chatSendFailed(agentId, error instanceof Error ? error.message : String(error)));
      return;
    }
  }

  yield* call(hydrateBeforeSend, agentId, wsId);
  const recordedAttempt = buildRecordedAttempt(content, options);
  const isResponding = yield* selectAgentIsResponding.effect(agentId);
  if (!skipQueueCheck && isResponding) {
    yield* put(clearChatDraft(wsId, agentId));
    try {
      const queueOptions = {
        ...(options.imageBlocks !== undefined ? { imageBlocks: options.imageBlocks } : {}),
        ...(options.fileBlocks !== undefined ? { fileBlocks: options.fileBlocks } : {}),
      };
      // Captured BEFORE the wire call: an authoritative snapshot folded while
      // the RPC is in flight — a live agent:queue:updated fold
      // (monorepo#2481) or a hydrate-reconciled fold (monorepo#2486) —
      // advances this seq, and the queue-on-send seed below must then yield
      // to it.
      const queueSeqAtSend = getAgentQueueEventSnapshotSeq(agentId);
      const result =
        Object.keys(queueOptions).length > 0
          ? yield* call([appClient.agents, appClient.agents.queue], agentId, content, queueOptions)
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
        // Seed only when no authoritative snapshot — live agent:queue:updated
        // fold or hydrate-reconciled fold — landed since the send started: a
        // snapshot (including the shrunk-after-drain one) is at least as
        // fresh as this echo, so seeding over it would re-add a just-drained
        // row (monorepo#2481).
        if (getAgentQueueEventSnapshotSeq(agentId) === queueSeqAtSend) {
          const existing = yield* selectAgentQueueMessages.effect(agentId);
          if (!existing.some((message) => message.id === queuedMessage.id)) {
            yield* put(replaceAgentQueue(agentId, [...existing, queuedMessage]));
          }
        } else {
          logger.debug(
            'queue-on-send seed superseded by an authoritative snapshot; reconciling via hydrate',
            { agentId, queuedMessageId: queuedMessage.id },
          );
          // Client-side apply order cannot rank the superseding snapshot
          // against this echo — a hydrate whose getQueue the daemon served
          // BEFORE this send would wrongly suppress a still-queued row
          // (monorepo#2486 review). By now the daemon has processed the
          // enqueue, so one reconciling hydrate returns the true queue in
          // both directions: the row if still queued, without it if drained.
          // Swallowed on failure — the enqueue itself succeeded, so a hydrate
          // error must not surface as chatSendFailed; the service leaves the
          // prior mirror intact on error.
          yield* call(() => hydrateAgentQueue(agentId).catch(() => undefined));
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
  if (!hasSendableMessageContent(payload.text, payload)) return;
  const forceSubmit = payload.forceSubmit === true;
  yield* dispatchToLifecycle(
    agentId,
    payload.wsId,
    payload.text,
    payload.workspaceContextStr,
    {
      imageBlocks: payload.imageBlocks,
      fileBlocks: payload.fileBlocks,
      noteIds: payload.noteIds,
      messageMetadata: payload.messageMetadata,
      userAppMessageId: payload.userAppMessageId,
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

/**
 * Stop the agent's in-flight turn, bracketing the RPC with the
 * chatStopInitiated/chatStopCompleted interrupt flags. chatStopCompleted is
 * put exactly once on every path (success, throw, cancellation).
 */
function* performStop(agentId: string): SagaGenerator<void> {
  yield* put(chatStopInitiated(agentId));
  try {
    const result = yield* call([appClient.agents, appClient.agents.stop], agentId);
    if (!result.success)
      logger.warn('Agent stop was not acknowledged', { agentId, error: result.error });
  } finally {
    yield* put(chatStopCompleted(agentId));
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
    try {
      yield* call(performStop, agentId);
      yield* put(action.success(undefined as void));
      settled = true;
    } catch (error) {
      yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
      settled = true;
    }
  } finally {
    if (!settled && (yield* cancelled())) {
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

function* retryLastMessage(
  action: RetryAction | RetryModelAction,
  model?: string,
): SagaGenerator<void> {
  const [agentId, wsId] = action.payload;
  let settled = false;
  try {
    const lastAttempted = yield* selectChatLastAttemptedMessage.effect(agentId);
    if (!lastAttempted || !hasSendableMessageContent(lastAttempted.text, lastAttempted.options)) {
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
        fileBlocks: lastAttempted.options?.fileBlocks,
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

function* handleRetry(action: RetryAction): SagaGenerator<void> {
  yield* call(retryLastMessage, action);
}

function* handleRetryWithModel(action: RetryModelAction): SagaGenerator<void> {
  yield* call(retryLastMessage, action, action.payload[2]);
}

function matchesUserStop(agentId: string) {
  return (action: { type: string; payload?: unknown }) =>
    action.type === agentSessionStopChatRequested.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === agentId;
}

/**
 * Retry from the stalled state (monorepo#3402): cancel the hung turn and
 * re-send the identical last user input. Guarded on the stall still being
 * active when the command runs — a resumed event, a stream delta, or turn
 * end between the click and this handler makes it a silent no-op, so no
 * duplicate send can race a recovering turn. The re-send goes out through
 * the direct-send arm with `priority: 'interrupt'` (like force-send) so a
 * turn the daemon still considers in flight is preempted instead of the
 * retry auto-queueing behind it (docs/protocol/07-agent-streaming.md).
 */
function* handleRetryFromStalled(action: RetryFromStalledAction): SagaGenerator<void> {
  const [agentId, wsId] = action.payload;
  let settled = false;
  try {
    const statusEvents = yield* selectChatStatusEvents.effect(agentId);
    const lastChunkTime = yield* selectChatLastChunkTime.effect(agentId);
    if (!getActiveStalledEvent(statusEvents, lastChunkTime)) {
      logger.info('Stalled retry skipped; stall no longer active', { agentId });
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }
    const lastAttempted = yield* selectChatLastAttemptedMessage.effect(agentId);
    if (!lastAttempted || !hasSendableMessageContent(lastAttempted.text, lastAttempted.options)) {
      // Nothing recorded to re-send — just cancel the hung turn.
      yield* call(showNothingToRetry);
      yield* call(performStop, agentId);
      yield* put(action.success(undefined as void));
      settled = true;
      return;
    }
    // A user Cancel (agentSessionStopChatRequested) races the retry: it is
    // handled by a separate takeEvery, so without this guard the retry would
    // still re-send after the user chose to stop. Losing the race abandons
    // the re-send; the concurrent stop handler owns cancelling the turn.
    const { stoppedByUser } = yield* race({
      retried: call(function* retrySequence(): SagaGenerator<void> {
        yield* call(performStop, agentId);
        yield* call(
          dispatchToLifecycle,
          agentId,
          wsId,
          lastAttempted.text,
          undefined,
          {
            imageBlocks: lastAttempted.options?.imageBlocks,
            fileBlocks: lastAttempted.options?.fileBlocks,
            noteIds: lastAttempted.options?.noteIds,
            messageMetadata: lastAttempted.options?.messageMetadata,
            model: lastAttempted.options?.model,
            priority: 'interrupt' as const,
          },
          true,
        );
      }),
      stoppedByUser: take(matchesUserStop(agentId)),
    });
    if (stoppedByUser) {
      logger.info('Stalled retry abandoned; user requested stop', { agentId });
    }
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

function getCommandAgentId(action: ChatCommand): string {
  return action.type === sendMessage.type
    ? (action as SendAction).payload.agentId
    : (
        action as
          RemoveAction | StopAction | RetryAction | RetryModelAction | RetryFromStalledAction
      ).payload[0];
}

function* rejectCommand(action: ChatCommand, error: Error): SagaGenerator<void> {
  if (action.type === agentSessionStopChatRequested.type) {
    yield* put((action as StopAction).failure(error));
  } else if (action.type === agentSessionRetryLastMessageRequested.type) {
    yield* put((action as RetryAction).failure(error));
  } else if (action.type === agentSessionRetryWithModelRequested.type) {
    yield* put((action as RetryModelAction).failure(error));
  } else if (action.type === agentSessionRetryFromStalledRequested.type) {
    yield* put((action as RetryFromStalledAction).failure(error));
  }
}

function* runChatCommand(action: ChatCommand): SagaGenerator<void> {
  try {
    if (action.type === sendMessage.type) {
      yield* call(handleSend, action as SendAction);
    } else if (action.type === removeQueuedMessageRequested.type) {
      yield* call(handleRemove, action as RemoveAction);
    } else if (action.type === agentSessionStopChatRequested.type) {
      yield* call(handleStop, action as StopAction);
    } else if (action.type === agentSessionRetryLastMessageRequested.type) {
      yield* call(handleRetry, action as RetryAction);
    } else if (action.type === agentSessionRetryFromStalledRequested.type) {
      yield* call(handleRetryFromStalled, action as RetryFromStalledAction);
    } else {
      yield* call(handleRetryWithModel, action as RetryModelAction);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    logger.error('Chat command failed unexpectedly', {
      agentId: getCommandAgentId(action),
      actionType: action.type,
      error: failure,
    });
    if (action.type === sendMessage.type) {
      yield* put(chatSendFailed(getCommandAgentId(action), failure.message));
    } else {
      yield* call(rejectCommand, action, failure);
    }
  }
}

function* discardPendingCommand(action: ChatCommand): SagaGenerator<void> {
  yield* call(rejectCommand, action, new Error(CANCELLED_ERROR));
}

export function* chatSendSaga(): SagaGenerator<void> {
  yield* takeEvery(agentSessionStopChatRequested, runChatCommand);
  yield* takeEveryByContextFIFO(ORDINARY_CHAT_COMMANDS, getCommandAgentId, runChatCommand, {
    onDiscardPending: discardPendingCommand,
  });
}

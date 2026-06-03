/**
 * Send Message Saga
 *
 * Handles the orchestration of sending chat messages:
 * - Queue-vs-send decision based on streaming state
 * - Workspace rebind waiting
 * - Workspace change detection + reinitialization
 * - Dispatching agent-session send trigger / unifiedOrchestrator.queueMessage
 * - Error handling + toast notifications
 *
 * Replaces the ~250-line handleSend() in ChatPanel.svelte.
 */

import {
  call,
  delay,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { unifiedOrchestrator } from '$features/agent/services/consolidated-backend.service';
import {
  selectAgentIsResponding,
  selectAgentSession,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import {
  agentSessionStopChatRequested,
  agentSessionSendMessageRequested,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSessionSendMessageOptions } from '$store/renderer/slices/agent-session/agent-session-types';

import { selectPendingCount } from '$store/renderer/slices/permission/permission-selectors';
import { clearChatDraft } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { uncheckAllSelections } from '$store/renderer/slices/multi-panel-context/multi-panel-context-slice';
import type { AgentSession } from '$shared/types';
import { waitFor } from 'ag-redux-toolkit/saga';
import type { StoreSelector as PackageStoreSelector } from 'ag-redux-toolkit/types';
import {
  sendMessage,
  chatSendStarted,
  chatSendFailed,
  chatTrackedWorkspaceSet,
  chatRebindStarted,
  chatRebindEnded,
  initializeChatRequested,
  chatInitialized,
  chatInitFailed,
} from '../chat-state-slice';
import {
  selectChatIsRebinding,
  selectChatLastMessageTime,
  selectChatTrackedWorkspaceId,
} from '../chat-state-selectors';
import {
  MIN_MESSAGE_SEND_INTERVAL,
  type SendMessagePayload,
} from '../chat-state-types';

const logger = createLogger('SendMessageSaga');
type WaitForSelector<R, ARGS extends any[]> = PackageStoreSelector<R, ARGS, unknown>;

function getLastAssistantStopReason(agent: AgentSession | undefined): string | undefined {
  const messages = agent?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'assistant') {
      return message.metadata?.stopReason;
    }
  }
  return undefined;
}

function getStoppedTurnStopReason(agent: AgentSession | undefined): string | undefined {
  return agent?.stopReason ?? getLastAssistantStopReason(agent);
}

function isCompletedTurnReadyForInput(agent: AgentSession | undefined): boolean {
  const activationState = agent?.activationState as string | undefined;
  const status = agent ? String(agent.status).toLowerCase() : undefined;
  const hasReadyCanonicalStatus =
    agent?.isActive === false ||
    status === 'idle' ||
    status === 'waiting' ||
    status === 'completed';

  return Boolean(
    agent &&
      (activationState == null || activationState === 'active') &&
      !agent.isStreaming &&
      hasReadyCanonicalStatus &&
      getStoppedTurnStopReason(agent) === 'end_turn',
  );
}

function* isWaitingForUserAction(agentId: string): SagaGenerator<boolean> {
  const pendingPermissionCount = yield* selectPendingCount.effect(agentId);
  return pendingPermissionCount > 0;
}

// ============================================================================
// Toast helper — call via yield* call() so it's testable
// ============================================================================

function showErrorToast(message: string): void {
  // Lazy import to avoid pulling svelte-sonner into the saga module graph at load time.
  // This function is only called inside yield* call() — never at import time.
  import('svelte-sonner').then(({ toast }) => {
    toast.error(message);
  });
}

type SerializedContextItem = NonNullable<SendMessagePayload['serializedContextItems']>[number];
type ImageBlock = NonNullable<SendMessagePayload['imageBlocks']>[number];

function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({
        data: result.split(',')[1] || result,
        mimeType: file.type || 'application/octet-stream',
      });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function extractImageBlocks(items: SerializedContextItem[] | undefined): ImageBlock[] | undefined {
  const imageBlocks = items
    ?.filter((item) => item.imageData && item.imageMimeType)
    .map((item) => ({
      type: 'image' as const,
      data: item.imageData!,
      mimeType: item.imageMimeType!,
    }));

  return imageBlocks && imageBlocks.length > 0 ? imageBlocks : undefined;
}

function* serializeContextItemsForQueue(
  payload: SendMessagePayload,
): SagaGenerator<{
  serializedContextItems?: SerializedContextItem[];
  imageBlocks?: ImageBlock[];
}> {
  if (payload.serializedContextItems) {
    return {
      serializedContextItems: payload.serializedContextItems,
      imageBlocks: payload.imageBlocks ?? extractImageBlocks(payload.serializedContextItems),
    };
  }

  if (!payload.contextItems || payload.contextItems.length === 0) {
    return { imageBlocks: payload.imageBlocks };
  }

  const serializedItems: SerializedContextItem[] = [];
  for (const item of payload.contextItems) {
    if (!item.file) {
      serializedItems.push(item);
      continue;
    }

    try {
      const { data, mimeType } = yield* call(fileToBase64, item.file);
      const { file: _file, ...rest } = item;
      serializedItems.push(
        item.file.type.startsWith('image/')
          ? { ...rest, imageData: data, imageMimeType: mimeType }
          : { ...rest, fileData: data, fileMimeType: mimeType },
      );
    } catch (error) {
      logger.error('Failed to serialize context item for queued send', {
        label: item.label,
        error,
      });
    }
  }

  return {
    serializedContextItems: serializedItems,
    imageBlocks: payload.imageBlocks ?? extractImageBlocks(serializedItems),
  };
}

function* removeQueuedMessageBeforeSend(
  agentId: string,
  payload: SendMessagePayload,
): SagaGenerator<boolean> {
  if (!payload.queuedMessageId) return true;

  const result = yield* call(
    unifiedOrchestrator.removeQueuedMessage.bind(unifiedOrchestrator),
    agentId,
    payload.queuedMessageId,
  );
  if (!result.success) {
    logger.error('Failed to remove queued message before sending', {
      agentId,
      messageId: payload.queuedMessageId,
      error: result.error,
    });
  }
  return result.success;
}

function* stopBeforeForceSubmit(agentId: string, payload: SendMessagePayload): SagaGenerator<void> {
  if (!payload.forceSubmit) return;

  const isResponding = yield* selectAgentIsResponding.effect(agentId);
  if (!isResponding) return;

  const stopAction = agentSessionStopChatRequested(agentId);
  yield* put(stopAction);
  try {
    yield* call(() => stopAction.promise);
  } catch (error) {
    logger.warn('Failed to stop chat before force submit', { agentId, error });
  }
}

function* takeChatInitializedForAgent(
  agentId: string,
): SagaGenerator<ReturnType<typeof chatInitialized>> {
  while (true) {
    const action = yield* take(chatInitialized);
    if (action.payload[0] === agentId) return action;
  }
}

function* takeChatInitFailedForAgent(
  agentId: string,
): SagaGenerator<ReturnType<typeof chatInitFailed>> {
  while (true) {
    const action = yield* take(chatInitFailed);
    if (action.payload[0] === agentId) return action;
  }
}

// ============================================================================
// Queue path
// ============================================================================

function* handleQueuePath(
  agentId: string,
  payload: SendMessagePayload,
  wsId: string,
  reason?: string,
): SagaGenerator<void> {
  const { text } = payload;
  const { serializedContextItems, imageBlocks } = yield* call(serializeContextItemsForQueue, payload);

  logger.info(reason ?? 'Agent is streaming, queueing message', { agentId });

  const result = yield* call(
    unifiedOrchestrator.queueMessage.bind(unifiedOrchestrator),
    agentId,
    text.trim(),
    serializedContextItems,
    imageBlocks && imageBlocks.length > 0 ? imageBlocks : undefined,
    wsId,
  );

  if (result.success) {
    yield* put(clearChatDraft(wsId, agentId));
    logger.info('Message queued successfully', {
      agentId,
      messageId: result.queuedMessage?.id,
      hasImages: !!imageBlocks?.length,
    });
  } else {
    logger.error('Failed to queue message', { agentId, error: result.error });
  }
}

// ============================================================================
// Send path
// ============================================================================

function* handleSendPath(
  wsId: string,
  agentId: string,
  payload: SendMessagePayload,
): SagaGenerator<void> {
  const { text, workspaceContextStr, noteIds } = payload;

  const removedQueuedMessage = yield* call(removeQueuedMessageBeforeSend, agentId, payload);
  if (!removedQueuedMessage) return;

  yield* call(stopBeforeForceSubmit, agentId, payload);

  // --- Redux-owned rate limiting ---
  const now = Date.now();
  const lastMessageTime = yield* selectChatLastMessageTime.effect(agentId);
  if (lastMessageTime > 0 && now - lastMessageTime < MIN_MESSAGE_SEND_INTERVAL) {
    logger.warn('Message sent too quickly, rejecting', { agentId });
    yield* put(chatSendFailed(agentId, ''));
    return;
  }

  // --- Dispatch chatSendStarted immediately so loading UI appears right away ---
  yield* put(chatSendStarted(agentId, wsId));

  // --- Rebind wait ---
  const isRebinding = yield* selectChatIsRebinding.effect(agentId);
  if (isRebinding) {
    logger.info('Waiting for in-flight workspace rebind before sending', { agentId });
    const rebindCompleted = yield* waitFor(
      selectChatIsRebinding as unknown as WaitForSelector<boolean, [string]>,
      [agentId] as [string],
      (val: boolean) => val === false,
      5000,
    );
    if (!rebindCompleted) {
      logger.error('Workspace rebind timed out, aborting send', { agentId });
      yield* put(chatSendFailed(agentId, 'Chat session is still initializing. Please try again.'));
      yield* call(showErrorToast, 'Chat session is still initializing. Please try again.');
      return;
    }
  }

  // --- Workspace change detection ---
  const trackedWsId = yield* selectChatTrackedWorkspaceId.effect(agentId);
  if (trackedWsId !== null && trackedWsId !== wsId) {
    logger.warn('Workspace has changed, reinitializing chat', { agentId, trackedWsId, wsId });
    yield* put(chatTrackedWorkspaceSet(agentId, wsId));
    yield* put(chatRebindStarted(agentId));
    // Dispatch initializeChatRequested and wait for the saga to complete
    yield* put(initializeChatRequested(agentId, {
      wsId,
      options: {
        agentName: payload.agentName,
        agentModel: payload.agentModel,
        isInitialWorkspaceAgent: payload.isInitialWorkspaceAgent,
      },
    }));

    // Wait for init to succeed or fail before proceeding with send (30s timeout)
    const { failed, timeout } = yield* race({
      initialized: call(takeChatInitializedForAgent, agentId),
      failed: call(takeChatInitFailedForAgent, agentId),
      timeout: delay(30_000),
    });

    yield* put(chatRebindEnded(agentId));

    if (failed || timeout) {
      const reason = timeout ? 'timed out' : 'failed';
      logger.error(`Chat reinitialization ${reason} in send path`, { agentId, wsId });
      yield* put(chatTrackedWorkspaceSet(agentId, null));
      const errorMsg = timeout
        ? 'Chat initialization timed out. Please try again.'
        : 'Failed to initialize chat session. Please try again.';
      yield* put(chatSendFailed(agentId, errorMsg));
      yield* call(showErrorToast, errorMsg);
      return;
    }
  }

  // --- Actually send ---
  try {
    // Prepend workspace context to the message if available
    const messageWithContext = workspaceContextStr
      ? `${workspaceContextStr}\n\n${text.trim()}`
      : text.trim();

    // Dispatch shared/domain cleanup actions. ChatPanel owns local DOM/input cleanup.
    yield* put(clearChatDraft(wsId, agentId));
    yield* put(uncheckAllSelections());

    const { serializedContextItems, imageBlocks } = yield* call(serializeContextItemsForQueue, payload);

    // When serializedContextItems are present, they already contain image
    // entries (with imageData/imageMimeType) from the normal ChatPanel send flow.
    // Only reconstruct from imageBlocks for the queue-replay ("Send now") flow,
    // which may dispatch imageBlocks without context items.
    const hasSerializedContext = !!serializedContextItems && serializedContextItems.length > 0;
    const imageContextItems =
      !hasSerializedContext
        ? imageBlocks?.map((block, index) => ({
            id: `queued-image-${index}`,
            type: 'file' as const,
            label: `Image ${index + 1}`,
            imageData: block.data,
            imageMimeType: block.mimeType,
          })) ?? []
        : [];

    const allContextItems = [
      ...(serializedContextItems ?? []),
      ...imageContextItems,
    ];

    const sendAction = agentSessionSendMessageRequested(agentId, wsId, messageWithContext, {
      // serializedContextItems have File objects stripped (serialized to base64 data),
      // so they satisfy the send context shape at runtime even though `file` is absent.
      contextItems: allContextItems.length > 0
        ? (allContextItems as AgentSessionSendMessageOptions['contextItems'])
        : undefined,
      noteIds,
      agentId,
    });
    yield* put(sendAction);
    yield* call(() => sendAction.promise);

    logger.info('Message sent successfully', { agentId });
  } catch {
    // The core agentSessionSendMessageRequested handler owns send failure side effects.
  }
}

// ============================================================================
// Root handler
// ============================================================================

function* handleSendMessage(
  action: ReturnType<typeof sendMessage>,
): SagaGenerator<void> {
  const { agentId, payload } = action.payload;
  const wsId = payload.wsId;

  // --- Check streaming state (queue-vs-send decision) ---
  if (!payload.skipQueueCheck) {
    // agent-session canonical selector is the single source of truth for responding state
    const isResponding = yield* selectAgentIsResponding.effect(agentId);
    const agent = yield* selectAgentSession.effect(agentId);
    const isUserActionWait = yield* call(isWaitingForUserAction, agentId);
    const isStoppedTurnReadyForInput = isCompletedTurnReadyForInput(agent);

    const shouldQueue = isResponding && !isUserActionWait && !isStoppedTurnReadyForInput;

    if (shouldQueue) {
      // Queue path: no concurrency guard needed — multiple messages can be queued
      yield* call(handleQueuePath, agentId, payload, wsId);
      return;
    }
  }

  // --- Send path (concurrency guard is in watchSendMessage) ---
  yield* call(handleSendPath, wsId, agentId, payload);
}

// ============================================================================
// Watcher — per-agentId takeLeading (only one send per agent at a time)
// ============================================================================

/**
 * Tracks whether a send operation is in-flight for a given agentId.
 * If a sendMessage arrives while one is already running for the same agent,
 * the message is queued (routed to handleQueuePath) so it can be processed
 * once the current send completes.
 */
const activeSends = new Set<string>();

/** @internal Exposed for test cleanup only — do not use in production code. */
export function _resetActiveSendsForTest(): void {
  activeSends.clear();
}

export function* watchSendMessage(): SagaGenerator<void> {
  yield* takeEvery(sendMessage, function* (action: ReturnType<typeof sendMessage>) {
    const { agentId, payload } = action.payload;
    const wsId = payload.wsId;

    if (activeSends.has(agentId)) {
      const agent = yield* selectAgentSession.effect(agentId);
      const isUserActionWait = yield* call(isWaitingForUserAction, agentId);
      const isStoppedTurnReadyForInput = isCompletedTurnReadyForInput(agent);
      if (payload.skipQueueCheck || isStoppedTurnReadyForInput || isUserActionWait) {
        logger.info('Bypassing stale active send guard for ready agent', {
          agentId,
          skipQueueCheck: !!payload.skipQueueCheck,
          isStoppedTurnReadyForInput,
          isUserActionWait,
        });
        activeSends.delete(agentId);
      } else {
        yield* call(
          handleQueuePath,
          agentId,
          payload,
          wsId,
          'Send already in flight, queueing message',
        );
        return;
      }
    }

    activeSends.add(agentId);
    try {
      yield* call(handleSendMessage, action);
    } finally {
      activeSends.delete(agentId);
    }
  });
}

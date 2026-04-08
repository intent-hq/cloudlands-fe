/**
 * Send Message Saga
 *
 * Handles the orchestration of sending chat messages:
 * - Queue-vs-send decision based on streaming state
 * - Workspace rebind waiting
 * - Workspace change detection + reinitialization
 * - Calling chatService.sendMessage / unifiedOrchestrator.queueMessage
 * - Error handling + toast notifications
 *
 * Replaces the ~250-line handleSend() in ChatPanel.svelte.
 */

import { call, delay, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { getChatService, MessageGuardError, type SendMessageOptions } from '$features/agent/services/chat.service';
import { unifiedOrchestrator } from '$features/agent/services/consolidated-backend.service';
import { selectAgentById } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
import { clearChatDraft } from '$lib/store/slices/transient-ui/transient-ui-slice';
import { uncheckAllSelections } from '$lib/store/slices/multi-panel-context/multi-panel-context-slice';
import { cleanErrorMessage } from '$shared/errors/messages';
import { waitFor } from '$lib/store/slices/store-utility/sagas/waitFor';
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
  selectChatTrackedWorkspaceId,
} from '../chat-state-selectors';
import type { SendMessagePayload } from '../chat-state-types';

const logger = createLogger('SendMessageSaga');

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

// ============================================================================
// Queue path
// ============================================================================

function* handleQueuePath(
  agentId: string,
  payload: SendMessagePayload,
  wsId: string,
): SagaGenerator<void> {
  const { text, serializedContextItems, imageBlocks } = payload;

  logger.info('Agent is streaming, queueing message', { agentId });

  const result = yield* call(
    unifiedOrchestrator.queueMessage.bind(unifiedOrchestrator),
    agentId,
    text.trim(),
    serializedContextItems,
    imageBlocks && imageBlocks.length > 0 ? imageBlocks : undefined,
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
  const { text, serializedContextItems, workspaceContextStr, noteIds } = payload;

  // --- Dispatch chatSendStarted immediately so loading UI appears right away ---
  yield* put(chatSendStarted(agentId));

  // --- Rebind wait ---
  const isRebinding = yield* selectChatIsRebinding.effect(agentId);
  if (isRebinding) {
    logger.info('Waiting for in-flight workspace rebind before sending', { agentId });
    const rebindCompleted = yield* waitFor(
      selectChatIsRebinding,
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
      initialized: take((action: { type: string; payload?: unknown }) =>
        action.type === chatInitialized.type &&
        Array.isArray((action as any).payload) &&
        (action as any).payload[0] === agentId,
      ),
      failed: take((action: { type: string; payload?: unknown }) =>
        action.type === chatInitFailed.type &&
        Array.isArray((action as any).payload) &&
        (action as any).payload[0] === agentId,
      ),
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
    const chatService = getChatService(agentId);
    const workspace = yield* selectWorkspaceById.effect(wsId);
    if (!workspace) {
      logger.error('Workspace not found in Redux for send', { wsId });
      yield* put(chatSendFailed(agentId, 'Workspace not found. Please try again.'));
      yield* call(showErrorToast, 'Workspace not found. Please try again.');
      return;
    }

    // Prepend workspace context to the message if available
    const messageWithContext = workspaceContextStr
      ? `${workspaceContextStr}\n\n${text.trim()}`
      : text.trim();

    // Dispatch UI cleanup actions
    yield* put(clearChatDraft(wsId, agentId));
    yield* put(uncheckAllSelections());

    yield* call(
      chatService.sendMessage.bind(chatService),
      messageWithContext,
      workspace,
      agentId,
      {
        // serializedContextItems have File objects stripped (serialized to base64 data),
        // so they satisfy ContextItem at runtime even though the `file` property is absent.
        contextItems: serializedContextItems as SendMessageOptions['contextItems'],
        noteIds,
        agentId,
      },
    );

    logger.info('Message sent successfully', { agentId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
    const isInterrupted = errorMessage.includes('Agent interrupted');

    // FIX: MessageGuardError (rate limiter / idempotency check) means the message
    // was legitimately blocked. Clear the streaming state that chatSendStarted set,
    // but don't show an error toast — this is expected double-click protection.
    if (error instanceof MessageGuardError) {
      logger.info('Message blocked by guard, clearing send state', { agentId, reason: errorMessage });
      yield* put(chatSendFailed(agentId, ''));
      return;
    }

    if (!isInterrupted) {
      logger.error('Failed to send message', { agentId, error });
      yield* put(chatSendFailed(agentId, cleanErrorMessage(errorMessage)));
      yield* call(showErrorToast, cleanErrorMessage(errorMessage));
    }
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
    // agent-session is the single source of truth for streaming/processing state
    const agent = yield* selectAgentById.effect(agentId);
    const isStreaming: boolean = agent?.isStreaming ?? false;
    const isProcessing: boolean = agent?.isProcessing ?? false;

    const shouldQueue = isProcessing || isStreaming;

    if (shouldQueue) {
      yield* call(handleQueuePath, agentId, payload, wsId);
      return;
    }
  }

  // --- Send path ---
  yield* call(handleSendPath, wsId, agentId, payload);
}

// ============================================================================
// Watcher — per-agentId takeLeading (only one send per agent at a time)
// ============================================================================

/**
 * Tracks whether a send operation is in-flight for a given agentId.
 * If a sendMessage arrives while one is already running for the same agent,
 * it is dropped (takeLeading semantics per key) to prevent conversation
 * state corruption or duplicate sends.
 */
const activeSends = new Set<string>();

export function* watchSendMessage(): SagaGenerator<void> {
  yield* takeEvery(sendMessage, function* (action: ReturnType<typeof sendMessage>) {
    const { agentId } = action.payload;

    if (activeSends.has(agentId)) {
      logger.warn('Dropping concurrent sendMessage — send already in flight', { agentId });
      return;
    }

    activeSends.add(agentId);
    try {
      yield* call(handleSendMessage, action);
    } finally {
      activeSends.delete(agentId);
    }
  });
}

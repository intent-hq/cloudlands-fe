/**
 * Agent Stream Saga
 *
 * Manages stream handler lifecycle via redux-saga, replacing the
 * setTimeout/Map-based tracking that previously lived in AgentService.
 *
 * Responsibilities:
 * - Safety timeout: after reconnect, re-checks backend streams and clears
 *   stale isStreaming flags (replaces startStreamingSafetyTimeout)
 * - Coordinates with stream-handler-registry.ts for non-serializable runtime state
 */

import { createLogger } from '$lib/utils/client-logger';
import {
  call,
  delay,
  put,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { invoke } from '$lib/electron-bridge';
import type { AgentMessage,
  AgentSession,
  ContentBlock } from '$shared/types';
import {
  isContentBlock,
  normalizeContentBlocks,
} from '$shared/types';
import { createAppMessageId } from '$shared/utils/app-message-id';
import { pickPlaceholderId } from '$features/agent/utils/pick-placeholder-id';
import { ensureStreamHandler } from '$features/agent/agent-stream-lifecycle';
import { persistenceService } from '$features/agent/browser';
import {
  type AgentStreamUpdatePayload,
  triggerStreamingSafetyCheck,
  agentStreamResetStreamingMessagesRequested,
  agentStreamUpdateReceived,
  backendStreamsReconnectResultReceived,
  reconnectStreamHandlersForWorkspaceRequested,
} from '../../workspace-agents/workspace-agents-slice';
import { selectAllWorkspaceAgents } from '../../workspace-agents/workspace-agents-selectors';
import { selectAgentSessionsByIds } from '../agent-session-selectors';
import {
  addMessage as addAgentSessionMessage,
  replaceMessages,
  updateSession as updateAgentSessionAction,
  setAgentStreaming,
  updateMessage,
  upsertSession,
} from '../agent-session-slice';
import {
  computeMessageContentHash,
  deduplicateAgentMessages,
  isTimestampClose,
} from '$shared/utils/message-dedup';
import { resolveStreamContentBlocks } from '../utils/stream-content-blocks';
import { newAssistantMessage } from '../../unread-tracking/unread-tracking-slice';
import {
  logger as rendererLogger,
  LogCategory,
} from '$lib/logging/logger.svelte';
import { selectAgentSession } from '../agent-session-selectors';

const logger = createLogger('AgentStreamSaga');

const STALE_STREAM_SESSION_REFRESH_COOLDOWN_MS = 750;
const staleStreamSessionRefreshes = new Map<string, number>();
const staleStreamSessionRefreshesInFlight = new Set<string>();

function getStreamPayload(
  action: ReturnType<typeof agentStreamUpdateReceived>,
): AgentStreamUpdatePayload {
  return action.payload[0];
}

function getResetPayload(action: ReturnType<typeof agentStreamResetStreamingMessagesRequested>) {
  return action.payload[0];
}

type CompleteAgentMessage = Partial<AgentMessage> & {
  contentBlocks?: ContentBlock[];
  metadata?: Record<string, unknown>;
};

const MESSAGE_ROLES = new Set<AgentMessage['role']>(['user', 'assistant', 'system', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessageRole(value: unknown): value is AgentMessage['role'] {
  return typeof value === 'string' && MESSAGE_ROLES.has(value as AgentMessage['role']);
}

function isAgentMessageLike(value: unknown): value is CompleteAgentMessage {
  if (!isRecord(value) || isContentBlock(value)) return false;
  if (!isMessageRole(value.role)) return false;

  return (
    typeof value.id === 'string' ||
    typeof value.appMessageId === 'string' ||
    typeof value.timestamp === 'string' ||
    Array.isArray(value.contentBlocks) ||
    isRecord(value.metadata) ||
    typeof value.content === 'string'
  );
}

function getCompleteAgentMessage(
  payload: AgentStreamUpdatePayload,
): CompleteAgentMessage | undefined {
  return isAgentMessageLike(payload.completeMessage) ? payload.completeMessage : undefined;
}

function getCompletionContentBlocks(value: unknown): ContentBlock[] | undefined {
  if (Array.isArray(value)) {
    const blocks = value.filter(isContentBlock);
    return blocks.length > 0 ? normalizeContentBlocks(blocks) : undefined;
  }
  if (isContentBlock(value)) {
    return normalizeContentBlocks([value]);
  }
  if (isAgentMessageLike(value) && Array.isArray(value.contentBlocks)) {
    const blocks = value.contentBlocks.filter(isContentBlock);
    return blocks.length > 0 ? normalizeContentBlocks(blocks) : undefined;
  }
  return undefined;
}

function findAssistantUpdateTarget(
  session: AgentSession | undefined,
  payload: AgentStreamUpdatePayload,
): AgentMessage | undefined {
  const completeMessage = getCompleteAgentMessage(payload);
  const assistantMessages = (session?.messages || []).filter(
    (message) => message.role === 'assistant',
  );

  const idMatch = assistantMessages.find(
    (message) =>
      (payload.assistantMessageId ? message.id === payload.assistantMessageId : false) ||
      (completeMessage?.id ? message.id === completeMessage.id : false),
  );
  if (idMatch) return idMatch;

  const appMessageIdMatch = assistantMessages.find(
    (message) =>
      (payload.assistantAppMessageId
        ? message.appMessageId === payload.assistantAppMessageId
        : false) ||
      (completeMessage?.appMessageId
        ? message.appMessageId === completeMessage.appMessageId
        : false),
  );
  if (appMessageIdMatch) return appMessageIdMatch;

  const streamingMatch = assistantMessages.find((message) => message.isStreaming === true);
  if (streamingMatch) return streamingMatch;

  // Content-hash fallback: when IDs diverge (local placeholder vs canonical msg_*)
  // and the streaming flag was already cleared, match by content + timestamp so the
  // complete event can land on the right message instead of triggering the full
  // refresh-and-fallback path.
  if (payload.eventType === 'complete' && completeMessage) {
    const incomingHash = computeMessageContentHash({
      role: 'assistant',
      contentBlocks: getPayloadContentBlocks(payload),
    } as AgentMessage);
    if (incomingHash) {
      const contentMatch = assistantMessages.find((message) => {
        if (computeMessageContentHash(message) !== incomingHash) return false;
        return isTimestampClose(message.timestamp, completeMessage.timestamp);
      });
      if (contentMatch) return contentMatch;
    }
  }

  return undefined;
}

function getPayloadContentBlocks(payload: AgentStreamUpdatePayload): ContentBlock[] | undefined {
  if (payload.contentBlocks && payload.contentBlocks.length > 0) {
    return payload.contentBlocks;
  }
  return getCompletionContentBlocks(payload.completeMessage);
}

function getWorkspaceIdForStreamPayload(
  payload: AgentStreamUpdatePayload,
  session: AgentSession | undefined,
): string | undefined {
  return payload.workspaceId || session?.workspaceId;
}

function isBackgroundAgent(session: AgentSession | undefined): boolean {
  return !!(session?.isBackground || session?.metadata?.isBackground);
}

function isActiveStreamEvent(eventType: AgentStreamUpdatePayload['eventType']): boolean {
  return eventType === 'started' || eventType === 'chunk' || eventType === 'content-blocks';
}

function createFallbackAssistantMessage(
  payload: AgentStreamUpdatePayload,
  session: AgentSession,
): AgentMessage {
  const completeMessage = getCompleteAgentMessage(payload);
  const isComplete = payload.eventType === 'complete';
  const contentBlocks = resolveStreamContentBlocks(
    [],
    getPayloadContentBlocks(payload),
    payload.eventType,
  ) || [{ type: 'text', text: '' }];
  const message: AgentMessage = {
    id:
      completeMessage?.id || pickPlaceholderId(payload.assistantMessageId, session.messages || []),
    appMessageId:
      completeMessage?.appMessageId || payload.assistantAppMessageId || createAppMessageId(),
    role: 'assistant',
    contentBlocks,
    timestamp: completeMessage?.timestamp || new Date().toISOString(),
    isStreaming: !isComplete,
    streamingComplete: isComplete,
    metadata: completeMessage?.metadata,
  };

  if (completeMessage?.agentId) message.agentId = completeMessage.agentId;
  if (completeMessage?.turnNumber !== undefined) message.turnNumber = completeMessage.turnNumber;
  if (completeMessage?.toolCalls) message.toolCalls = completeMessage.toolCalls;
  if (completeMessage?.toolResults) message.toolResults = completeMessage.toolResults;
  if (completeMessage?.error) message.error = completeMessage.error;
  if (completeMessage?.errorCode) message.errorCode = completeMessage.errorCode;

  return message;
}

function hasSameMessageReferences(a: AgentMessage[], b: AgentMessage[]): boolean {
  return a.length === b.length && a.every((message, index) => message === b[index]);
}

function deduplicateRecoverySession(session: AgentSession): AgentSession {
  const messages = session.messages || [];
  if (!Array.isArray(messages)) return session;
  const dedupedMessages = deduplicateAgentMessages(messages);
  if (hasSameMessageReferences(messages, dedupedMessages)) return session;
  return { ...session, messages: dedupedMessages };
}

function buildMessageUpdates(
  payload: AgentStreamUpdatePayload,
  target: AgentMessage,
): Partial<AgentMessage> {
  const contentBlocks = resolveStreamContentBlocks(
    target.contentBlocks || [],
    getPayloadContentBlocks(payload),
    payload.eventType,
  );
  const completeMessage = getCompleteAgentMessage(payload);
  const updates: Partial<AgentMessage> = {
    appMessageId:
      completeMessage?.appMessageId || target.appMessageId || payload.assistantAppMessageId,
  };

  if (contentBlocks) {
    updates.contentBlocks = contentBlocks;
  }

  if (payload.eventType === 'complete') {
    updates.isStreaming = false;
    updates.streamingComplete = true;
    if (completeMessage?.metadata) {
      updates.metadata = { ...target.metadata, ...completeMessage.metadata };
    }
  } else if (
    payload.eventType === 'chunk' ||
    payload.eventType === 'content-blocks' ||
    payload.eventType === 'started'
  ) {
    updates.isStreaming = true;
    updates.streamingComplete = false;
  }

  return updates;
}

function buildCompleteReplacementMessage(
  payload: AgentStreamUpdatePayload,
  target: AgentMessage,
): AgentMessage {
  const completeMessage = getCompleteAgentMessage(payload);
  const finalContentBlocks = getCompletionContentBlocks(payload.completeMessage);
  const updates = buildMessageUpdates(payload, target);
  return {
    ...target,
    ...completeMessage,
    ...updates,
    id: completeMessage?.id || target.id,
    role: 'assistant',
    timestamp: completeMessage?.timestamp || target.timestamp,
    contentBlocks: finalContentBlocks || updates.contentBlocks || target.contentBlocks,
  } as AgentMessage;
}

function buildCompletedMessages(
  session: AgentSession,
  target: AgentMessage,
  replacement: AgentMessage,
): AgentMessage[] {
  return (session.messages || []).map((message) =>
    message.id === target.id ? replacement : message,
  );
}

function hasContentBlocks(message: AgentMessage): boolean {
  return (message.contentBlocks || []).some((block) => {
    if (block.type === 'text') return !!block.text?.trim();
    return true;
  });
}

function isEmptyStreamingAssistantPlaceholder(message: AgentMessage): boolean {
  return message.role === 'assistant' && message.isStreaming === true && !hasContentBlocks(message);
}

function removeDuplicateFallbackCompleteMessages(
  messages: AgentMessage[],
  fallbackMessage: AgentMessage,
): AgentMessage[] {
  const fallbackHash = computeMessageContentHash(fallbackMessage);
  if (!fallbackHash) return messages;

  return messages.filter((message) => {
    if (message === fallbackMessage) return true;
    if (message.role !== 'assistant') return true;
    if (computeMessageContentHash(message) !== fallbackHash) return true;
    return !isTimestampClose(message.timestamp, fallbackMessage.timestamp);
  });
}

function* markStreamActiveIfNeeded(
  payload: AgentStreamUpdatePayload,
  session: AgentSession | undefined,
): SagaGenerator<void> {
  if (!session || !isActiveStreamEvent(payload.eventType)) return;
  if (session.isStreaming === true && session.isProcessing === true) return;
  if (session.isStreaming !== true) {
    yield* put(setAgentStreaming(payload.agentId, true));
  }
  yield* put(updateAgentSessionAction(payload.agentId, { isStreaming: true, isProcessing: true }));
}

function* applyStreamUpdateToCurrentSession(
  payload: AgentStreamUpdatePayload,
  session: AgentSession | undefined,
): SagaGenerator<boolean> {
  const wsId = getWorkspaceIdForStreamPayload(payload, session);
  if (!wsId) return false;

  if (payload.eventType === 'error' || payload.eventType === 'timeout') {
    yield* put(setAgentStreaming(payload.agentId, false));
    if (session) {
      yield* put(
        updateAgentSessionAction(payload.agentId, { isStreaming: false, isProcessing: false }),
      );
    }
    return true;
  }

  const target = findAssistantUpdateTarget(session, payload);
  if (target) {
    yield* call(markStreamActiveIfNeeded, payload, session);
    if (payload.eventType === 'complete' && session) {
      const replacement = buildCompleteReplacementMessage(payload, target);
      const completedMessages = buildCompletedMessages(session, target, replacement);
      const dedupedMessages = deduplicateAgentMessages(completedMessages);
      if (replacement.id !== target.id || dedupedMessages.length !== completedMessages.length) {
        yield* put(replaceMessages(payload.agentId, dedupedMessages));
      } else {
        yield* put(updateMessage(payload.agentId, target.id, buildMessageUpdates(payload, target)));
      }
      yield* put(setAgentStreaming(payload.agentId, false));
      yield* put(
        updateAgentSessionAction(payload.agentId, {
          isStreaming: false,
          isProcessing: false,
          isResponding: false,
        }),
      );
      yield* put(newAssistantMessage(payload.agentId, wsId, isBackgroundAgent(session)));
      return true;
    }
    yield* put(updateMessage(payload.agentId, target.id, buildMessageUpdates(payload, target)));
    return true;
  }

  if (payload.eventType === 'started' && payload.createInitialPlaceholder && session) {
    const message = createFallbackAssistantMessage(payload, session);
    yield* put(addAgentSessionMessage(payload.agentId, message));
    yield* call(markStreamActiveIfNeeded, payload, session);
    return true;
  }

  return false;
}

function* refreshSessionForMissingTarget(
  payload: AgentStreamUpdatePayload,
  session: AgentSession | undefined,
): SagaGenerator<AgentSession | undefined> {
  const wsId = getWorkspaceIdForStreamPayload(payload, session);
  if (!wsId) return session;

  const refreshKey = `${wsId}:${payload.agentId}`;
  if (staleStreamSessionRefreshesInFlight.has(refreshKey)) {
    logger.debug('Coalescing stale stream session refresh', { agentId: payload.agentId, wsId });
    yield* delay(50);
    return yield* selectAgentSession.effect(payload.agentId);
  }

  const now = Date.now();
  const lastRefreshAt = staleStreamSessionRefreshes.get(refreshKey) || 0;
  if (now - lastRefreshAt < STALE_STREAM_SESSION_REFRESH_COOLDOWN_MS) {
    logger.debug('Rate-limiting stale stream session refresh', { agentId: payload.agentId, wsId });
    return session;
  }

  staleStreamSessionRefreshes.set(refreshKey, now);
  staleStreamSessionRefreshesInFlight.add(refreshKey);
  try {
    const loaded: AgentSession | null = yield* call(
      [persistenceService, persistenceService.loadSession],
      payload.agentId,
      wsId,
      { bypassCache: true },
    );
    if (loaded) {
      const reconciled = deduplicateRecoverySession({
        ...loaded,
        workspaceId: loaded.workspaceId || wsId,
      } as AgentSession);
      yield* put(
        upsertSession({
          ...reconciled,
          workspaceId: wsId as AgentSession['workspaceId'],
        }),
      );
      return yield* selectAgentSession.effect(payload.agentId);
    }
  } catch (error) {
    logger.warn('Failed to refresh stale stream session', {
      agentId: payload.agentId,
      wsId,
      error,
    });
  } finally {
    staleStreamSessionRefreshesInFlight.delete(refreshKey);
  }

  return yield* selectAgentSession.effect(payload.agentId);
}

function* createFallbackAfterRefreshMiss(
  payload: AgentStreamUpdatePayload,
  session: AgentSession | undefined,
): SagaGenerator<void> {
  const wsId = getWorkspaceIdForStreamPayload(payload, session);
  if (!wsId || !session || payload.eventType === 'error' || payload.eventType === 'timeout') return;

  const message = createFallbackAssistantMessage(payload, session);
  const sessionMessages = session.messages || [];
  const messagesBeforeFallback =
    payload.eventType === 'complete'
      ? removeDuplicateFallbackCompleteMessages(sessionMessages, message)
      : sessionMessages;
  const replacementMessages = deduplicateAgentMessages([...messagesBeforeFallback, message]);
  yield* put(replaceMessages(payload.agentId, replacementMessages));
  yield* put(setAgentStreaming(payload.agentId, payload.eventType !== 'complete'));
  if (payload.eventType === 'complete') {
    yield* put(
      updateAgentSessionAction(payload.agentId, {
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
      }),
    );
    yield* put(newAssistantMessage(payload.agentId, wsId, isBackgroundAgent(session)));
  }
  logger.warn('Created fallback streaming placeholder after refresh missed target', {
    agentId: payload.agentId,
    wsId,
    eventType: payload.eventType,
    source: payload.source,
  });
}

export function* handleAgentStreamUpdate(
  action: ReturnType<typeof agentStreamUpdateReceived>,
): SagaGenerator<void> {
  const payload = getStreamPayload(action);
  const session: AgentSession | undefined = yield* selectAgentSession.effect(payload.agentId);
  const applied = yield* call(applyStreamUpdateToCurrentSession, payload, session);
  if (applied) return;

  logger.warn('Stream update has no assistant update target; refreshing session', {
    agentId: payload.agentId,
    workspaceId: payload.workspaceId,
    eventType: payload.eventType,
    source: payload.source,
    assistantMessageId: payload.assistantMessageId,
    assistantAppMessageId: payload.assistantAppMessageId,
  });

  const refreshedSession = yield* call(refreshSessionForMissingTarget, payload, session);
  const appliedAfterRefresh = yield* call(
    applyStreamUpdateToCurrentSession,
    payload,
    refreshedSession,
  );
  if (!appliedAfterRefresh) {
    yield* call(createFallbackAfterRefreshMiss, payload, refreshedSession);
  }
}

export function* handleAgentStreamResetStreamingMessages(
  action: ReturnType<typeof agentStreamResetStreamingMessagesRequested>,
): SagaGenerator<void> {
  const payload = getResetPayload(action);
  const session: AgentSession | undefined = yield* selectAgentSession.effect(payload.agentId);
  const wsId = payload.workspaceId || session?.workspaceId;
  if (!session || !wsId) return;

  const nextMessages = deduplicateAgentMessages(
    (session.messages || []).flatMap((message) => {
      if (isEmptyStreamingAssistantPlaceholder(message)) return [];
      if (message.role === 'assistant' && message.isStreaming === true) {
        return [{ ...message, isStreaming: false, streamingComplete: true }];
      }
      return [message];
    }),
  );
  if (!hasSameMessageReferences(session.messages || [], nextMessages)) {
    yield* put(replaceMessages(payload.agentId, nextMessages));
  }
  yield* put(setAgentStreaming(payload.agentId, false));
}

export function* handleBackendStreamsReconnectResult(
  action: ReturnType<typeof backendStreamsReconnectResultReceived>,
): SagaGenerator<void> {
  const [streams] = action.payload;
  for (const stream of streams) {
    if (!stream.workspaceId) continue;
    let session: AgentSession | undefined = yield* selectAgentSession.effect(stream.agentId);
    if (!session) {
      const payload: AgentStreamUpdatePayload = {
        workspaceId: stream.workspaceId,
        agentId: stream.agentId,
        handlerSessionId: stream.agentId,
        source: 'restored',
        eventType: 'chunk',
        assistantAppMessageId: stream.assistantAppMessageId,
        contentBlocks: stream.accumulatedContent?.contentBlocks,
        chunk: stream.accumulatedContent?.content,
      };
      session = yield* call(refreshSessionForMissingTarget, payload, undefined);
    }
    const existingMessage = (session?.messages || []).find(
      (message) => message.role === 'assistant' && message.isStreaming === true,
    );
    yield* call(ensureStreamHandler, stream.agentId, {
      existingMessage,
      workspaceId: stream.workspaceId,
      assistantAppMessageId: stream.assistantAppMessageId ?? existingMessage?.appMessageId,
    });
  }
}

function* handleReconnectStreamHandlersForWorkspace(
  action: ReturnType<typeof reconnectStreamHandlersForWorkspaceRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const sessions: AgentSession[] = yield* selectAllWorkspaceAgents.effect(workspaceId);
  for (const session of sessions) {
    if (!session.isStreaming) continue;
    const existingMessage = (session.messages || []).find(
      (message) => message.role === 'assistant' && message.isStreaming === true,
    );
    yield* call(ensureStreamHandler, session.id as string, {
      existingMessage,
      workspaceId,
      assistantAppMessageId: existingMessage?.appMessageId,
    });
  }
}

// ============================================================================
// 1. Safety timeout — replaces startStreamingSafetyTimeout()
//    Uses saga delay/race instead of setTimeout.
// ============================================================================

export function* handleStreamingSafetyCheck(
  action: ReturnType<typeof triggerStreamingSafetyCheck>,
): SagaGenerator<void> {
  const [confirmedActiveIds] = action.payload;
  const candidateIds = Array.from(new Set(confirmedActiveIds.filter(Boolean)));
  if (candidateIds.length === 0) return;

  // Wait 10 seconds (saga delay replaces setTimeout)
  yield* delay(10_000);

  try {
    // Re-query the backend for currently active streams
    const result: any = yield* call(invoke, 'agent:get-active-streams' as any, undefined);
    const currentlyActive = new Set<string>(
      result?.success && result?.data ? result.data.map((s: any) => s.agentId) : [],
    );

    const candidateSessions: AgentSession[] = yield* selectAgentSessionsByIds.effect(candidateIds);

    let clearedCount = 0;
    for (const session of candidateSessions) {
      if (session.isStreaming && !currentlyActive.has(session.id as string)) {
        logger.info('Safety timeout: force-clearing stale streaming state', {
          agentId: session.id,
          workspaceId: session.workspaceId,
        });

        rendererLogger.warn(LogCategory.AGENT, 'Safety timeout fired: clearing stale streaming', {
          agentId: session.id,
          workspaceId: session.workspaceId,
          currentlyActiveStreamsCount: currentlyActive.size,
        });

        // Only write to the workspace that owns the session. Previously we
        // fell back to selectActiveWorkspaceId when session.workspaceId was
        // missing, which could land stale flags in a workspace the agent
        // doesn't belong to.
        const wsId = session.workspaceId;
        if (!wsId) {
          logger.warn('Cannot clear streaming state: session has no workspaceId', {
            agentId: session.id,
          });
          continue;
        }
        yield* put(setAgentStreaming(session.id as string, false));
        // Clear BOTH isStreaming AND isProcessing to prevent the agent
        // appearing "busy" (spinner) after the safety timeout fires.
        // setAgentStreaming only clears isStreaming; isProcessing is normally
        // cleared by the streamCompleted action, but the safety
        // timeout bypasses that path.
        const updatedSession = {
          ...session,
          workspaceId: wsId as AgentSession['workspaceId'],
          isStreaming: false,
          isProcessing: false,
        };
        yield* put(upsertSession(updatedSession));

        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      logger.info('Safety timeout: cleared stale streaming states', {
        clearedCount,
        activeStreamCount: currentlyActive.size,
      });
    }
  } catch (error) {
    logger.error('Safety timeout: failed to check streaming states', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Root saga
// ============================================================================

export function* agentStreamSaga(): SagaGenerator<void> {
  if (typeof window === 'undefined') return;

  // Raw stream updates from the thin lifecycle adapter.
  yield* takeEvery(agentStreamUpdateReceived, handleAgentStreamUpdate);

  // Saga-owned stale streaming assistant cleanup before a new stream starts.
  yield* takeEvery(
    agentStreamResetStreamingMessagesRequested,
    handleAgentStreamResetStreamingMessages,
  );

  // Backend active-stream snapshots and reconnect requests are reconciled here.
  yield* takeLatest(backendStreamsReconnectResultReceived, handleBackendStreamsReconnectResult);
  yield* takeLatest(
    reconnectStreamHandlersForWorkspaceRequested,
    handleReconnectStreamHandlersForWorkspace,
  );

  // Safety timeout: takeLatest ensures only one runs at a time
  yield* takeLatest(triggerStreamingSafetyCheck, handleStreamingSafetyCheck);
}

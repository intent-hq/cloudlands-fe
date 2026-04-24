/**
 * Initialize Chat Saga
 *
 * Handles chat initialization orchestration via Redux saga.
 * Uses takeLatest so a new dispatch automatically cancels any in-flight older init.
 *
 * Flow:
 * 1. Look up session from Redux state, agentService memory, disk restore
 * 2. Retry with backoff if not found
 * 3. Wait for session to appear via Redux action if retries exhausted
 * 4. Load and deduplicate messages, detect streaming state
 * 5. Dispatch chatInitialized to Redux
 * 6. Set up instance-local state on ChatService (workspaceId, streaming content, DOM handlers)
 */

import {
  call,
  cancel,
  delay,
  fork,
  join,
  put,
  race,
  select,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { Task } from 'redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { agentService } from '$features/agent/agent-ipc-bridge';
import { persistenceService } from '$features/agent/browser/index';
import { getChatService } from '$features/agent/services/chat.service';
import {
  selectAgentById,
  selectIsInitialSpecWriteInProgress,
} from '../../workspace-agents/workspace-agents-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { addAgent, upsertAgentSession } from '../../workspace-agents/workspace-agents-slice';
import { initializeChatRequested, chatInitialized, chatInitFailed } from '../chat-state-slice';
import {
  upsertSession as upsertAgentSessionData,
  replaceMessages,
} from '../../agent-session/agent-session-slice';
import { selectAgentMessages } from '../../agent-session/agent-session-selectors';
import { selectChatStateOrDefault } from '../chat-state-selectors';
import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';
import type { InitializeChatOptions, LastAttemptedMessage } from '../chat-state-types';

const logger = createLogger('InitializeChatSaga');

// ============================================================================
// Session Lookup
// ============================================================================

/**
 * Try to find the agent session from multiple sources:
 * 1. Redux workspace-agents state
 * 2. agentService in-memory cache
 * 3. Disk restore via agentService.restoreSession
 */
function* lookupSession(wsId: string, agentId: string): SagaGenerator<AgentSession | null> {
  // 1. Redux state
  const session: AgentSession | undefined | null = yield* select((state) =>
    selectAgentById.select(state, agentId),
  );
  if (session) return session;

  // 2. Redux state (re-read) — historically a fallback to agentService in-memory,
  // which itself just delegates to selectAgentById. Kept as a tick-separated
  // re-read so downstream retries behave the same.
  const tempSession: AgentSession | undefined | null = yield* select((state) =>
    selectAgentById.select(state, agentId),
  );
  if (tempSession) return tempSession;

  // 3. Disk restore
  const workspace = yield* selectWorkspaceById.effect(wsId);
  if (workspace) {
    try {
      const restored: AgentSession | null = yield* call(
        [agentService, agentService.restoreSession],
        agentId,
        workspace,
      );
      if (restored) {
        return { ...restored, isStreaming: restored.isStreaming ?? false };
      }
    } catch (err) {
      logger.warn('Could not restore session from disk', { agentId, wsId, error: err });
    }
  }

  return null;
}

// ============================================================================
// Retry with backoff
// ============================================================================

function* retryLookup(wsId: string, agentId: string): SagaGenerator<AgentSession | null> {
  const retryDelays = [500, 1000, 2000];
  for (const ms of retryDelays) {
    yield* delay(ms);
    // Check Redux
    const session: AgentSession | undefined | null = yield* select((state) =>
      selectAgentById.select(state, agentId),
    );
    if (session) return session;
    // Re-read Redux (historical fallback to agentService, which itself just reads Redux)
    const temp: AgentSession | undefined | null = yield* select((state) =>
      selectAgentById.select(state, agentId),
    );
    if (temp) return temp;
  }
  return null;
}

// ============================================================================
// Message loading helpers
// ============================================================================

function deduplicateMessages(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

function getTextLength(blocks: ContentBlock[]): number {
  return (
    blocks?.reduce((sum: number, b: ContentBlock) => {
      if (b.type === 'text' && 'text' in b) return sum + ((b as any).text?.length || 0);
      return sum;
    }, 0) || 0
  );
}

// ============================================================================
// Main saga
// ============================================================================

/** Continued in the next section via str-replace-editor */
function* handleInitializeChat(
  action: ReturnType<typeof initializeChatRequested>,
): SagaGenerator<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { wsId, agentId, options } = action.payload as {
    wsId: string;
    agentId: string;
    options?: InitializeChatOptions;
  };
  logger.info('initializeChatRequested saga started', { wsId, agentId });

  try {
    // Step 1: Look up session
    let session: AgentSession | null = yield* lookupSession(wsId, agentId);

    // Step 2: Retry with backoff if not found
    if (!session) {
      session = yield* retryLookup(wsId, agentId);
    }

    // Step 3: If still not found, wait for session to appear via Redux action
    if (!session) {
      logger.warn('Session not found after retries, waiting for Redux action', { wsId, agentId });
      const waitResult = yield* race({
        agentAdded: take((a: any) => {
          if (a.type === addAgent.type) {
            const [aWsId, agent] = a.payload;
            return aWsId === wsId && agent.id === agentId;
          }
          if (a.type === upsertAgentSession.type) {
            const [aWsId, s] = a.payload;
            return aWsId === wsId && s.id === agentId;
          }
          return false;
        }),
        timeout: delay(30_000),
      });

      if (waitResult.agentAdded) {
        // Session appeared — re-lookup from Redux
        session = yield* select((state) => selectAgentById.select(state, agentId) ?? null);
      }

      if (!session) {
        // Timed out or session still not found
        logger.warn('Session not found after wait, giving up', { wsId, agentId });
        yield* put(chatInitFailed(agentId, 'Session not found after wait timeout'));
        return;
      }
    }

    // Step 4: Load messages — resolve from multiple sources
    // Read messages from agent-session slice (canonical source)
    const agentSessionMessages: AgentMessage[] = yield* select((state) =>
      selectAgentMessages.select(state, agentId),
    );
    // Read isStreaming from agent-session (single source of truth)
    const sessionForStreamCheck = yield* select((state) => selectAgentById.select(state, agentId));
    const hasActiveStream =
      (sessionForStreamCheck?.isStreaming ?? false) && agentSessionMessages.length > 0;

    let messages: AgentMessage[] = [];
    if (hasActiveStream) {
      messages = agentSessionMessages;
    } else {
      const reduxSession: AgentSession | undefined = yield* select((state) =>
        selectAgentById.select(state, agentId),
      );
      const reduxMessages =
        reduxSession?.messages && Array.isArray(reduxSession.messages) ? reduxSession.messages : [];

      if (agentSessionMessages.length > 0 && agentSessionMessages.length > reduxMessages.length) {
        messages = agentSessionMessages;
      } else if (
        agentSessionMessages.length > 0 &&
        agentSessionMessages.length === reduxMessages.length &&
        reduxMessages.length > 0
      ) {
        // Content-richness tiebreaker
        const currentLast = agentSessionMessages[agentSessionMessages.length - 1];
        const sessionLast = reduxMessages[reduxMessages.length - 1];
        if (currentLast?.id === sessionLast?.id) {
          const currentTextLength = getTextLength(currentLast?.contentBlocks || []);
          const sessionTextLength = getTextLength(sessionLast?.contentBlocks || []);
          messages = currentTextLength > sessionTextLength ? agentSessionMessages : reduxMessages;
        } else {
          messages = reduxMessages;
        }
      } else if (reduxMessages.length > 0) {
        messages = reduxMessages;
      } else if (session.messages && Array.isArray(session.messages)) {
        messages = session.messages;
      } else {
        const agent: AgentSession | undefined = yield* select((state) =>
          selectAgentById.select(state, agentId),
        );
        if (agent?.messages) {
          messages = agent.messages;
        }
      }
    }

    // When not streaming, check disk for messages the frontend may be missing.
    // The in-memory Redux state can become stale when the backend persists messages
    // directly (e.g., sub-agent delegation, subscription wake-ups) without the
    // frontend ever receiving them via IPC events.
    // We use persistenceService.loadSession with bypassCache (a fresh disk read
    // with no Redux side effects) rather than agentService.restoreSession which
    // dispatches actions like setActiveAgentId and may trigger backend activation.
    // bypassCache is critical: the renderer-side PersistenceService has a 5s TTL
    // cache that could return stale data, defeating the purpose of the merge.
    if (session && !hasActiveStream) {
      try {
        const diskSession: AgentSession | null = yield* call(
          [persistenceService, persistenceService.loadSession],
          agentId,
          wsId,
          { bypassCache: true },
        );
        if (diskSession?.messages && diskSession.messages.length > 0) {
          if (messages.length === 0) {
            // No in-memory messages — use disk messages directly
            messages = diskSession.messages;
            session = { ...session, messages };
          } else {
            // Check if disk has messages the frontend is missing
            const inMemoryIds = new Set(messages.map((m) => m.id));
            const missingFromDisk = diskSession.messages.filter(
              (m) => !inMemoryIds.has(m.id),
            );
            if (missingFromDisk.length > 0) {
              logger.info('Merging disk messages missing from in-memory state', {
                agentId,
                inMemoryCount: messages.length,
                diskCount: diskSession.messages.length,
                missingCount: missingFromDisk.length,
              });
              // Use disk message order as canonical, then append any in-memory-only
              // messages (e.g., optimistic sends not yet persisted to disk)
              const diskIds = new Set(diskSession.messages.map((m) => m.id));
              const inMemoryOnly = messages.filter((m) => !diskIds.has(m.id));
              messages = [...diskSession.messages, ...inMemoryOnly];
              session = { ...session, messages };
            }
          }
        }
      } catch (err) {
        logger.warn('Failed to load messages from disk for merge', { agentId, error: err });
      }
    }

    // Step 5: Determine streaming state
    let isCurrentlyStreaming = session?.isStreaming || false;
    const agentFromStore: AgentSession | undefined = yield* select((state) =>
      selectAgentById.select(state, agentId),
    );
    if (agentFromStore?.isStreaming) {
      isCurrentlyStreaming = true;
    }
    if (hasActiveStream && !isCurrentlyStreaming) {
      isCurrentlyStreaming = true;
    }
    // Fallback: if the initial spec-writer is actively writing, we know the
    // agent IS streaming even if bulkUpsertSessions clobbered the flag with
    // stale disk data before we could read it.
    if (!isCurrentlyStreaming) {
      const specWriteInProgress: boolean = yield* select((state) =>
        selectIsInitialSpecWriteInProgress.select(state, wsId),
      );
      if (specWriteInProgress) {
        isCurrentlyStreaming = true;
      }
    }

    // Step 6: Compute existing streaming content
    let existingStreamingContent = '';
    const freshChatState = yield* select((state) =>
      selectChatStateOrDefault.select(state, agentId),
    );

    // Check if Redux chat state already has streaming content (HMR case)
    const chatServiceInstance = yield* call(getChatService, agentId);
    const instanceHasContent = isCurrentlyStreaming && freshChatState.streamingContent?.length > 0;

    if (instanceHasContent) {
      existingStreamingContent = freshChatState.streamingContent;
    } else if (isCurrentlyStreaming && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === 'assistant' && lastMessage?.contentBlocks) {
        const textBlocks = lastMessage.contentBlocks.filter((b: ContentBlock) => b.type === 'text');
        const lastTextBlock = textBlocks[textBlocks.length - 1];
        if (lastTextBlock && 'text' in lastTextBlock) {
          existingStreamingContent = (lastTextBlock as any).text || '';
        }
      }
    }

    // Step 7: Deduplicate messages
    const deduplicatedMessages = deduplicateMessages(messages);

    // Step 8: Compute lastAttemptedMessage for retry support
    let restoredLastAttemptedMessage: LastAttemptedMessage | null = null;
    if (isCurrentlyStreaming && deduplicatedMessages.length > 0) {
      for (let i = deduplicatedMessages.length - 1; i >= 0; i--) {
        const msg = deduplicatedMessages[i];
        if (msg.role === 'user') {
          const textBlock = msg.contentBlocks?.find(
            (b: ContentBlock) => b.type === 'text' && 'text' in b,
          );
          if (textBlock && 'text' in textBlock) {
            restoredLastAttemptedMessage = { text: (textBlock as any).text || '' };
          }
          break;
        }
      }
    }

    const effectiveLastAttempted =
      restoredLastAttemptedMessage ?? freshChatState.lastAttemptedMessage;

    // Step 9: Upsert session data into agent-session slice
    const normalizedSession = session
      ? { ...session, isStreaming: session.isStreaming ?? false, messages: deduplicatedMessages }
      : null;
    if (normalizedSession) {
      yield* put(upsertAgentSessionData(normalizedSession));
    } else if (deduplicatedMessages.length > 0) {
      yield* put(replaceMessages(agentId, deduplicatedMessages));
    }

    // Step 9b: Dispatch chatInitialized to Redux (streaming/UI flags only)
    yield* put(
      chatInitialized(agentId, {
        isStreaming: isCurrentlyStreaming,
        streamingContent: existingStreamingContent,
        lastAttemptedMessage: effectiveLastAttempted,
      }),
    );

    // Step 10: Set up DOM handlers for streaming
    if (session) {
      yield* call(
        [chatServiceInstance, chatServiceInstance.setupStreamingForSession],
        agentId,
        session.id,
      );
    }

    logger.info('initializeChatRequested saga completed', {
      wsId,
      agentId,
      sessionId: session?.id,
      messageCount: deduplicatedMessages.length,
      isStreaming: isCurrentlyStreaming,
    });
  } catch (error) {
    logger.error('initializeChatRequested saga failed', error as Error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to initialize chat';
    yield* put(chatInitFailed(agentId, errorMsg));
  }
}

// ============================================================================
// Watcher
// ============================================================================

/**
 * Per-agentId keyed takeLatest: cancels only the in-flight init for the
 * same agentId, allowing concurrent inits for different agents.
 */
export function* initializeChatSaga(): SagaGenerator<void> {
  const runningTasks = new Map<string, Task>();

  yield* takeEvery(
    initializeChatRequested,
    function* (action: ReturnType<typeof initializeChatRequested>) {
      const agentId = action.payload.agentId;

      // Cancel any previous in-flight init for this specific agent
      const existing = runningTasks.get(agentId);
      if (existing) {
        yield* cancel(existing);
        runningTasks.delete(agentId);
      }

      const task = yield* fork(handleInitializeChat, action);
      runningTasks.set(agentId, task);

      // Fork a cleanup that removes the entry once the task finishes
      yield* fork(function* () {
        try {
          yield* join(task);
        } finally {
          // Only delete if this is still the tracked task (not replaced by a newer one)
          if (runningTasks.get(agentId) === task) {
            runningTasks.delete(agentId);
          }
        }
      });
    },
  );
}

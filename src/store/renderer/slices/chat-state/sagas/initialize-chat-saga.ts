/**
 * Initialize Chat Saga
 *
 * Handles chat initialization orchestration via Redux saga.
 * Uses takeLatest so a new dispatch automatically cancels any in-flight older init.
 *
 * Flow:
 * 1. Look up session from Redux state and disk restore
 * 2. Wait for session readiness via waitFor utility if not found
 * 3. Load and deduplicate messages, detect streaming state
 * 4. Dispatch chatInitialized to Redux
 * 5. Stream lifecycle is delivered through Redux-owned sagas and IPC handlers.
 */

import {
  call,
  cancel,
  fork,
  join,
  put,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { Task } from 'redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { persistenceService } from '$features/agent/browser/index';
import {
  selectWorkspaceAgentReadySession,
  selectIsInitialSpecWriteInProgress,
} from '../../workspace-agents/workspace-agents-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  initializeChatRequested,
  sendInitialMessageRequested,
  chatInitialized,
  chatInitFailed,
  chatSendStarted,
  chatSendFailed,
} from '../chat-state-slice';
import {
  agentSessionSendMessageRequested,
  upsertSession,
  replaceMessages,
} from '../../agent-session/agent-session-slice';
import type { AgentSessionSendMessageOptions } from '../../agent-session/agent-session-types';
import { hydrateAgentQueueRequested } from '../../agent-queue/agent-queue-slice';
import { selectAgentMessages } from '../../agent-session/agent-session-selectors';
import { selectChatStateOrDefault } from '../chat-state-selectors';
import { waitFor } from 'ag-redux-toolkit/saga';
import type { StoreSelector as PackageStoreSelector } from 'ag-redux-toolkit/types';
import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';
import { compareMessageCompleteness } from '$shared/utils/message-comparator';
import { invoke } from '$shared/generated/ipc-client';
import { restoreSessionFromDiskWithoutBackend } from '../../workspace-agents/sagas/agent-session-restore-utils';
import type {
  InitializeChatOptions,
  InitialMessagePayload,
  LastAttemptedMessage,
} from '../chat-state-types';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';

const logger = createLogger('InitializeChatSaga');
type WaitForSelector<R, ARGS extends any[]> = PackageStoreSelector<R, ARGS, unknown>;

type ActiveStreamsResult = {
  success?: boolean;
  data?: Array<{ agentId?: string }>;
};

// ============================================================================
// Session Lookup
// ============================================================================

/**
 * Try to find the agent session from multiple sources:
 * 1. Redux workspace-agents state
 * 2. Disk restore via restoreSession
 */
function* lookupSession(wsId: string, agentId: string): SagaGenerator<AgentSession | null> {
  // 1. Redux state
  const session: AgentSession | undefined | null = yield* selectAgentSession.effect(agentId);
  if (session) return session;

  // 2. Disk restore
  const workspace = yield* selectWorkspaceById.effect(wsId);
  if (workspace) {
    try {
      const restored: AgentSession | null = yield* call(
        restoreSessionFromDiskWithoutBackend,
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

/**
 * Threshold for treating a persisted streaming flag as stale. A session that
 * was actively streaming would have its `updatedAt` refreshed on every chunk
 * via the persistence debounce (typically sub-second). Anything older than
 * this is from a previous app run that crashed or was closed mid-stream.
 */
const STALE_STREAMING_THRESHOLD_MS = 30_000;

interface StaleStreamingReconciliation {
  session: AgentSession;
  messages: AgentMessage[];
  reconciled: boolean;
}

function hasPersistedStreamingSignal(session: AgentSession, messages: AgentMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  return Boolean(
    session.isStreaming === true ||
      lastAssistant?.isStreaming === true ||
      lastAssistant?.streamingComplete === false,
  );
}

async function getActiveStreamAgentIds(): Promise<Set<string> | null> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI) return null;

    const result = await invoke<ActiveStreamsResult>('agent:get-active-streams');
    const streams = result?.success !== false && Array.isArray(result?.data) ? result.data : [];
    return new Set(
      streams
        .map((stream) => stream.agentId)
        .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0),
    );
  } catch {
    return null;
  }
}

/**
 * Normalize sessions/messages loaded from disk that were left mid-stream by a
 * previous app run/crash. Without this, the chat UI would show a stuck
 * "Thinking" indicator forever because the persisted message still carries
 * `isStreaming: true` and a trailing unresolved `tool_use`.
 */
function reconcileStaleStreamingState(
  session: AgentSession,
  messages: AgentMessage[],
): StaleStreamingReconciliation {
  const sessionFlagSet = session.isStreaming === true;
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const messageFlagSet =
    lastAssistant?.isStreaming === true || lastAssistant?.streamingComplete === false;
  if (!sessionFlagSet && !messageFlagSet) {
    return { session, messages, reconciled: false };
  }

  const updatedAt = session.updatedAt;
  const updatedAtMs = updatedAt ? new Date(updatedAt as string | Date).getTime() : 0;
  const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Number.POSITIVE_INFINITY;
  if (ageMs < STALE_STREAMING_THRESHOLD_MS) {
    return { session, messages, reconciled: false };
  }

  logger.warn(
    'Detected stale streaming session left over from previous run; normalizing locally',
    { agentId: session.id, updatedAt, ageMs },
  );

  const reconciledMessages = messages.map((message, index) => {
    if (index !== messages.length - 1) return message;
    if (message.role !== 'assistant') return message;
    if (
      message.isStreaming !== true &&
      message.streamingComplete !== false &&
      message.metadata?.interrupted === true
    ) {
      return message;
    }
    return {
      ...message,
      isStreaming: false,
      streamingComplete: true,
      metadata: {
        ...(message.metadata || {}),
        interrupted: true,
        stopReason: message.metadata?.stopReason ?? 'interrupted',
      },
    };
  });

  return {
    session: {
      ...session,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    },
    messages: reconciledMessages,
    reconciled: true,
  };
}

function getTextLength(blocks: ContentBlock[]): number {
  return (
    blocks?.reduce((sum: number, b: ContentBlock) => {
      if (b.type === 'text' && 'text' in b) return sum + ((b as any).text?.length || 0);
      return sum;
    }, 0) || 0
  );
}

function isDiskMessageRicher(inMemory: AgentMessage, disk: AgentMessage): boolean {
  // Use the shared comparator which checks block count *and* text length,
  // not just text length — so tool_use/tool_result blocks and streaming
  // metadata are properly accounted for.
  return compareMessageCompleteness({ messages: [inMemory] }, { messages: [disk] }) === -1;
}

function showErrorToast(message: string): void {
  import('svelte-sonner').then(({ toast }) => {
    toast.error(message);
  });
}

function clearInitialAgentConfigFields(wsId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const agentConfigKey = `workspace:${wsId}:agent-config`;
  const agentConfigData = sessionStorage.getItem(agentConfigKey);
  if (!agentConfigData) return;

  try {
    const config = JSON.parse(agentConfigData);
    config.prompt = null;
    config.imageBlocks = null;
    config.contextReferences = null;
    config.messageSent = null;
    sessionStorage.setItem(agentConfigKey, JSON.stringify(config));
  } catch (err) {
    logger.warn('Failed to clear initial agent config fields', { wsId, error: err });
  }
}

function cleanupInitialAgentArtifacts(wsId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(`workspace:${wsId}:initial-agent-pending`);
  sessionStorage.removeItem(`workspace:${wsId}:agent-config`);
}

function readInitialAgentConfig(wsId: string, agentId: string): InitialMessagePayload | null {
  if (typeof sessionStorage === 'undefined') return null;

  const agentConfigKey = `workspace:${wsId}:agent-config`;
  const agentConfigData = sessionStorage.getItem(agentConfigKey);
  if (!agentConfigData) return null;

  try {
    const config = JSON.parse(agentConfigData);
    const payload: InitialMessagePayload = {
      wsId,
      message: config.prompt,
      imageBlocks: config.imageBlocks,
      contextReferences: config.contextReferences,
      alreadySent: !!config.messageSent,
    };

    if (config.agentId !== agentId || !hasInitialMessageContent(payload)) {
      return null;
    }

    return payload;
  } catch (err) {
    logger.warn('Failed to parse agent config', err);
    return null;
  }
}

function hasInitialMessageContent(payload: InitialMessagePayload): boolean {
  return !!(
    payload.message?.trim() ||
    payload.contextReferences?.length ||
    payload.imageBlocks?.length
  );
}

function buildInitialMessage(payload: InitialMessagePayload): string {
  const hasContextReferences = !!payload.contextReferences?.length;
  const hasImageBlocks = !!payload.imageBlocks?.length;
  const message = payload.message?.trim() || '';
  if (message) return message;
  if (hasImageBlocks && !hasContextReferences) return '[Image attached]';
  if (hasContextReferences) {
    return 'I have linked some context above. Please review it and help me with this task.';
  }
  return '';
}

function* waitForInitialSession(
  wsId: string,
  agentId: string,
  timeoutMs = 5000,
): SagaGenerator<AgentSession | null> {
  const isReady = yield* waitFor(
    selectWorkspaceAgentReadySession as unknown as WaitForSelector<AgentSession | null, [string, string]>,
    [wsId, agentId],
    (session) => !!session,
    timeoutMs,
  );
  if (!isReady) return null;

  return (yield* selectWorkspaceAgentReadySession.effect(wsId, agentId)) ?? null;
}

/**
 * Resolve the initialize-chat session in one explicit order:
 * 1. Immediate Redux session lookup
 * 2. Disk restore fallback
 * 3. Utility-backed readiness wait for async hydration
 */
function* resolveInitializeChatSession(
  wsId: string,
  agentId: string,
  timeoutMs: number,
): SagaGenerator<AgentSession | null> {
  const immediateSession = yield* lookupSession(wsId, agentId);
  if (immediateSession) return immediateSession;

  logger.warn('Session not found immediately, waiting for selector readiness', {
    wsId,
    agentId,
  });

  return yield* call(waitForInitialSession, wsId, agentId, timeoutMs);
}

function* handleSendInitialMessage(
  action: ReturnType<typeof sendInitialMessageRequested>,
): SagaGenerator<void> {
  const { agentId, payload } = action.payload;
  const { wsId } = payload;
  const initialPayload = hasInitialMessageContent(payload)
    ? payload
    : yield* call(readInitialAgentConfig, wsId, agentId);

  if (!initialPayload) return;

  if (initialPayload.alreadySent) {
    logger.info('Initial message already sent before hydration, reconciling send state', {
      agentId,
      wsId,
    });
    yield* put(chatSendStarted(agentId, wsId));
    yield* call(clearInitialAgentConfigFields, wsId);
    return;
  }

  const session = yield* call(waitForInitialSession, wsId, agentId, 5000);
  if (!session) {
    logger.error('Failed to send initial message - session not ready before timeout', {
      agentId,
      wsId,
    });
    const errorMsg = 'Chat session timed out — please try again.';
    yield* put(chatSendFailed(agentId, errorMsg));
    yield* call(showErrorToast, errorMsg);
    return;
  }

  const workspace = yield* selectWorkspaceById.effect(wsId);
  if (!workspace) {
    logger.error('Workspace not found for initial message send', { agentId, wsId });
    const errorMsg = 'Workspace not found. Please try again.';
    yield* put(chatSendFailed(agentId, errorMsg));
    yield* call(showErrorToast, errorMsg);
    return;
  }

  const messageWithContext = buildInitialMessage(initialPayload);
  const imageContextItems =
    initialPayload.imageBlocks?.map((block, index) => ({
      id: `initial-image-${index}`,
      type: 'file' as const,
      label: `Image ${index + 1}`,
      imageData: block.data,
      imageMimeType: block.mimeType,
    })) ?? [];

  yield* put(chatSendStarted(agentId, wsId));
  const sendAction = agentSessionSendMessageRequested(agentId, wsId, messageWithContext, {
    contextItems:
      imageContextItems.length > 0
        ? (imageContextItems as AgentSessionSendMessageOptions['contextItems'])
        : undefined,
    contextReferences: initialPayload.contextReferences
      ? (initialPayload.contextReferences as AgentSessionSendMessageOptions['contextReferences'])
      : undefined,
    agentId,
  });
  yield* put(sendAction);
  yield* call(cleanupInitialAgentArtifacts, wsId);
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
    // Step 1: Resolve session through Redux, disk restore, then selector readiness.
    let session: AgentSession | null = yield* resolveInitializeChatSession(wsId, agentId, 30_000);
    if (!session) {
      logger.warn('Session not found after wait, giving up', { wsId, agentId });
      yield* put(chatInitFailed(agentId, 'Session not found after wait timeout'));
      return;
    }

    // Step 2: Load messages — resolve from multiple sources
    // Read messages from agent-session slice (canonical source)
    const agentSessionMessages: AgentMessage[] = yield* selectAgentMessages.effect(agentId);
    // Fresh store snapshot before optional disk load controls stream skip + Redux message comparison.
    const storeSessionBeforeDisk: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
    const hasActiveStream =
      (storeSessionBeforeDisk?.isStreaming ?? false) && agentSessionMessages.length > 0;

    let messages: AgentMessage[] = [];
    if (hasActiveStream) {
      messages = agentSessionMessages;
    } else {
      const reduxMessages =
        storeSessionBeforeDisk?.messages && Array.isArray(storeSessionBeforeDisk.messages)
          ? storeSessionBeforeDisk.messages
          : [];

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
        if (storeSessionBeforeDisk?.messages) {
          messages = storeSessionBeforeDisk.messages;
        }
      }
    }

    // When not streaming, check disk for messages the frontend may be missing.
    // The in-memory Redux state can become stale when the backend persists messages
    // directly (e.g., sub-agent delegation, subscription wake-ups) without the
    // frontend ever receiving them via IPC events.
    // We use persistenceService.loadSession with bypassCache (a fresh disk read
    // with no Redux side effects) rather than restoreSession which
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
            // Check if disk has messages the frontend is missing or richer copies
            // of same-ID messages. Completed child agents can persist the final
            // assistant response while Redux still holds an empty/stale placeholder
            // with the same ID, so ID-only reconciliation is insufficient.
            const inMemoryById = new Map(messages.map((m) => [m.id, m]));
            const missingFromDisk = diskSession.messages.filter((m) => !inMemoryById.has(m.id));
            const richerFromDisk = diskSession.messages.filter((m) => {
              const inMemory = inMemoryById.get(m.id);
              return inMemory ? isDiskMessageRicher(inMemory, m) : false;
            });
            if (missingFromDisk.length > 0 || richerFromDisk.length > 0) {
              logger.info('Merging disk messages missing from in-memory state', {
                agentId,
                inMemoryCount: messages.length,
                diskCount: diskSession.messages.length,
                missingCount: missingFromDisk.length,
                richerCount: richerFromDisk.length,
              });
              // Use disk message order as canonical, then append any in-memory-only
              // messages (e.g., optimistic sends not yet persisted to disk)
              const diskIds = new Set(diskSession.messages.map((m) => m.id));
              const inMemoryOnly = messages.filter((m) => !diskIds.has(m.id));
              messages = [
                ...diskSession.messages.map((diskMessage) => {
                  const inMemory = inMemoryById.get(diskMessage.id);
                  return inMemory && !isDiskMessageRicher(inMemory, diskMessage)
                    ? inMemory
                    : diskMessage;
                }),
                ...inMemoryOnly,
              ];
              session = { ...session, messages };
            }
          }
        }
      } catch (err) {
        logger.warn('Failed to load messages from disk for merge', { agentId, error: err });
      }
    }

    // Step 3: Determine streaming state
    let isCurrentlyStreaming = session?.isStreaming || false;
    // Fresh store snapshot after disk load preserves late streaming-state changes during async IO.
    const storeSessionAfterDisk: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
    if (storeSessionAfterDisk?.isStreaming) {
      isCurrentlyStreaming = true;
    }
    if (hasActiveStream && !isCurrentlyStreaming) {
      isCurrentlyStreaming = true;
    }
    // Fallback: if the initial spec-writer is actively writing, we know the
    // agent IS streaming even if bulkUpsertSessions clobbered the flag with
    // stale disk data before we could read it.
    if (!isCurrentlyStreaming) {
      const specWriteInProgress: boolean = yield* selectIsInitialSpecWriteInProgress.effect(wsId);
      if (specWriteInProgress) {
        isCurrentlyStreaming = true;
      }
    }

    // Step 4: Read fresh chat-state metadata after async disk load.
    // Streaming text is derived from agent-session messages by
    // selectAgentSessionStreamingContent, not stored in chat-state.
    const freshChatState = yield* selectChatStateOrDefault.effect(agentId);
    // Step 5: Deduplicate messages
    let deduplicatedMessages = deduplicateMessages(messages);

    // Step 5b: Reconcile stale streaming state left over from a previous
    // app run or crash. Without this, a session persisted with
    // `isStreaming: true` and a trailing unresolved `tool_use` (e.g. when
    // the app was closed mid-stream after the model emitted a tool call but
    // before the result came back) would leave the chat UI stuck in
    // "Thinking" forever, since the streaming flag and the orphaned tool
    // call both feed into `selectAgentIsResponding`.
    const activeBackendStreamIds = hasPersistedStreamingSignal(session, deduplicatedMessages)
      ? yield* call(getActiveStreamAgentIds)
      : null;
    const backendConfirmsActiveStream = activeBackendStreamIds?.has(agentId) === true;
    if (backendConfirmsActiveStream) {
      session = {
        ...session,
        isStreaming: true,
        isProcessing: true,
        isResponding: true,
      };
      isCurrentlyStreaming = true;
    } else {
      const staleReconciliation = reconcileStaleStreamingState(session, deduplicatedMessages);
      if (staleReconciliation.reconciled) {
        session = staleReconciliation.session;
        deduplicatedMessages = staleReconciliation.messages;
        isCurrentlyStreaming = false;
      }
    }

    // Step 6: Compute lastAttemptedMessage for retry support
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

    // Step 7: Upsert session data into agent-session slice
    const normalizedSession = session
      ? { ...session, isStreaming: session.isStreaming ?? false, messages: deduplicatedMessages }
      : null;

    if (normalizedSession) {
      yield* put(upsertSession(normalizedSession));
    } else if (deduplicatedMessages.length > 0) {
      yield* put(replaceMessages(agentId, deduplicatedMessages));
    }

    // Step 7b: Request backend-owned queue hydration, then dispatch chatInitialized to Redux (streaming/UI flags only)
    yield* put(hydrateAgentQueueRequested(agentId));

    yield* put(
      chatInitialized(agentId, {
        isStreaming: isCurrentlyStreaming,
        lastAttemptedMessage: effectiveLastAttempted,
      }),
    );

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

  yield* takeEvery(sendInitialMessageRequested, handleSendInitialMessage);

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

/**
 * Agent IPC Saga
 *
 * Manages IPC listeners for agent lifecycle events via redux-saga eventChannels.
 * Replaces setupEventListeners(), setupBeforeUnloadHandler(), and
 * scheduleBackendStreamReconnect() from AgentService.
 */

import { agentService } from "$features/agent/agent-ipc-bridge";
import { persistenceService } from "$features/agent/browser";
import { createLogger } from "$lib/utils/client-logger";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import { END, eventChannel } from "redux-saga";
import { call, delay, fork, put, select, take, takeLatest, type SagaGenerator } from "typed-redux-saga";
import type { ElectronEventName } from "$shared/ipc-registry";
import type { AgentMessage, AgentSession } from "$shared/types";
import { AgentStatus } from "$shared/types";
import { DEFAULT_AGENT_MODEL } from "$shared/constants/agent-services";
import { AgentId, WorkspaceId } from "$shared/types/branded-ids";
import { createAppMessageId } from "$shared/utils/app-message-id";
import {
  upsertAgentSession,
  setAgentStreaming,
  addAgentMessage,
  removeAgentMessage,
  replaceAgentMessageById,
  updateAgentMessage,
  recordAgentCreatedEvent,
  cleanupAgentCreatedEvents,
  triggerBackendStreamReconnect,
} from "../workspace-agents-slice";
import { streamCompleted } from "../../chat-state/chat-state-slice";
import type { AgentIdlePayload } from "$features/events/types";
import {
  selectAgentById,
  selectDiskMessageCount,
  selectRecentAgentCreatedEvent,
  selectRecentAgentCreatedEventsCount,
} from "../workspace-agents-selectors";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  upsertSession as upsertAgentSessionAction,
  addMessage as addAgentSessionMessage,
  removeMessage as removeAgentSessionMessage,
  replaceMessageById as replaceAgentSessionMessageById,
  computeMessageContentHash,
  hasCanonicalId,
  isTimestampClose,
} from "../../agent-session/agent-session-slice";
import { selectAllAgentSessions } from "../../agent-session/agent-session-selectors";
import { dispatchAgentSessionUpdated } from "$lib/utils/window-events";

const logger = createLogger("AgentIpcSaga");
const AGENT_CREATED_DEDUP_WINDOW = 500; // ms

/** Cast dynamic channel names to ElectronEventName */
function ec(name: string): ElectronEventName {
  return name as ElectronEventName;
}

// ============================================================================
// 1. agent:stream:disconnected
// ============================================================================

/** Exported for testing */
export function* handleStreamDisconnected(data: { agentId: string }): SagaGenerator<void> {
  logger.warn("Stream disconnected", { agentId: data.agentId });
  const session: AgentSession | undefined = yield* select(selectAgentById.select, data.agentId);
  if (!session) return;
  // Only write to the workspace that owns the session. Previously we fell
  // back to selectActiveWorkspaceId when session.workspaceId was missing,
  // which could land stale flags in a workspace the agent doesn't belong to.
  if (!session.workspaceId) {
    logger.warn("Cannot clear streaming state: session has no workspaceId", {
      agentId: data.agentId,
    });
    return;
  }
  yield* put(setAgentStreaming(session.workspaceId, session.id, false));
}

export function* watchStreamDisconnectedSaga() {
  yield* takeEveryFromElectronChannel<{ agentId: string }>(
    ec("agent:stream:disconnected"),
    function* (data) {
      yield* call(handleStreamDisconnected, data);
    },
  );
}

// ============================================================================
// 1b. agent:idle — reconcile stale streaming flags
//
// The session-level `isStreaming`/`isProcessing` flags and per-message
// `isStreaming` flags are normally cleared by ChatService when it receives
// the per-stream `complete` event on `agent:stream:${sessionId}`. That path
// only fires for agents whose chat panel has registered a stream handler.
// Delegated/background agents that never had a chat handler attached — or
// agents whose `complete` event was lost due to a congested IPC pipe — end
// up stuck with `isStreaming: true`, which causes the agent overview to
// keep rendering them as "responding" indefinitely.
//
// `agent:idle` is the backend's authoritative "this turn is done" signal.
// Treat it as a reconciliation point: clear the stale flags on the session
// and on any in-flight assistant messages.
// ============================================================================

/** Exported for testing */
export function* handleAgentIdle(data: AgentIdlePayload): SagaGenerator<void> {
  const agentId = data?.agentId;
  if (!agentId) return;

  const session: AgentSession | undefined = yield* selectAgentById.effect(agentId);
  if (!session) return;

  // Prefer the session's own workspaceId so we never write to an unrelated
  // workspace if the event payload's workspaceId is missing or stale.
  const wsId = session.workspaceId || data.workspaceId;
  if (!wsId) {
    logger.warn("Cannot reconcile streaming state on agent:idle: no workspaceId", { agentId });
    return;
  }

  // Detect stale state. Only dispatch reconciling actions if there's
  // actually something to clean up. This keeps this handler as a strict
  // fallback: when ChatService has already processed the per-stream
  // `complete` event (the healthy path), there is nothing to do here and
  // we avoid redundant dispatches that could otherwise race with a queued
  // message's freshly-starting stream on the same agent.
  let hasInFlightMessage = false;
  const inFlightMessages: AgentMessage[] = [];
  for (const message of session.messages || []) {
    if (message.role !== "assistant") continue;
    if (message.isStreaming || message.streamingComplete === false) {
      hasInFlightMessage = true;
      inFlightMessages.push(message);
    }
  }
  const sessionStuckStreaming = !!(session.isStreaming || session.isProcessing);
  if (!hasInFlightMessage && !sessionStuckStreaming) {
    return;
  }

  // Mark any in-flight assistant messages as no-longer-streaming.
  // getNodeStatus() in graph-helpers reads
  // `lastAssistantMsg.isStreaming || lastAssistantMsg.streamingComplete === false`,
  // so leaving these set keeps the overview's "responding" indicator on.
  for (const message of inFlightMessages) {
    yield* put(updateAgentMessage(wsId, agentId, message.id, {
      isStreaming: false,
      streamingComplete: true,
    }));
  }

  // Clear session-level isStreaming/isProcessing only if currently set.
  // The agent-session slice reduces `streamCompleted` by setting both flags
  // to false (single source of truth for the agent overview's status
  // computation).
  if (sessionStuckStreaming) {
    yield* put(streamCompleted(agentId, {
      lastAttemptedMessage: null,
      modelUnavailable: null,
    }));
  }
}

export function* watchAgentIdleSaga() {
  yield* takeEveryFromElectronChannel<AgentIdlePayload>(
    ec("agent:idle"),
    function* (data) {
      yield* call(handleAgentIdle, data);
    },
  );
}

// ============================================================================
// 2. agent:stream-starting — safety net for stream handler registration
// ============================================================================

export function* watchStreamStartingSaga() {
  yield* takeEveryFromElectronChannel<{ agentId: string; workspaceId?: string; assistantAppMessageId?: string }>(
    ec("agent:stream-starting"),
    function* (data) {
      yield* call(handleStreamStarting, data);
    },
  );
}

function* handleStreamStarting(data: { agentId: string; workspaceId?: string; assistantAppMessageId?: string }): SagaGenerator<void> {
  const { agentId, workspaceId, assistantAppMessageId } = data;
  logger.info("Backend stream starting notification received", { agentId, workspaceId });

  // Skip if sendMessage() is currently setting up the stream handler
  const isSettingUp: boolean = yield* call([agentService, agentService.isSendMessageSettingUpStream], agentId);
  if (isSettingUp) {
    logger.info("Skipping ensureStreamHandler — sendMessage is setting up stream handler", { agentId });
    return;
  }

  const result = yield* call([agentService, agentService.ensureStreamHandler], agentId, { workspaceId, assistantAppMessageId });
  if (result.created) {
    logger.info("Stream handler registered for starting stream", { agentId, channel: result.channel });
  }

  // Ensure a session exists before the first chunk arrives
  const wsId = workspaceId || ((yield* select(selectActiveWorkspaceId.select)) as string | undefined);
  if (!wsId) {
    logger.warn("Cannot look up session: no workspaceId available", { agentId });
    return;
  }
  const existing: AgentSession | undefined = yield* select(selectAgentById.select, agentId);
  if (!existing && workspaceId) {
    yield* call(loadAndCreateSessionFromPersistence, agentId, workspaceId, wsId);
  }
}

function* loadAndCreateSessionFromPersistence(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  agentId: string, workspaceId: string, wsId: string,
): SagaGenerator<void> {
  logger.warn("No session found for streaming agent, loading from persistence", { agentId, workspaceId });
  try {
    const loaded: AgentSession | null = yield* call(
      [persistenceService, persistenceService.loadSession], agentId, workspaceId,
    );
    const current: AgentSession | undefined = yield* select(selectAgentById.select, agentId);
    if (current) return; // session appeared while loading
    if (loaded) {
      if (workspaceId && !loaded.workspaceId) loaded.workspaceId = WorkspaceId(workspaceId);
      const targetWsId = workspaceId || loaded.workspaceId;
      if (!targetWsId) throw new Error(`Cannot start streaming session without workspaceId: ${agentId}`);
      yield* put(upsertAgentSessionAction(loaded));
      yield* put(upsertAgentSession(targetWsId, loaded));
      yield* put(setAgentStreaming(targetWsId, agentId, true));
      logger.info("Created session from persistence for streaming agent", { agentId, workspaceId });
    }
  } catch (err) {
    logger.error("Failed to load session from persistence", { agentId, error: err, workspaceId });
  }
}

// ============================================================================
// 3. agent:prepare-handler — backend-initiated agent handshake
// ============================================================================

export function* watchPrepareHandlerSaga() {
  yield* takeEveryFromElectronChannel<{
    agentId: string; workspaceId?: string;
    agentInfo?: { name?: string }; wakeMessage?: AgentMessage; assistantAppMessageId?: string;
  }>(
    ec("agent:prepare-handler"),
    function* (data) {
      const { agentId, workspaceId, wakeMessage, assistantAppMessageId } = data;
      logger.info("Backend requested stream handler preparation", { agentId, workspaceId });

      try {
        // When a wakeMessage is present (backend-initiated wake-up after delegation
        // completion), force a fresh stream handler. The previous turn's restored handler
        // may still be registered (its 'complete' handler resets buffers but does NOT call
        // cleanupStreamHandler). Reusing it causes ensureStreamHandler to return
        // { created: false } and skip the delayed agent:session-updated dispatch, leading
        // to timing mismatches between the IPC handler and ChatService that produce
        // duplicate assistant messages in the UI.
        // This matches the pattern used by watchQueueProcessingSaga.
        yield* call([agentService, agentService.ensureStreamHandler], agentId, {
          workspaceId,
          forceReregister: !!wakeMessage,
          assistantAppMessageId,
        });

        const prepareWsId = workspaceId || ((yield* select(selectActiveWorkspaceId.select)) as string | undefined);
        if (!prepareWsId) throw new Error(`Cannot prepare handler without workspaceId: ${agentId}`);

        const session: AgentSession | undefined = yield* select(selectAgentById.select, agentId);
        if (session) {
          if (wakeMessage) {
            yield* put(addAgentSessionMessage(agentId, wakeMessage));
            yield* put(addAgentMessage(prepareWsId, agentId, wakeMessage));
          }
          yield* put(setAgentStreaming(prepareWsId, agentId, true));
          if (typeof window !== "undefined") {
            dispatchAgentSessionUpdated(agentId);
          }
        }
      } catch (error) {
        logger.error("Error preparing stream handler", {
          agentId, workspaceId, error: error instanceof Error ? error.message : String(error),
        });
      }

      // Signal back — MUST execute unconditionally
      if (typeof window !== "undefined" && window.electronAPI) {
        window.electronAPI.send("agent:handler-ready", { agentId });
      }
    },
  );
}


// ============================================================================
// 4. agent:created — backend-created agent detection
// ============================================================================

export function* watchAgentCreatedIpcSaga() {
  yield* takeEveryFromElectronChannel<any>(
    ec("agent:created"),
    function* (data) {
      yield* call(handleAgentCreated, data);
    },
  );
}

/** Shape of agent:created IPC event data (may arrive as workspace event or direct event) */
interface AgentCreatedEventData {
  type?: string;
  workspaceId?: string;
  agentId?: string;
  agent?: Partial<AgentSession> & { messages?: AgentMessage[] };
  agentName?: string;
  data?: {
    agentId?: string;
    agent?: Partial<AgentSession> & { messages?: AgentMessage[] };
    agentName?: string;
  };
}

function* handleAgentCreated(data: AgentCreatedEventData): SagaGenerator<void> {
  const isWorkspaceEvent = data?.type === "agent:created" && !!data?.data;
  const agentId = isWorkspaceEvent ? data.data!.agentId : data?.agentId;
  const workspaceId = isWorkspaceEvent ? data.workspaceId : data?.workspaceId;
  const agent = isWorkspaceEvent ? data.data!.agent : data?.agent;
  const agentName = isWorkspaceEvent ? data.data!.agentName : agent?.name;

  if (!agentId) {
    if (!isWorkspaceEvent) {
      logger.warn("Received agent:created event with undefined agentId, ignoring", { workspaceId });
    }
    return;
  }

  // Deduplicate agent:created events
  const now = Date.now();
  const dedupWsId = workspaceId || ((yield* select(selectActiveWorkspaceId.select)) as string | undefined);
  if (dedupWsId) {
    const lastSeen: number | undefined = yield* select(selectRecentAgentCreatedEvent.select, dedupWsId, agentId);
    if (lastSeen && now - lastSeen < AGENT_CREATED_DEDUP_WINDOW) {
      logger.debug("Skipping duplicate agent:created event", { agentId });
      return;
    }
    yield* put(recordAgentCreatedEvent(dedupWsId, agentId, now));
    const eventCount: number = yield* select(selectRecentAgentCreatedEventsCount.select, dedupWsId);
    if (eventCount > 50) {
      yield* put(cleanupAgentCreatedEvents(dedupWsId, now - AGENT_CREATED_DEDUP_WINDOW * 2));
    }
  }

  logger.debug("Backend-created agent detected", { agentId, workspaceId, agentName: agentName || agent?.name });

  const wsIdForLookup = workspaceId || ((yield* select(selectActiveWorkspaceId.select)) as string | undefined);
  if (!wsIdForLookup) {
    logger.warn("Cannot look up session: no workspaceId available", { agentId });
    return;
  }

  const existingSession: AgentSession | undefined = yield* select(selectAgentById.select, agentId);

  if (existingSession) {
    yield* call(handleExistingSessionUpdate, existingSession, agent, agentId, workspaceId);
    yield* call([agentService, agentService.ensureStreamHandler], agentId, { workspaceId });
    return;
  }

  // Create a new session from agent data
  if (agent) {
    const hasHandler: boolean = yield* call([agentService, agentService.hasActiveStreamHandler], agentId);
    const newSession: AgentSession = {
      id: agentId as AgentId,
      backendSessionId: agentId as AgentId,
      workspaceId: (workspaceId || "") as WorkspaceId,
      name: agent.name || "Task Agent",
      status: "active" as typeof AgentStatus[keyof typeof AgentStatus],
      messages: agent.messages || [],
      model: agent.model || DEFAULT_AGENT_MODEL,
      provider: agent.provider,
      systemPrompt: agent.systemPrompt,
      createdAt: new Date(agent.createdAt || Date.now()),
      updatedAt: new Date(agent.updatedAt || Date.now()),
      isStreaming: hasHandler,
      isBackground: agent.isBackground || agent.metadata?.isBackground || false,
      metadata: agent.metadata,
    };
    const wsIdForNew = workspaceId || newSession.workspaceId;
    if (!wsIdForNew) throw new Error(`Cannot create session without workspaceId: ${agentId}`);
    yield* put(upsertAgentSessionAction(newSession));
    yield* put(upsertAgentSession(wsIdForNew, newSession));
  }

  yield* call([agentService, agentService.ensureStreamHandler], agentId, { workspaceId });
}

/** Exported for testing */
export function* handleExistingSessionUpdate(
  existingSession: AgentSession, agent: (Partial<AgentSession> & { messages?: AgentMessage[] }) | undefined, agentId: string, workspaceId?: string,
): SagaGenerator<void> {
  if (agent) {
    const updated: AgentSession = {
      ...existingSession,
      name: agent.name || existingSession.name,
      model: agent.model || existingSession.model,
      provider: agent.provider || existingSession.provider,
      systemPrompt: agent.systemPrompt || existingSession.systemPrompt,
      isBackground: agent.isBackground || agent.metadata?.isBackground || existingSession.isBackground || false,
      metadata: { ...existingSession.metadata, ...agent.metadata },
      isStreaming: existingSession.isStreaming,
    };
    const wsId = workspaceId || updated.workspaceId;
    if (wsId) {
      yield* put(upsertAgentSessionAction(updated));
      yield* put(upsertAgentSession(wsId, updated));
    }
  }

  if (agent?.messages) {
    const existingIds = new Set(existingSession.messages.map((m: AgentMessage) => m.id));

    // Build a content-hash index of local messages for content-match dedup.
    // Maps hash → list of indices in existingSession.messages (only non-canonical IDs).
    // Multiple messages may share the same hash (e.g. content-hash collisions),
    // so we track all candidates and pick the best match at replacement time.
    const localHashIndex = new Map<string, number[]>();
    for (let i = 0; i < existingSession.messages.length; i++) {
      const m = existingSession.messages[i];
      if (!hasCanonicalId(m.id)) {
        const hash = computeMessageContentHash(m);
        if (hash !== null) {
          const existing = localHashIndex.get(hash);
          if (existing) {
            existing.push(i);
          } else {
            localHashIndex.set(hash, [i]);
          }
        }
      }
    }

    for (const msg of agent.messages) {
      const wsId = workspaceId || existingSession.workspaceId;
      if (!wsId) continue;

      // Primary guard: exact ID match → skip (already have it)
      if (existingIds.has(msg.id)) continue;

      // Content-match guard: if the backend message has a canonical `msg_*` ID
      // and a local message matches by content+role+timestamp, replace the local
      // copy (to keep the canonical ID) rather than appending a duplicate.
      if (hasCanonicalId(msg.id)) {
        const hash = computeMessageContentHash(msg);
        const candidates = hash !== null ? localHashIndex.get(hash) : undefined;
        if (candidates && candidates.length > 0) {
          // Pick the candidate whose timestamp is closest to the canonical message.
          // This handles hash collisions where multiple local messages share
          // the same content hash — we match the one most likely to be the
          // same logical message.
          let bestIdx = -1;
          let bestDelta = Infinity;
          const msgTime = msg.timestamp ? new Date(msg.timestamp).getTime() : NaN;
          for (const idx of candidates) {
            const localMsg = existingSession.messages[idx];
            if (localMsg.role !== msg.role) continue;
            if (!isTimestampClose(localMsg.timestamp, msg.timestamp)) continue;
            const localTime = localMsg.timestamp ? new Date(localMsg.timestamp).getTime() : NaN;
            const delta = (!isNaN(msgTime) && !isNaN(localTime))
              ? Math.abs(msgTime - localTime)
              : 0; // missing timestamps → treat as zero delta (first eligible wins)
            if (delta < bestDelta) {
              bestDelta = delta;
              bestIdx = idx;
            }
          }
          if (bestIdx !== -1) {
            const localMsg = existingSession.messages[bestIdx];
            // Replace local copy in-place to preserve array position (no append-to-end).
            yield* put(replaceAgentSessionMessageById(agentId, localMsg.id, msg));
            yield* put(replaceAgentMessageById(wsId, agentId, localMsg.id, msg));
            // Remove the matched index from the candidates list so subsequent
            // messages don't re-match the same local message.
            const pos = candidates.indexOf(bestIdx);
            if (pos !== -1) candidates.splice(pos, 1);
            if (candidates.length === 0) localHashIndex.delete(hash!);
            // Track the canonical ID so a duplicate in the same batch is skipped.
            existingIds.add(msg.id);
            continue;
          }
        }
      }

      // No match → genuinely new message, append
      yield* put(addAgentSessionMessage(agentId, msg));
      yield* put(addAgentMessage(wsId, agentId, msg));
      // Keep batch-local tracking in sync so later messages in the same
      // batch don't re-process this one.
      existingIds.add(msg.id);
    }
  }
}

// ============================================================================
// 5. agent:queue:processing — queued message handling
// ============================================================================

const QUEUE_SESSION_RETRY_ATTEMPTS = 3;
const QUEUE_SESSION_RETRY_DELAY_MS = 200;

/** Exported for testing */
export type QueueProcessingData = {
  agentId: string; messageId: string; content: string;
  appMessageId?: string;
  assistantAppMessageId?: string;
  contextItems?: Array<{ id: string; type: string; label?: string; content?: string; path?: string }>;
};

export function* handleQueueProcessing(data: QueueProcessingData): SagaGenerator<void> {
  const { agentId, messageId, content, contextItems } = data;
  logger.debug("Queue processing event received", { agentId, messageId });

  // Retry session lookup — the session may still be loading
  let session: AgentSession | undefined;
  for (let attempt = 1; attempt <= QUEUE_SESSION_RETRY_ATTEMPTS; attempt++) {
    session = yield* select(selectAgentById.select, agentId);
    if (session) break;
    if (attempt < QUEUE_SESSION_RETRY_ATTEMPTS) {
      logger.debug("Session not found, retrying", { agentId, attempt, maxAttempts: QUEUE_SESSION_RETRY_ATTEMPTS });
      yield* delay(QUEUE_SESSION_RETRY_DELAY_MS);
    }
  }

  if (!session) {
    logger.error("No session found for queued message after retries — sending handler-ready so backend proceeds", {
      agentId, messageId, attempts: QUEUE_SESSION_RETRY_ATTEMPTS,
    });
    // Still signal backend so the message is at least persisted server-side
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.send("agent:handler-ready", { agentId });
    }
    return;
  }

  // Use session.workspaceId — the agent's workspace, not the currently-viewed one
  const wsId = session.workspaceId;
  if (!wsId) {
    logger.error("Session has no workspaceId for queued message — sending handler-ready so backend proceeds", { agentId, messageId });
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.send("agent:handler-ready", { agentId });
    }
    return;
  }

  // Add user message to session
  const userMessage: AgentMessage = {
    id: messageId,
    appMessageId: data.appMessageId ?? createAppMessageId(),
    role: "user",
    contentBlocks: [{ type: "text", text: content }],
    timestamp: new Date().toISOString(),
    metadata: { contextItems: contextItems || [] },
  };
  yield* put(addAgentSessionMessage(agentId, userMessage));
  yield* put(addAgentMessage(wsId, agentId, userMessage));

  // Set streaming state
  yield* put(setAgentStreaming(wsId, agentId, true));
  if (typeof window !== "undefined") {
    dispatchAgentSessionUpdated(agentId);
  }

  // Persist the queued user message immediately
  try {
    yield* call([agentService, agentService.saveSession], agentId, wsId, true);
  } catch (error) {
    logger.error("Failed to persist queued user message", { agentId, messageId, error });
  }

  // Re-register stream handler with forceReregister, but always signal backend
  // even if handler registration fails — otherwise the backend waits forever.
  try {
    yield* call([agentService, agentService.ensureStreamHandler], agentId, {
      forceReregister: true,
      assistantAppMessageId: data.assistantAppMessageId,
    });
  } catch (error) {
    logger.error("Failed to re-register stream handler for queued message", { agentId, messageId, error });
  } finally {
    // Signal backend we're ready
    if (typeof window !== "undefined" && window.electronAPI) {
      window.electronAPI.send("agent:handler-ready", { agentId });
    }
  }
}

export function* watchQueueProcessingSaga() {
  yield* takeEveryFromElectronChannel<QueueProcessingData>(
    ec("agent:queue:processing"),
    function* (data) {
      yield* call(handleQueueProcessing, data);
    },
  );
}

// ============================================================================
// 6. agent:queue:processing-cancelled — undo queue processing effects
// ============================================================================

export function* handleQueueCancelled(data: { agentId: string; messageId: string }): SagaGenerator<void> {
  const { agentId, messageId } = data;
  logger.warn("Queue processing cancelled, cleaning up", { agentId, messageId });

  // Look up the session to get its workspaceId — don't rely on the active workspace
  const session: AgentSession | undefined = yield* select(selectAgentById.select, agentId);

  // Always remove from agent-session state (only needs agentId + messageId)
  yield* put(removeAgentSessionMessage(agentId, messageId));

  // Remove from workspace-agents state if we can resolve a workspaceId
  // Fallback chain: session.workspaceId → activeWorkspaceId → skip cleanup with warning
  let wsId = session?.workspaceId;
  if (!wsId) {
    const activeWsId = yield* select(selectActiveWorkspaceId.select);
    if (activeWsId) {
      logger.info("Queue cancellation: using active workspace as fallback", { agentId, messageId, activeWsId });
      wsId = activeWsId;
    }
  }

  if (wsId) {
    yield* put(removeAgentMessage(wsId, agentId, messageId));
    try {
      yield* call([agentService, agentService.saveSession], agentId, wsId, true);
    } catch (error) {
      logger.error("Failed to persist queue cancellation cleanup", { agentId, error });
    }
  } else {
    logger.warn("No workspaceId available for queue cancellation — session message removed but workspace state may be stale", { agentId, messageId });
  }

  if (typeof window !== "undefined") {
    dispatchAgentSessionUpdated(agentId);
  }

  yield* call([agentService, agentService.clearPendingStreamRegistration], agentId);
}

export function* watchQueueCancelledSaga() {
  yield* takeEveryFromElectronChannel<{ agentId: string; messageId: string }>(
    ec("agent:queue:processing-cancelled"),
    function* (data) {
      yield* call(handleQueueCancelled, data);
    },
  );
}

// ============================================================================
// 7. beforeunload — save streaming sessions and flush pending deletions
// ============================================================================

function createBeforeUnloadChannel() {
  return eventChannel<"beforeunload">((emitter) => {
    if (typeof window === "undefined") { emitter(END as any); return () => {}; }
    const handler = () => emitter("beforeunload");
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  });
}

export function* watchBeforeUnloadSaga() {
  const channel = createBeforeUnloadChannel();
  try {
    while (true) {
      yield* take(channel);
      yield* call(handleBeforeUnload);
    }
  } finally {
    channel.close();
  }
}

function* handleBeforeUnload(): SagaGenerator<void> {
  logger.info("Page unloading — saving all streaming sessions to disk");

  const streamingSessionIds = new Set<string>();

  const allSessions: AgentSession[] = yield* selectAllAgentSessions.effect();
  for (const session of allSessions) {
    if (session.isStreaming) {
      streamingSessionIds.add(session.id as string);
    }
  }

  for (const session of allSessions) {
    const isStreaming = streamingSessionIds.has(session.id as string);
    if ((!session.messages?.length && !isStreaming) || !session.workspaceId) continue;

    const hasStreamingMsg = session.messages?.some((m: AgentMessage) => m.role === "assistant" && m.isStreaming);
    if (!((hasStreamingMsg && isStreaming) || isStreaming)) continue;

    const diskCount = yield* selectDiskMessageCount.effect(
      session.workspaceId as string,
      session.id as string,
    );
    const msgCount = session.messages?.length ?? 0;
    if (diskCount > 0 && msgCount < diskCount) continue;

    // Fire and forget — beforeunload doesn't wait for async
    persistenceService.saveSession(session, session.workspaceId, { immediate: true }).catch((err) => {
      logger.warn("Failed to save streaming session on unload", { agentId: session.id, error: (err as Error)?.message });
    });
  }

  // Flush pending deletions
  const deletions = (yield* call(
    [agentService, agentService.extractPendingDeletions],
  )) as Array<{ agentId: string; workspaceId?: string }>;
  for (const { agentId, workspaceId } of deletions) {
    agentService.deleteSession(agentId, workspaceId).catch((err) => {
      logger.warn("Failed to flush deletion on unload", { agentId, error: (err as Error)?.message });
    });
  }
}

// ============================================================================
// 8. pagehide — dispose AgentService on actual page unload
// ============================================================================

function createPagehideChannel() {
  return eventChannel<PageTransitionEvent>((emitter) => {
    if (typeof window === "undefined") { emitter(END as any); return () => {}; }
    const handler = (event: PageTransitionEvent) => emitter(event);
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  });
}

export function* watchPagehideSaga() {
  const channel = createPagehideChannel();
  try {
    while (true) {
      const event: PageTransitionEvent = yield* take(channel);
      if (event.persisted) {
        logger.info("Page hidden but persisted (bfcache) — not disposing");
        continue;
      }
      logger.info("Page unloading (pagehide) — disposing AgentService");
      yield* call([agentService, agentService.dispose]);
    }
  } finally {
    channel.close();
  }
}

// ============================================================================
// 9. Backend stream reconnect — debounced via takeLatest + delay
// ============================================================================

function* handleBackendStreamReconnect(): SagaGenerator<void> {
  yield* delay(500);
  logger.info("Debounced reconnectToBackendStreams triggered");
  try {
    yield* call([agentService, agentService.reconnectToBackendStreams]);
  } catch (error) {
    logger.error("Failed to reconnect to backend streams", { error });
  }
}

export function* watchBackendStreamReconnectSaga() {
  yield* takeLatest(triggerBackendStreamReconnect, handleBackendStreamReconnect);
}

// ============================================================================
// Root saga
// ============================================================================

export function* agentIpcSaga() {
  if (typeof window === "undefined") return;

  yield* fork(watchStreamDisconnectedSaga);
  yield* fork(watchAgentIdleSaga);
  yield* fork(watchStreamStartingSaga);
  yield* fork(watchPrepareHandlerSaga);
  yield* fork(watchAgentCreatedIpcSaga);
  yield* fork(watchQueueProcessingSaga);
  yield* fork(watchQueueCancelledSaga);
  yield* fork(watchBeforeUnloadSaga);
  yield* fork(watchPagehideSaga);
  yield* fork(watchBackendStreamReconnectSaga);
}
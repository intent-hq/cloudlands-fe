/**
 * Agent IPC Saga
 *
 * Manages IPC listeners for agent lifecycle events via redux-saga eventChannels.
 * Replaces setupEventListeners(), setupBeforeUnloadHandler(), and
 * scheduleBackendStreamReconnect() from AgentService.
 */

import {
  clearPendingStreamRegistration,
  ensureStreamHandler,
  hasActiveStreamHandler,
  isSendMessageSettingUpStream,
} from '$features/agent/agent-stream-lifecycle';
import {
  agentIpcProxy,
  persistenceService,
} from '$features/agent/browser';
import { requestDeduplicator } from '$features/agent/browser/services/request-deduplicator.service';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { takeEveryFromElectronChannel } from '$store/renderer/utils/ipc-channel';
import { store as appStore } from '$store/renderer/store';
import {
  END,
  eventChannel,
  type Task,
} from 'redux-saga';
import {
  call,
  delay,
  fork,
  put,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { AgentMessage,
  AgentSession,
  Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
import {
  AGENT_BACKEND_CHANNELS,
  AGENT_CHANNELS,
} from '$shared/ipc/channels';
import {
  AgentId,
  WorkspaceId,
} from '$shared/types/branded-ids';
import { createAppMessageId } from '$shared/utils/app-message-id';
import { toast } from 'svelte-sonner';
import { track } from '$lib/services/analytics';
import { clearAgentUnread } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import {
  eventCollector,
  AgentEventType,
} from '$features/observability/event-collector-client';
import {
  commitPendingAgentDeletionRequested,
  deleteAgentSessionRequested,
  deleteAgentWithUndoRequested,
  flushPendingAgentDeletionsRequested,
  removeAgent,
  renameAgentSessionRequested,
  saveAgentSessionRequested,
  stopAgentSessionRequested,
  recordAgentCreatedEvent,
  cleanupAgentCreatedEvents,
  backendStreamsReconnectResultReceived,
  triggerBackendStreamReconnect,
  triggerStreamingSafetyCheck,
  undoAgentDeletionRequested,
  type BackendActiveStreamPayload,
} from '../workspace-agents-slice';
import {
  chatSendStarted,
  streamCompleted,
} from '../../chat-state/chat-state-slice';
import type { AgentIdlePayload } from '$features/events/types';
import {
  selectDiskMessageCount,
  selectRecentAgentCreatedEvent,
  selectRecentAgentCreatedEventsCount,
} from '../workspace-agents-selectors';
import {
  addMessage as addAgentSessionMessage,
  removeMessage,
  replaceMessageById as replaceAgentSessionMessageById,
  setAgentStreaming,
  computeMessageContentHash,
  hasCanonicalId,
  isTimestampClose,
  updateMessage,
  upsertSession,
} from '../../agent-session/agent-session-slice';
import { selectAllStreamingAgents } from '../../agent-session/agent-session-selectors';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';

const logger = createLogger('AgentIpcSaga');
const AGENT_CREATED_DEDUP_WINDOW = 500; // ms
const DELETE_UNDO_DURATION_MS = 15_000;

type BackendActiveStreamsResult = {
  success?: boolean;
  data?: BackendActiveStreamPayload[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBackendActiveStreamPayload(value: unknown): value is BackendActiveStreamPayload {
  return isRecord(value) && typeof value.agentId === 'string';
}

function normalizeBackendActiveStreamsResult(value: unknown): BackendActiveStreamsResult {
  if (!isRecord(value)) return {};
  return {
    success: typeof value.success === 'boolean' ? value.success : undefined,
    data:
      Array.isArray(value.data) && value.data.every(isBackendActiveStreamPayload)
        ? value.data
        : undefined,
  };
}

type PendingDeletion = {
  commitTask: Task;
  workspaceId: string;
  savedSession: AgentSession;
  toastId?: string | number;
};

const pendingDeletions = new Map<string, PendingDeletion>();

function cancelPendingDeletionCommit(pending: PendingDeletion): void {
  pending.commitTask.cancel();
}

function* commitPendingAgentDeletionAfterUndoWindow(
  wsId: string,
  agentId: string,
): SagaGenerator<void> {
  yield* delay(DELETE_UNDO_DURATION_MS);
  yield* put(commitPendingAgentDeletionRequested(wsId, agentId));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildWorkspaceForAgentDelete(wsId: string): Workspace {
  return {
    id: wsId,
    title: '',
    branch: '',
    status: 'active',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Workspace;
}

function extractPendingAgentDeletions(
  wsId?: string,
): Array<{ agentId: string; workspaceId: string }> {
  const deletions: Array<{ agentId: string; workspaceId: string }> = [];
  for (const [agentId, pending] of [...pendingDeletions.entries()]) {
    if (wsId && pending.workspaceId !== wsId) continue;
    cancelPendingDeletionCommit(pending);
    pendingDeletions.delete(agentId);
    deletions.push({ agentId, workspaceId: pending.workspaceId });
  }
  return deletions;
}

function resetAgentLifecycleRuntime(): void {
  for (const [, pending] of pendingDeletions.entries()) {
    cancelPendingDeletionCommit(pending);
  }
  pendingDeletions.clear();
}

async function deleteAgentBackend(agentId: string, wsId: string): Promise<void> {
  await agentIpcProxy.deleteAgent(agentId, buildWorkspaceForAgentDelete(wsId));
}

function* persistAgentSessionFromState(
  wsId: string,
  agentId: string,
  immediate = false,
  options?: { allowTruncation?: boolean },
): SagaGenerator<void> {
  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  if (!session) {
    logger.warn('Cannot save session - session not found', { agentId, wsId });
    return;
  }
  if (!session.messages?.length && (session.isProcessing || session.isStreaming)) {
    logger.error('Refusing to save session with no messages while processing/streaming', {
      agentId,
      wsId,
    });
    return;
  }
  yield* call([persistenceService, persistenceService.saveSession], session, wsId, {
    immediate,
    allowTruncation: options?.allowTruncation,
  });
}

function* stopAgentSessionRuntime(wsId: string, agentId: string): SagaGenerator<void> {
  yield* call([requestDeduplicator, requestDeduplicator.clearKeysForAgent], agentId);
  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  if (!session?.id) return;

  const sessionWsId = session.workspaceId || wsId;
  if (!sessionWsId) {
    logger.warn('Cannot stop session without workspaceId', { agentId });
    return;
  }

  yield* put(setAgentStreaming(session.id, false));
  const response = yield* call(invoke<any>, AGENT_BACKEND_CHANNELS.STOP, {
    agentId,
    sessionId: session.id,
  });
  if (response && typeof response === 'object' && 'success' in response && !response.success) {
    throw new Error(response.error?.message || 'Failed to stop session');
  }
  track('Stopped Agent', {
    agent_id: agentId,
    workspace_id: sessionWsId,
    agent_name: session.name,
    agent_model: session.model,
  });
}

function* softDeleteAgentSession(
  wsId: string,
  agentId: string,
): SagaGenerator<AgentSession | null> {
  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  if (!session) return null;
  const sessionWsId = session.workspaceId || wsId;
  if (!sessionWsId) throw new Error(`Cannot soft delete session without workspaceId: ${agentId}`);

  yield* call(stopAgentSessionRuntime, sessionWsId, agentId);
  yield* put(removeAgent(sessionWsId, agentId));
  yield* put(clearAgentUnread(agentId));
  eventCollector.track(AgentEventType.SESSION_DELETED, {
    agentId,
    workspaceId: sessionWsId,
    isSoftDelete: true,
  });
  return session;
}

function* deleteAgentSessionPermanently(wsId: string, agentId: string): SagaGenerator<void> {
  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  const sessionWsId = session?.workspaceId || wsId;
  if (!sessionWsId) throw new Error(`Cannot delete session without workspaceId: ${agentId}`);

  if (session) {
    yield* call(stopAgentSessionRuntime, sessionWsId, agentId);
  }
  yield* call(deleteAgentBackend, agentId, sessionWsId);
  if (session) {
    yield* put(removeAgent(sessionWsId, agentId));
  }
  yield* put(clearAgentUnread(agentId));
  eventCollector.track(AgentEventType.SESSION_DELETED, {
    agentId,
    workspaceId: sessionWsId,
  });
}

export function* handleSaveAgentSessionRequested(
  action: ReturnType<typeof saveAgentSessionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId, immediate = false, options] = action.payload;
  try {
    yield* call(persistAgentSessionFromState, wsId, agentId, immediate, options);
    yield* put(action.success(undefined as void));
  } catch (error) {
    logger.error('Failed to save session', { wsId, agentId, error });
    yield* put(action.failure(getErrorMessage(error)));
  }
}

export function* handleRenameAgentSessionRequested(
  action: ReturnType<typeof renameAgentSessionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId, name] = action.payload;
  const trimmed = name.trim();
  try {
    if (!trimmed) {
      logger.warn('renameAgentSessionRequested: refusing empty name', { agentId, wsId });
      yield* put(action.success(undefined as void));
      return;
    }
    yield* call(invoke, AGENT_CHANNELS.RENAME, { agentId, workspaceId: wsId, name: trimmed });
    yield* put(action.success(undefined as void));
  } catch (error) {
    logger.error('renameAgentSessionRequested failed', { agentId, wsId, error });
    yield* put(action.failure(getErrorMessage(error)));
  }
}

export function* handleStopAgentSessionRequested(
  action: ReturnType<typeof stopAgentSessionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  try {
    yield* call(stopAgentSessionRuntime, wsId, agentId);
    yield* put(action.success(undefined as void));
  } catch (error) {
    logger.error('Failed to stop session', { wsId, agentId, error });
    yield* put(action.failure(getErrorMessage(error)));
  }
}

export function* handleDeleteAgentSessionRequested(
  action: ReturnType<typeof deleteAgentSessionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  try {
    yield* call(deleteAgentSessionPermanently, wsId, agentId);
    yield* put(action.success(undefined as void));
  } catch (error) {
    logger.error('Failed to delete session', { wsId, agentId, error });
    yield* put(action.failure(getErrorMessage(error)));
  }
}

export function* handleDeleteAgentWithUndoRequested(
  action: ReturnType<typeof deleteAgentWithUndoRequested>,
): SagaGenerator<void> {
  const [wsId, agentId, agentName] = action.payload;
  try {
    const saved = yield* call(softDeleteAgentSession, wsId, agentId);
    if (!saved) {
      yield* call(deleteAgentSessionPermanently, wsId, agentId);
      yield* put(action.success(null));
      return;
    }

    const displayName = agentName || saved.name || '';
    const toastId = toast.warning(displayName ? `Deleted "${displayName}"` : 'Agent deleted', {
      duration: DELETE_UNDO_DURATION_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          appStore.dispatch(undoAgentDeletionRequested(wsId, agentId));
        },
      },
    }) as string | number;

    const existing = pendingDeletions.get(agentId);
    if (existing) cancelPendingDeletionCommit(existing);
    const commitTask = yield* fork(commitPendingAgentDeletionAfterUndoWindow, wsId, agentId);
    pendingDeletions.set(agentId, { commitTask, workspaceId: wsId, savedSession: saved, toastId });
    yield* put(action.success(saved));
  } catch (error) {
    logger.error('Failed to delete session with undo', { wsId, agentId, error });
    yield* put(action.failure(getErrorMessage(error)));
  }
}

export function* handleUndoAgentDeletionRequested(
  action: ReturnType<typeof undoAgentDeletionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  try {
    const pending = pendingDeletions.get(agentId);
    if (!pending || pending.workspaceId !== wsId) {
      yield* put(action.success(false));
      return;
    }
    cancelPendingDeletionCommit(pending);
    pendingDeletions.delete(agentId);
    yield* put(
      upsertSession({
        ...pending.savedSession,
        workspaceId: wsId as AgentSession['workspaceId'],
      }),
    );
    if (pending.toastId !== undefined) toast.dismiss(pending.toastId);
    yield* put(action.success(true));
  } catch (error) {
    logger.error('Failed to undo agent deletion', { wsId, agentId, error });
    yield* put(action.failure(getErrorMessage(error)));
  }
}

export function* handleCommitPendingAgentDeletionRequested(
  action: ReturnType<typeof commitPendingAgentDeletionRequested>,
): SagaGenerator<void> {
  const [wsId, agentId] = action.payload;
  const pending = pendingDeletions.get(agentId);
  if (!pending || pending.workspaceId !== wsId) return;
  cancelPendingDeletionCommit(pending);
  pendingDeletions.delete(agentId);
  try {
    yield* call(deleteAgentSessionPermanently, wsId, agentId);
  } catch (error) {
    logger.error('Failed to permanently delete pending agent', { wsId, agentId, error });
  }
}

export function* handleFlushPendingAgentDeletionsRequested(
  action: ReturnType<typeof flushPendingAgentDeletionsRequested>,
): SagaGenerator<void> {
  const [wsId] = action.payload;
  try {
    const deletions = extractPendingAgentDeletions(wsId);
    for (const { agentId, workspaceId } of deletions) {
      yield* call(deleteAgentSessionPermanently, workspaceId, agentId);
    }
    yield* put(action.success(undefined as void));
  } catch (error) {
    logger.error('Failed to flush pending deletions', { wsId, error });
    yield* put(action.failure(getErrorMessage(error)));
  }
}

// ============================================================================
// 1. agent:idle — reconcile stale streaming flags
//
// The session-level `isStreaming`/`isProcessing` flags and per-message
// `isStreaming` flags are normally cleared by stream sagas when they receive
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

  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  if (!session) return;

  // Prefer the session's own workspaceId so we never write to an unrelated
  // workspace if the event payload's workspaceId is missing or stale.
  const wsId = session.workspaceId || data.workspaceId;
  if (!wsId) {
    logger.warn('Cannot reconcile streaming state on agent:idle: no workspaceId', { agentId });
    return;
  }

  // Detect stale state. Only dispatch reconciling actions if there's
  // actually something to clean up. This keeps this handler as a strict
  // fallback: when stream sagas have already processed the per-stream
  // `complete` event (the healthy path), there is nothing to do here and
  // we avoid redundant dispatches that could otherwise race with a queued
  // message's freshly-starting stream on the same agent.
  let hasInFlightMessage = false;
  const inFlightMessages: AgentMessage[] = [];
  for (const message of session.messages || []) {
    if (message.role !== 'assistant') continue;
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
    yield* put(
      updateMessage(agentId, message.id, {
        isStreaming: false,
        streamingComplete: true,
      }),
    );
  }

  // Clear session-level isStreaming/isProcessing only if currently set.
  // The agent-session slice reduces `streamCompleted` by setting both flags
  // to false (single source of truth for the agent overview's status
  // computation).
  if (sessionStuckStreaming) {
    yield* put(
      streamCompleted(agentId, {
        lastAttemptedMessage: null,
        modelUnavailable: null,
      }),
    );
  }
}

export function* watchAgentIdleSaga() {
  yield* takeEveryFromElectronChannel<AgentIdlePayload>('agent:idle', function* (data) {
    yield* call(handleAgentIdle, data);
  });
}

// ============================================================================
// 2. agent:stream-starting — safety net for stream handler registration
// ============================================================================

export function* watchStreamStartingSaga() {
  yield* takeEveryFromElectronChannel<{
    agentId: string;
    workspaceId?: string;
    assistantAppMessageId?: string;
  }>('agent:stream-starting', function* (data) {
    yield* call(handleStreamStarting, data);
  });
}

function* handleStreamStarting(data: {
  agentId: string;
  workspaceId?: string;
  assistantAppMessageId?: string;
}): SagaGenerator<void> {
  const { agentId, workspaceId, assistantAppMessageId } = data;
  logger.info('Backend stream starting notification received', { agentId, workspaceId });

  // Skip if sendMessage() is currently setting up the stream handler
  const isSettingUp: boolean = yield* call(isSendMessageSettingUpStream, agentId);
  if (isSettingUp) {
    logger.info('Skipping ensureStreamHandler — sendMessage is setting up stream handler', {
      agentId,
    });
    return;
  }

  const result = yield* call(ensureStreamHandler, agentId, { workspaceId, assistantAppMessageId });
  if (result.created) {
    logger.info('Stream handler registered for starting stream', {
      agentId,
      channel: result.channel,
    });
  }

  // Ensure a session exists before the first chunk arrives
  const wsId = workspaceId;
  if (!wsId) {
    logger.warn('Cannot look up session: no workspaceId available', { agentId });
    return;
  }
  const existing: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
  if (!existing && workspaceId) {
    yield* call(loadAndCreateSessionFromPersistence, agentId, workspaceId);
  }
}

function* loadAndCreateSessionFromPersistence(
  agentId: string,
  workspaceId: string,
): SagaGenerator<void> {
  logger.warn('No session found for streaming agent, loading from persistence', {
    agentId,
    workspaceId,
  });
  try {
    const loaded: AgentSession | null = yield* call(
      [persistenceService, persistenceService.loadSession],
      agentId,
      workspaceId,
    );
    const current: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
    if (current) return; // session appeared while loading
    if (loaded) {
      if (workspaceId && !loaded.workspaceId) loaded.workspaceId = WorkspaceId(workspaceId);
      const targetWsId = workspaceId || loaded.workspaceId;
      if (!targetWsId)
        throw new Error(`Cannot start streaming session without workspaceId: ${agentId}`);
      yield* put(
        upsertSession({
          ...loaded,
          workspaceId: targetWsId as AgentSession['workspaceId'],
        }),
      );
      yield* put(setAgentStreaming(agentId, true));
      logger.info('Created session from persistence for streaming agent', { agentId, workspaceId });
    }
  } catch (err) {
    logger.error('Failed to load session from persistence', { agentId, error: err, workspaceId });
  }
}

// ============================================================================
// 3. agent:prepare-handler — backend-initiated agent handshake
// ============================================================================

export function* watchPrepareHandlerSaga() {
  yield* takeEveryFromElectronChannel<{
    agentId: string;
    workspaceId?: string;
    agentInfo?: { name?: string };
    wakeMessage?: AgentMessage;
    assistantAppMessageId?: string;
  }>('agent:prepare-handler', function* (data) {
    const { agentId, workspaceId, wakeMessage, assistantAppMessageId } = data;
    logger.info('Backend requested stream handler preparation', { agentId, workspaceId });

    try {
      // When a wakeMessage is present (backend-initiated wake-up after delegation
      // completion), force a fresh stream handler. The previous turn's restored handler
      // may still be registered (its 'complete' handler resets buffers but does NOT call
      // cleanupStreamHandler). Reusing it causes ensureStreamHandler to return
      // { created: false }, leaving stale handler state that can produce duplicate
      // assistant messages in the UI.
      // This matches the pattern used by watchQueueProcessingSaga.
      yield* call(ensureStreamHandler, agentId, {
        workspaceId,
        forceReregister: !!wakeMessage,
        assistantAppMessageId,
      });

      const prepareWsId = workspaceId;
      if (!prepareWsId) throw new Error(`Cannot prepare handler without workspaceId: ${agentId}`);

      const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
      if (session) {
        if (wakeMessage) {
          yield* put(addAgentSessionMessage(agentId, wakeMessage));
        }
        yield* put(setAgentStreaming(agentId, true));
      }
    } catch (error) {
      logger.error('Error preparing stream handler', {
        agentId,
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Signal back — MUST execute unconditionally
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.send('agent:handler-ready', { agentId });
    }
  });
}

// ============================================================================
// 4. agent:created — backend-created agent detection
// ============================================================================

export function* watchAgentCreatedIpcSaga() {
  yield* takeEveryFromElectronChannel<any>('agent:created', function* (data) {
    yield* call(handleAgentCreated, data);
  });
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

export function* handleAgentCreated(data: AgentCreatedEventData): SagaGenerator<void> {
  const isWorkspaceEvent = data?.type === 'agent:created' && !!data?.data;
  const agentId = isWorkspaceEvent ? data.data!.agentId : data?.agentId;
  const workspaceId = isWorkspaceEvent ? data.workspaceId : data?.workspaceId;
  const agent = isWorkspaceEvent ? data.data!.agent : data?.agent;
  const agentName = isWorkspaceEvent ? data.data!.agentName : agent?.name;

  if (!agentId) {
    if (!isWorkspaceEvent) {
      logger.warn('Received agent:created event with undefined agentId, ignoring', { workspaceId });
    }
    return;
  }

  // Deduplicate agent:created events
  const now = Date.now();
  const dedupWsId = workspaceId;
  if (dedupWsId) {
    const lastSeen: number | undefined = yield* selectRecentAgentCreatedEvent.effect(
      dedupWsId,
      agentId,
    );
    if (lastSeen && now - lastSeen < AGENT_CREATED_DEDUP_WINDOW) {
      logger.debug('Skipping duplicate agent:created event', { agentId });
      return;
    }
    yield* put(recordAgentCreatedEvent(dedupWsId, agentId, now));
    const eventCount: number = yield* selectRecentAgentCreatedEventsCount.effect(dedupWsId);
    if (eventCount > 50) {
      yield* put(cleanupAgentCreatedEvents(dedupWsId, now - AGENT_CREATED_DEDUP_WINDOW * 2));
    }
  }

  logger.debug('Backend-created agent detected', {
    agentId,
    workspaceId,
    agentName: agentName || agent?.name,
  });

  const wsIdForLookup = workspaceId;
  if (!wsIdForLookup) {
    logger.warn('Cannot look up session: no workspaceId available', { agentId });
    return;
  }

  const existingSession: AgentSession | undefined = yield* selectAgentSession.effect(agentId);

  if (existingSession) {
    yield* call(handleExistingSessionUpdate, existingSession, agent, agentId, workspaceId);
    yield* call(ensureStreamHandler, agentId, { workspaceId });
    return;
  }

  // Create a new session from agent data
  if (agent) {
    const hasHandler: boolean = yield* call(hasActiveStreamHandler, agentId);
    const messages = agent.messages || [];
    const hasWorkSignal =
      hasHandler ||
      agent.isStreaming === true ||
      agent.isProcessing === true ||
      agent.isResponding === true ||
      messages.length > 0;
    const status =
      agent.status === AgentStatus.Active && !hasWorkSignal
        ? AgentStatus.Idle
        : agent.status || (hasHandler ? AgentStatus.Active : AgentStatus.Idle);
    const newSession: AgentSession = {
      id: agentId as AgentId,
      backendSessionId: agentId as AgentId,
      workspaceId: (workspaceId || '') as WorkspaceId,
      name: agent.name || 'Task Agent',
      status,
      messages,
      model: agent.model || DEFAULT_AGENT_MODEL,
      provider: agent.provider,
      systemPrompt: agent.systemPrompt,
      createdAt: new Date(agent.createdAt || Date.now()),
      updatedAt: new Date(agent.updatedAt || Date.now()),
      isStreaming: agent.isStreaming === true || hasHandler,
      isProcessing: agent.isProcessing === true,
      isResponding: agent.isResponding === true,
      isBackground: agent.isBackground || agent.metadata?.isBackground || false,
      metadata: agent.metadata,
    };
    const wsIdForNew = workspaceId || newSession.workspaceId;
    if (!wsIdForNew) throw new Error(`Cannot create session without workspaceId: ${agentId}`);
    yield* put(
      upsertSession({
        ...newSession,
        workspaceId: wsIdForNew as AgentSession['workspaceId'],
      }),
    );
  }

  yield* call(ensureStreamHandler, agentId, { workspaceId });
}

/** Exported for testing */
export function* handleExistingSessionUpdate(
  existingSession: AgentSession,
  agent: (Partial<AgentSession> & { messages?: AgentMessage[] }) | undefined,
  agentId: string,
  workspaceId?: string,
): SagaGenerator<void> {
  if (agent) {
    const updated: AgentSession = {
      ...existingSession,
      name: agent.name || existingSession.name,
      model: agent.model || existingSession.model,
      provider: agent.provider || existingSession.provider,
      systemPrompt: agent.systemPrompt || existingSession.systemPrompt,
      isBackground:
        agent.isBackground || agent.metadata?.isBackground || existingSession.isBackground || false,
      metadata: { ...existingSession.metadata, ...agent.metadata },
      isStreaming: existingSession.isStreaming,
    };
    const wsId = workspaceId || updated.workspaceId;
    if (wsId) {
      yield* put(
        upsertSession({
          ...updated,
          workspaceId: wsId as AgentSession['workspaceId'],
        }),
      );
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
            const delta = !isNaN(msgTime) && !isNaN(localTime) ? Math.abs(msgTime - localTime) : 0; // missing timestamps → treat as zero delta (first eligible wins)
            if (delta < bestDelta) {
              bestDelta = delta;
              bestIdx = idx;
            }
          }
          if (bestIdx !== -1) {
            const localMsg = existingSession.messages[bestIdx];
            // Replace local copy in-place to preserve array position (no append-to-end).
            yield* put(replaceAgentSessionMessageById(agentId, localMsg.id, msg));
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
  agentId: string;
  messageId: string;
  content: string;
  appMessageId?: string;
  assistantAppMessageId?: string;
  contextItems?: Array<{
    id: string;
    type: string;
    label?: string;
    content?: string;
    path?: string;
  }>;
};

export function* handleQueueProcessing(data: QueueProcessingData): SagaGenerator<void> {
  const { agentId, messageId, content, contextItems } = data;
  logger.debug('Queue processing event received', { agentId, messageId });

  // Retry session lookup — the session may still be loading
  let session: AgentSession | undefined;
  for (let attempt = 1; attempt <= QUEUE_SESSION_RETRY_ATTEMPTS; attempt++) {
    session = yield* selectAgentSession.effect(agentId);
    if (session) break;
    if (attempt < QUEUE_SESSION_RETRY_ATTEMPTS) {
      logger.debug('Session not found, retrying', {
        agentId,
        attempt,
        maxAttempts: QUEUE_SESSION_RETRY_ATTEMPTS,
      });
      yield* delay(QUEUE_SESSION_RETRY_DELAY_MS);
    }
  }

  if (!session) {
    logger.error(
      'No session found for queued message after retries — sending handler-ready so backend proceeds',
      {
        agentId,
        messageId,
        attempts: QUEUE_SESSION_RETRY_ATTEMPTS,
      },
    );
    // Still signal backend so the message is at least persisted server-side
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.send('agent:handler-ready', { agentId });
    }
    return;
  }

  // Use session.workspaceId — the agent's workspace, not the currently-viewed one
  const wsId = session.workspaceId;
  if (!wsId) {
    logger.error(
      'Session has no workspaceId for queued message — sending handler-ready so backend proceeds',
      { agentId, messageId },
    );
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.send('agent:handler-ready', { agentId });
    }
    return;
  }

  // Start the queued turn through the same canonical Redux transition as a
  // normal send. setAgentStreaming alone only flips one session flag; it does
  // not start chat-state timers/watchdogs or set isProcessing for completed
  // coordinator turns that were waiting for user input.
  yield* put(chatSendStarted(agentId, wsId));

  // Add user message to session
  const userMessage: AgentMessage = {
    id: messageId,
    appMessageId: data.appMessageId ?? createAppMessageId(),
    role: 'user',
    contentBlocks: [{ type: 'text', text: content }],
    timestamp: new Date().toISOString(),
    metadata: { contextItems: contextItems || [] },
  };
  yield* put(addAgentSessionMessage(agentId, userMessage));

  // Keep the existing session-level streaming signal for compatibility with
  // stream-handler setup paths; chatSendStarted owns the full turn-start state.
  yield* put(setAgentStreaming(agentId, true));

  // Persist the queued user message immediately
  try {
    yield* call(persistAgentSessionFromState, wsId, agentId, true);
  } catch (error) {
    logger.error('Failed to persist queued user message', { agentId, messageId, error });
  }

  // Re-register stream handler with forceReregister, but always signal backend
  // even if handler registration fails — otherwise the backend waits forever.
  try {
    yield* call(ensureStreamHandler, agentId, {
      forceReregister: true,
      assistantAppMessageId: data.assistantAppMessageId,
    });
  } catch (error) {
    logger.error('Failed to re-register stream handler for queued message', {
      agentId,
      messageId,
      error,
    });
  } finally {
    // Signal backend we're ready
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.send('agent:handler-ready', { agentId });
    }
  }
}

export function* watchQueueProcessingSaga() {
  yield* takeEveryFromElectronChannel<QueueProcessingData>(
    'agent:queue:processing',
    function* (data) {
      yield* call(handleQueueProcessing, data);
    },
  );
}

// ============================================================================
// 6. agent:queue:processing-cancelled — undo queue processing effects
// ============================================================================

export function* handleQueueCancelled(data: {
  agentId: string;
  messageId: string;
}): SagaGenerator<void> {
  const { agentId, messageId } = data;
  logger.warn('Queue processing cancelled, cleaning up', { agentId, messageId });

  // Look up the session to get its workspaceId — don't rely on the active workspace
  const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);

  // Always remove from agent-session state (only needs agentId + messageId)
  yield* put(removeMessage(agentId, messageId));

  // Persist cleanup only when the owning workspace is explicit. Do not fall back
  // to the active workspace; queue cancellation may arrive after the user has
  // switched workspaces.
  const wsId = session?.workspaceId;

  if (wsId) {
    try {
      yield* call(persistAgentSessionFromState, wsId, agentId, true);
    } catch (error) {
      logger.error('Failed to persist queue cancellation cleanup', { agentId, error });
    }
  } else {
    logger.warn(
      'No workspaceId available for queue cancellation — session message removed but workspace state may be stale',
      { agentId, messageId },
    );
  }

  yield* call(clearPendingStreamRegistration, agentId);
}

export function* watchQueueCancelledSaga() {
  yield* takeEveryFromElectronChannel<{ agentId: string; messageId: string }>(
    'agent:queue:processing-cancelled',
    function* (data) {
      yield* call(handleQueueCancelled, data);
    },
  );
}

// ============================================================================
// 7. beforeunload — save streaming sessions and flush pending deletions
// ============================================================================

function createBeforeUnloadChannel() {
  return eventChannel<'beforeunload'>((emitter) => {
    if (typeof window === 'undefined') {
      emitter(END as any);
      return () => {};
    }
    const handler = () => emitter('beforeunload');
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
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
  logger.info('Page unloading — saving all streaming sessions to disk');

  const streamingSessions: AgentSession[] = yield* selectAllStreamingAgents.effect();
  for (const session of streamingSessions) {
    if (!session.workspaceId) continue;

    const hasStreamingMsg = session.messages?.some(
      (m: AgentMessage) => m.role === 'assistant' && m.isStreaming,
    );
    if (!(hasStreamingMsg || session.isStreaming)) continue;

    const diskCount = yield* selectDiskMessageCount.effect(
      session.workspaceId as string,
      session.id as string,
    );
    const msgCount = session.messages?.length ?? 0;
    if (diskCount > 0 && msgCount < diskCount) continue;

    // Fire and forget — beforeunload doesn't wait for async
    persistenceService
      .saveSession(session, session.workspaceId, { immediate: true })
      .catch((err) => {
        logger.warn('Failed to save streaming session on unload', {
          agentId: session.id,
          error: (err as Error)?.message,
        });
      });
  }

  // Flush pending deletions
  const deletions = extractPendingAgentDeletions();
  for (const { agentId, workspaceId } of deletions) {
    deleteAgentBackend(agentId, workspaceId).catch((err) => {
      logger.warn('Failed to flush deletion on unload', {
        agentId,
        error: (err as Error)?.message,
      });
    });
  }
}

// ============================================================================
// 9. pagehide — dispose AgentService on actual page unload
// ============================================================================

function createPagehideChannel() {
  return eventChannel<PageTransitionEvent>((emitter) => {
    if (typeof window === 'undefined') {
      emitter(END as any);
      return () => {};
    }
    const handler = (event: PageTransitionEvent) => emitter(event);
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  });
}

export function* watchPagehideSaga() {
  const channel = createPagehideChannel();
  try {
    while (true) {
      const event: PageTransitionEvent = yield* take(channel);
      if (event.persisted) {
        logger.info('Page hidden but persisted (bfcache) — not disposing');
        continue;
      }
      logger.info('Page unloading (pagehide) — disposing AgentService');
      yield* call(resetAgentLifecycleRuntime);
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
  logger.info('Debounced backend stream reconnect triggered');

  if (typeof window === 'undefined' || !window.electronAPI) {
    logger.warn('electronAPI not available for reconnecting to backend streams');
    return;
  }

  try {
    logger.info('Querying backend for active streams...');
    const rawResult: unknown = yield* call(
      invoke,
      'agent:get-active-streams',
      undefined,
    );
    const result = normalizeBackendActiveStreamsResult(rawResult);
    const streams = result.success && Array.isArray(result.data) ? result.data : [];
    const activeStreamAgentIds = Array.from(new Set(streams.map((stream) => stream.agentId)));

    yield* put(backendStreamsReconnectResultReceived(streams));

    if (activeStreamAgentIds.length === 0) {
      logger.debug('No active streams found on backend', { result });
      return;
    }

    logger.info('Found active streams on backend', {
      count: activeStreamAgentIds.length,
      agentIds: activeStreamAgentIds,
    });

    yield* put(triggerStreamingSafetyCheck(activeStreamAgentIds));
  } catch (error) {
    logger.error('Failed to reconnect to backend streams', error as Error);
  }
}

export function* watchBackendStreamReconnectSaga() {
  yield* takeLatest(triggerBackendStreamReconnect, handleBackendStreamReconnect);
}

// ============================================================================
// Root saga
// ============================================================================

export function* agentIpcSaga() {
  if (typeof window === 'undefined') return;

  yield* takeEvery(saveAgentSessionRequested, handleSaveAgentSessionRequested);
  yield* takeEvery(renameAgentSessionRequested, handleRenameAgentSessionRequested);
  yield* takeEvery(stopAgentSessionRequested, handleStopAgentSessionRequested);
  yield* takeEvery(deleteAgentSessionRequested, handleDeleteAgentSessionRequested);
  yield* takeEvery(deleteAgentWithUndoRequested, handleDeleteAgentWithUndoRequested);
  yield* takeEvery(undoAgentDeletionRequested, handleUndoAgentDeletionRequested);
  yield* takeEvery(commitPendingAgentDeletionRequested, handleCommitPendingAgentDeletionRequested);
  yield* takeEvery(flushPendingAgentDeletionsRequested, handleFlushPendingAgentDeletionsRequested);
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

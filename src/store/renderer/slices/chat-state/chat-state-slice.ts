import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type {
  ChatAgentState,
  ChatStateSlice,
  StatusEvent,
  LastAttemptedMessage,
  ModelUnavailableInfo,
  QueuedRetryRecord,
  SendMessagePayload,
  InitializeChatOptions,
  StreamStatusContext,
} from './chat-state-types';
import { sanitizeStatusEvent } from './chat-state-serialization';
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from '../workspace-agents/workspace-agents-stream-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import {
  removeQueuedMessageFromAgentQueue,
  replaceAgentQueue,
} from '../agent-queue/agent-queue-slice';
import type { QueuedMessage } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

// ============================================================================
// Initial State
// ============================================================================

export const emptyChatAgentState: ChatAgentState = {
  agentId: '',
  isInterrupting: false,
  error: null,
  lastChunkTime: null,
  receivedFirstChunk: false,
  streamingStartTime: null,
  lastAttemptedMessage: null,
  queuedRetryRecords: {},
  modelUnavailable: null,
  statusEvents: [],
  trackedWorkspaceId: null,
  isRebinding: false,
  lastMessageTime: 0,
  lastChunkReceivedAt: 0,
};

export const initialState: ChatStateSlice = {
  byAgentId: {},
};

// ============================================================================
// Helpers
// ============================================================================

function getAgent(state: ChatStateSlice, agentId: string): ChatAgentState {
  return state.byAgentId[agentId] ?? emptyChatAgentState;
}

function setAgent(
  state: ChatStateSlice,
  agentId: string,
  agentState: ChatAgentState,
): ChatStateSlice {
  return {
    ...state,
    byAgentId: {
      ...state.byAgentId,
      [agentId]: agentState,
    },
  };
}

function updateAgent(
  state: ChatStateSlice,
  agentId: string,
  partial: Partial<ChatAgentState>,
): ChatStateSlice {
  const current = getAgent(state, agentId);
  return setAgent(state, agentId, { ...current, ...partial });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getModelUnavailableInfo(value: unknown): ModelUnavailableInfo | null {
  if (!isRecord(value) || !isRecord(value.metadata)) return null;
  const { metadata } = value;
  if (metadata.modelUnavailable !== true || typeof metadata.nextAvailableModel !== 'string') {
    return null;
  }
  return {
    failedModel: typeof metadata.failedModel === 'string' ? metadata.failedModel : '',
    nextAvailableModel: metadata.nextAvailableModel,
  };
}

/**
 * Preserve-on-failure predicate for the `agent:idle` reconcile finalize path
 * (#973), mirroring the clear-on-success semantics of the observed terminal
 * `complete` event (see reduceAgentStreamUpdate: cleared unless failureMessage
 * || modelUnavailable). A reconcile cannot observe how the missed turn ended, so
 * it reads the persisted flags instead: `error` set means the failure banner
 * is visible and its "Try again" still needs the record (#941); `modelUnavailable`
 * set means a "Retry with <model>" banner is pending (#964). Those two banners
 * are the record's only consumers — with neither flag set no UI can reach it,
 * so clearing is safe even if the missed turn actually failed (that failure
 * was missed too, so no banner is showing).
 */
function shouldPreserveLastAttemptedMessage(agent: ChatAgentState): boolean {
  return agent.error !== null || agent.modelUnavailable !== null;
}

/**
 * Finalize via `agent:idle` reconcile (#973): when the terminal stream
 * `complete` event was missed (window reload mid-turn, dropped subscription),
 * the successful turn is reconciled through `agent:idle` instead — previously
 * the only path that never cleared `lastAttemptedMessage`, leaving a
 * potentially MB-scale base64 payload (imageBlocks, #965) resident for the
 * app session.
 */
function reduceAgentIdleReconcile(state: ChatStateSlice, agentId: string): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  // agent:idle fires for every agent in subscribed workspaces; never
  // materialize a chat-state entry for a chat that was never opened.
  // NOTE: no queued-turn suppression is needed here — the daemon withholds
  // `agent:idle` while ready-to-send messages remain queued (#969), so an
  // observed idle always belongs to the finished turn.
  if (!agent) return state;
  if (agent.lastAttemptedMessage === null || shouldPreserveLastAttemptedMessage(agent)) {
    return state;
  }
  return updateAgent(state, agentId, { lastAttemptedMessage: null });
}

/**
 * Turn-scoped retry-record promotion (#999): when an `agent:queue:updated`
 * snapshot no longer contains a recorded id, the daemon has dequeued that
 * entry to run it (agent_manager.rs `try_drain_queue` publishes the shrunk
 * snapshot right after `dequeue_message`) — so its payload becomes the ACTIVE
 * turn's retry record. Promoting into `lastAttemptedMessage` means a failure
 * in the drained turn pairs "Try again" with the drained message instead of
 * the previous in-flight turn's already-succeeded payload (the #984 residual:
 * `agent:idle` is withheld while ready-to-send entries remain, so the stale
 * record was never success-cleared between turns). When several recorded ids
 * vanish in one snapshot (missed events), the LAST-enqueued of them is the
 * most recent turn — the per-record `seq` (a monotonic enqueue counter, see
 * QueuedRetryRecord) decides, because `Record` key iteration order is not
 * insertion order for integer-like keys.
 *
 * Queue-CLEAR flows (`agent.forceMessage` and `agent.editAndRegenerate`,
 * PROTOCOL §5.5 — both call `clear_queue` and publish an empty snapshot;
 * interrupt-priority ⌘Enter sends preserve the queue) also land here. The
 * cleared entries never run, so promotion must be SKIPPED for them: both
 * flows record their own `lastAttemptedMessage`, but Electron does not
 * guarantee ordering between the event channel and the RPC response, so a
 * late-arriving empty snapshot could otherwise clobber the fresh record
 * with a discarded entry's payload. The clear-queue signature — an EMPTY
 * incoming snapshot with more than one recorded id vanishing at once — is
 * distinguishable from a genuine drain, which removes exactly one entry per
 * cycle; on that signature the records are dropped without promotion.
 */
function reduceQueueSnapshotDiff(
  state: ChatStateSlice,
  agentId: string,
  queue: QueuedMessage[],
): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  if (!agent) return state;
  if (Object.keys(agent.queuedRetryRecords).length === 0) return state;
  const presentIds = new Set(queue.map((message) => message.id));
  let promoted: QueuedRetryRecord | null = null;
  let drainedCount = 0;
  const remaining: Record<string, QueuedRetryRecord> = {};
  for (const [id, parked] of Object.entries(agent.queuedRetryRecords)) {
    if (presentIds.has(id)) {
      remaining[id] = parked;
    } else {
      drainedCount += 1;
      if (promoted === null || parked.seq > promoted.seq) {
        promoted = parked;
      }
    }
  }
  if (promoted === null) return state;
  if (queue.length === 0 && drainedCount > 1) {
    return updateAgent(state, agentId, { queuedRetryRecords: remaining });
  }
  return updateAgent(state, agentId, {
    lastAttemptedMessage: promoted.record,
    queuedRetryRecords: remaining,
  });
}

/**
 * User-initiated queued-message removal (#999): the entry will never drain,
 * so its retry record is dropped WITHOUT promotion. The "Send now" replay
 * (send path with `queuedMessageId`) also flows through here first — its
 * direct lifecycle send then records its own `lastAttemptedMessage`.
 */
function reduceQueuedRecordRemoved(
  state: ChatStateSlice,
  agentId: string,
  messageId: string,
): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  if (!agent || !(messageId in agent.queuedRetryRecords)) return state;
  const remaining = { ...agent.queuedRetryRecords };
  delete remaining[messageId];
  return updateAgent(state, agentId, { queuedRetryRecords: remaining });
}

function getStreamFailureMessage(payload: AgentStreamUpdatePayload): string | null {
  if (payload.error) return payload.error;
  if (payload.eventType === 'timeout' || payload.finishReason === 'timeout') {
    return m.chat_state_timeout_error();
  }
  return null;
}

function reduceChunkReceived(
  state: ChatStateSlice,
  agentId: string,
  isTextChunk: boolean,
  timestamp: number,
): ChatStateSlice {
  if (!isTextChunk) {
    return updateAgent(state, agentId, {
      lastChunkTime: timestamp,
      lastChunkReceivedAt: timestamp,
    });
  }

  const agent = getAgent(state, agentId);
  return updateAgent(state, agentId, {
    lastChunkTime: timestamp,
    receivedFirstChunk: true,
    lastChunkReceivedAt: timestamp,
    statusEvents: !agent.receivedFirstChunk
      ? [
          ...agent.statusEvents,
          {
            phase: 'streaming',
            message: m.chat_state_streaming_status(),
            level: 'info' as const,
            timestamp,
          },
        ]
      : agent.statusEvents,
  });
}

function reduceAgentStreamUpdate(
  state: ChatStateSlice,
  payload: AgentStreamUpdatePayload,
): ChatStateSlice {
  const timestamp = payload.timestamp ?? 0;
  if (payload.eventType === 'started') {
    return updateAgent(state, payload.agentId, {
      error: null,
      modelUnavailable: null,
      lastChunkTime: timestamp,
      receivedFirstChunk: false,
      statusEvents: [],
    });
  }
  if (payload.eventType === 'chunk') {
    return reduceChunkReceived(state, payload.agentId, true, timestamp);
  }
  if (payload.eventType === 'content-blocks') {
    return reduceChunkReceived(state, payload.agentId, false, timestamp);
  }
  if (payload.eventType === 'complete' || payload.eventType === 'timeout') {
    const failureMessage = getStreamFailureMessage(payload);
    const modelUnavailable = getModelUnavailableInfo(payload.completeMessage);
    return updateAgent(state, payload.agentId, {
      streamingStartTime: null,
      lastChunkTime: null,
      receivedFirstChunk: false,
      statusEvents: [],
      // This terminal maps the daemon's `agent:stream:end`, which is
      // disposition-NEUTRAL (PROTOCOL §7: the complete/error payloads are
      // identical by design) — a failed turn ends its stream the same way and
      // only the follow-up lifecycle event carries the disposition
      // (`agent:idle` on success, `agent:failed` on error). Clearing the
      // retry payload here therefore raced ahead of the failure banner and
      // left "Try again" a no-op (#984). Preserve the record and defer the
      // success-clear to the `agent:idle` finalize (reduceAgentIdleReconcile,
      // whose error/modelUnavailable guards keep the #941/#964 preserve-on-
      // failure semantics). The one disposition this event DOES carry is the
      // user interrupt (`stopReason: "interrupted"`, §7.2) — clear the
      // abandoned payload inline here (#965), because the synthetic
      // post-interrupt `agent:idle` (agent_manager.rs interrupt_inner,
      // STAB-28) is SUPPRESSED when a ready-to-send queue exists or the
      // interrupt carries a message, so the idle finalize can't be relied on.
      // When the synthetic idle does arrive, its reconcile is a harmless
      // no-op on the already-cleared record.
      lastAttemptedMessage:
        !failureMessage && !modelUnavailable && payload.stopReason === 'interrupted'
          ? null
          : getAgent(state, payload.agentId).lastAttemptedMessage,
      modelUnavailable,
      error: failureMessage,
    });
  }
  if (payload.eventType === 'error') {
    return updateAgent(state, payload.agentId, {
      streamingStartTime: null,
      statusEvents: [],
      modelUnavailable: null,
      error: getStreamFailureMessage(payload) || m.chat_state_interrupted_error(),
    });
  }
  return state;
}

// ============================================================================
// Actions
// ============================================================================

/** Initialize chat session with loaded data (session/messages now live in agent-session slice) */
export const chatInitialized = createAction<
  [
    agentId: string,
    payload: {
      isStreaming: boolean;
      lastAttemptedMessage: LastAttemptedMessage | null;
    },
  ]
>('chatState/initialized');

/** Set error on chat init failure */
export const chatInitFailed =
  createAction<[agentId: string, error: string]>('chatState/initFailed');

/** Begin sending a message — sets processing/streaming flags */
export const chatSendStarted = createAction(
  'chatState/sendStarted',
  (agentId: string, wsId?: string, timestamp = Date.now()) => ({
    agentId,
    wsId,
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
  }),
);

/**
 * Record the exact message content a send attempt carried so the error
 * banner's "Try again" can resend it verbatim (#941). Dispatched by the
 * send paths (chat-send-service, edit-regenerate-service) alongside
 * `chatSendStarted`.
 */
export const chatLastAttemptedMessageSet = createAction<
  [agentId: string, lastAttemptedMessage: LastAttemptedMessage | null]
>('chatState/lastAttemptedMessageSet');

/**
 * Record a retry payload for a successfully daemon-queued send, keyed by the
 * returned QueuedMessage id (#999). The record stays parked until the queue
 * snapshot shows the entry drained (promotion into `lastAttemptedMessage`,
 * see reduceQueueSnapshotDiff) or removed (dropped). Dispatched by
 * chat-send-service's queue-on-send success branch.
 */
export const chatQueuedRetryRecordSet = createAction<
  [agentId: string, messageId: string, record: LastAttemptedMessage]
>('chatState/queuedRetryRecordSet');

/** Send failed (activation or network error) */
export const chatSendFailed =
  createAction<[agentId: string, error: string]>('chatState/sendFailed');

/** Agent was interrupted — clear streaming without error */
export const chatInterrupted = createAction<[agentId: string]>('chatState/interrupted');

/** Clear model unavailable info */
export const chatModelUnavailableCleared = createAction<[agentId: string]>(
  'chatState/modelUnavailableCleared',
);

/** Stop completed — clear all streaming/interrupt flags */
export const chatStopCompleted = createAction<[agentId: string]>('chatState/stopCompleted');

/** Reset chat to initial empty state (destroy) */
export const chatReset = createAction<[agentId: string]>('chatState/reset');

/** Reconcile streaming state when panel remounts */
export const chatStreamingReconciled = createAction(
  'chatState/streamingReconciled',
  (agentId: string) => ({ agentId, timestamp: Date.now() }),
);

// --- Streaming event actions ---

/** Stream completed — finalize streaming flags (messages now in agent-session) */
export const streamCompleted = createAction<
  [
    agentId: string,
    payload: {
      lastAttemptedMessage: LastAttemptedMessage | null;
      modelUnavailable: ModelUnavailableInfo | null;
    },
  ]
>('chatState/streamCompleted');

/** Status event received during streaming */
export const streamStatusReceived = createAction(
  'chatState/streamStatusReceived',
  (
    agentId: string,
    statusEvent: unknown,
    resetFirstChunk: boolean,
    context?: StreamStatusContext,
  ): [string, StatusEvent, boolean, StreamStatusContext?] => [
    agentId,
    sanitizeStatusEvent(statusEvent, Date.now()),
    resetFirstChunk,
    context,
  ],
);

/** Restore status events persisted by chat-state sagas during initialization */
export const chatStatusEventsHydrated = createAction<
  [agentId: string, statusEvents: StatusEvent[]]
>('chatState/statusEventsHydrated');

/** Stream timed out */
export const streamTimedOut = createAction<[agentId: string]>('chatState/streamTimedOut');

/** Clear error */
export const chatErrorCleared = createAction<[agentId: string]>('chatState/errorCleared');

/** Set isInterrupting flag (stop chat in progress) */
export const chatStopInitiated = createAction<[agentId: string]>('chatState/stopInitiated');

// --- Rebind tracking actions (managed by component $effect, read by sagas) ---

/** Mark workspace rebind as started (async initializeChat in flight) */
export const chatRebindStarted = createAction<[agentId: string]>('chatState/rebindStarted');

/** Mark workspace rebind as completed and record the tracked workspace ID */
export const chatRebindEnded = createAction<[agentId: string]>('chatState/rebindEnded');

/** Update tracked workspace ID (e.g. after recordMount or recordRebind) */
export const chatTrackedWorkspaceSet = createAction<[agentId: string, trackedWsId: string | null]>(
  'chatState/trackedWorkspaceSet',
);

// --- Transcript hydration tracking actions ---

/** Transcript load started for an agent */
export const transcriptHydrationStarted = createAction<[agentId: string]>(
  'chatState/transcriptHydrationStarted',
);

/** Transcript load completed (success or error) for an agent */
export const transcriptHydrationSettled = createAction<[agentId: string]>(
  'chatState/transcriptHydrationSettled',
);

// --- Initialize chat saga trigger (no reducer state change) ---

/** Trigger the initialize-chat saga. Dispatched from ChatPanel to start chat initialization. */
export const initializeChatRequested = createAction(
  'chatState/initializeChatRequested',
  (agentId: string, payload: { wsId: string; options?: InitializeChatOptions }) => ({
    agentId,
    ...payload,
  }),
);

// --- Send message saga trigger (no reducer state change) ---

/** Trigger the send-message saga. Dispatched from ChatPanel after DOM serialization. */
export const sendMessage = createAction(
  'chatState/sendMessage',
  (agentId: string, payload: SendMessagePayload & { wsId: string }) => ({ agentId, payload }),
);

// ============================================================================
// Reducer
// ============================================================================

export const chatStateReducer = createReducer<ChatStateSlice>(initialState)
  .with(chatInitialized, (state, { payload: [agentId, data] }) =>
    updateAgent(state, agentId, {
      agentId,
      error: null,
      lastAttemptedMessage: data.lastAttemptedMessage,
    }),
  )
  .with(chatInitFailed, (state, { payload: [agentId, error] }) =>
    updateAgent(state, agentId, { error, modelUnavailable: null }),
  )
  .with(chatSendStarted, (state, { payload: { agentId, timestamp } }) =>
    updateAgent(state, agentId, {
      error: null,
      modelUnavailable: null,
      streamingStartTime: timestamp,
      lastMessageTime: timestamp,
      lastChunkTime: null,
      receivedFirstChunk: false,
      statusEvents: [],
    }),
  )
  .with(chatLastAttemptedMessageSet, (state, { payload: [agentId, lastAttemptedMessage] }) =>
    updateAgent(state, agentId, { lastAttemptedMessage }),
  )
  .with(chatQueuedRetryRecordSet, (state, { payload: [agentId, messageId, record] }) => {
    const agent = getAgent(state, agentId);
    // Monotonic enqueue sequence: promotion order cannot rely on Record key
    // order (integer-like keys iterate first, breaking insertion order).
    const seq =
      Object.values(agent.queuedRetryRecords).reduce(
        (max, parked) => Math.max(max, parked.seq),
        0,
      ) + 1;
    return updateAgent(state, agentId, {
      agentId,
      queuedRetryRecords: { ...agent.queuedRetryRecords, [messageId]: { seq, record } },
    });
  })
  .with(replaceAgentQueue, (state, { payload: [agentId, messages] }) =>
    reduceQueueSnapshotDiff(state, agentId, messages),
  )
  .with(removeQueuedMessageFromAgentQueue, (state, { payload: [agentId, messageId] }) =>
    reduceQueuedRecordRemoved(state, agentId, messageId),
  )
  .with(chatSendFailed, (state, { payload: [agentId, error] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      error,
      modelUnavailable: null,
    }),
  )
  .with(chatInterrupted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
    }),
  )
  .with(chatModelUnavailableCleared, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { modelUnavailable: null }),
  )
  .with(chatErrorCleared, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { error: null }),
  )
  .with(chatStopInitiated, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isInterrupting: true }),
  )
  .with(chatStopCompleted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      isInterrupting: false,
      streamingStartTime: null,
    }),
  )
  .with(chatReset, (state, { payload: [agentId] }) =>
    setAgent(state, agentId, { ...emptyChatAgentState }),
  )
  .with(chatStreamingReconciled, (state, { payload: { agentId, timestamp } }) => {
    const agent = getAgent(state, agentId);
    // Only update the streamingStartTime (isProcessing/isStreaming are on agent-session now)
    if (!agent.streamingStartTime) {
      return updateAgent(state, agentId, {
        streamingStartTime: timestamp,
      });
    }
    return state;
  })
  .with(agentStreamUpdateReceived, (state, { payload: [payload] }) =>
    reduceAgentStreamUpdate(state, payload),
  )
  .with(streamCompleted, (state, { payload: [agentId, data] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      lastChunkTime: null,
      receivedFirstChunk: false,
      statusEvents: [],
      lastAttemptedMessage: data.lastAttemptedMessage,
      modelUnavailable: data.modelUnavailable,
    }),
  )
  .with(streamStatusReceived, (state, { payload: [agentId, statusEvent, resetFirstChunk] }) => {
    const agent = getAgent(state, agentId);
    return updateAgent(state, agentId, {
      statusEvents: [...agent.statusEvents, sanitizeStatusEvent(statusEvent)],
      receivedFirstChunk: resetFirstChunk ? false : agent.receivedFirstChunk,
    });
  })
  .with(chatStatusEventsHydrated, (state, { payload: [agentId, statusEvents] }) =>
    updateAgent(state, agentId, {
      agentId,
      statusEvents,
    }),
  )
  .with(streamTimedOut, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      error: m.chat_state_timeout_error(),
    }),
  )
  .with(chatRebindStarted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isRebinding: true }),
  )
  .with(chatRebindEnded, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isRebinding: false }),
  )
  .with(chatTrackedWorkspaceSet, (state, { payload: [agentId, trackedWsId] }) =>
    updateAgent(state, agentId, { trackedWorkspaceId: trackedWsId }),
  )
  .with(transcriptHydrationStarted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { agentId, transcriptHydration: 'loading' }),
  )
  .with(transcriptHydrationSettled, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { agentId, transcriptHydration: 'settled' }),
  )
  .with(eventReceived, (state, { payload: [, event] }) => {
    if (event.type !== 'agent:idle') return state;
    const data: unknown = event.data;
    if (!isRecord(data)) return state;
    // PROTOCOL.md: agent:idle always carries data.agentId.
    const agentId = data.agentId;
    if (typeof agentId !== 'string' || agentId.length === 0) return state;
    return reduceAgentIdleReconcile(state, agentId);
  })
  .with(workspaceDeleted, (state, { payload: [, agentIds] }) => {
    if (agentIds.length === 0) return state;
    let changed = false;
    const byAgentId: Record<string, ChatAgentState> = { ...state.byAgentId };
    for (const agentId of agentIds) {
      if (agentId in byAgentId) {
        delete byAgentId[agentId];
        changed = true;
      }
    }
    return changed ? { ...state, byAgentId } : state;
  });

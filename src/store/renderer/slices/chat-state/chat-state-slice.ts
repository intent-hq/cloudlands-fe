import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type {
  ChatAgentState,
  ChatStateSlice,
  StatusEvent,
  LastAttemptedMessage,
  LiveStreamPhase,
  QueuedRetryRecord,
  SendMessagePayload,
  InitializeChatOptions,
  StreamStatusContext,
} from './chat-state-types';
import { MAX_QUEUED_RETRY_RECORDS } from './chat-state-types';
import { sanitizeStatusEvent } from './chat-state-serialization';
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
  liveStreamPhase: null,
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

/**
 * Structural equality over serializable retry payloads (plain objects, arrays,
 * primitives — the only shapes Redux state may hold). Used by the parked-park
 * reducer to recognize the caller's own mid-turn `lastAttemptedMessage`
 * overwrite (#1011) without clobbering a concurrently recorded attempt.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    return (
      aKeys.length === Object.keys(b).length && aKeys.every((key) => deepEqual(a[key], b[key]))
    );
  }
  return false;
}

/**
 * Park a retry record under a queued-entry id with the next monotonic park
 * seq (eviction order cannot rely on Record key order — integer-like keys
 * iterate first, breaking insertion order; `seq` serves ONLY the cap
 * eviction below). Shared by the queue-on-send park (#999) and the lifecycle
 * auto-queue park (#1011). Bounded at MAX_QUEUED_RETRY_RECORDS (#973-family
 * memory): records stranded by missed events or per-agent deletion would
 * otherwise accumulate for the app session, each potentially carrying
 * MB-scale base64 imageBlocks — parking beyond the cap evicts the oldest
 * (lowest-seq) records first.
 */
function parkRetryRecord(
  agent: ChatAgentState,
  messageId: string,
  record: LastAttemptedMessage,
  turnId: string,
): Record<string, QueuedRetryRecord> {
  const seq =
    Object.values(agent.queuedRetryRecords).reduce(
      (max, parked) => Math.max(max, parked.seq),
      0,
    ) + 1;
  const parked: QueuedRetryRecord = { seq, record, turnId };
  const next = { ...agent.queuedRetryRecords, [messageId]: parked };
  const ids = Object.keys(next);
  if (ids.length > MAX_QUEUED_RETRY_RECORDS) {
    ids.sort((a, b) => next[a].seq - next[b].seq);
    for (const id of ids.slice(0, ids.length - MAX_QUEUED_RETRY_RECORDS)) {
      delete next[id];
    }
  }
  return next;
}

/**
 * Preserve-on-failure predicate for the `agent:idle` reconcile finalize path
 * (#973), mirroring the clear-on-success semantics of the observed terminal
 * stream-end event. A reconcile cannot observe how the missed turn ended, so
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
 *
 * Staleness guard: the daemon withholds `agent:idle` while ready-to-send
 * messages remain queued (#969), so an observed idle always belongs to the
 * finished turn DAEMON-side — but client-side transit delay means turn N's
 * idle can arrive AFTER send N+1 already re-set `lastAttemptedMessage`
 * (chatSendStarted cleared the error, so the preserve predicate can't help).
 * The idle's daemon-stamped `timestamp` predates that newer send's
 * `lastMessageTime` in exactly that case, so the finalize is skipped — the
 * newer turn's record must survive for its own failure banner. An
 * unparseable timestamp falls back to clearing (the pre-guard #973
 * semantics), and a fresh post-reload state has `lastMessageTime` 0, which
 * every idle postdates — the reload reconcile is preserved.
 *
 * Boundary/clock notes: the comparison is a strict `<`, so an idle stamped
 * in the SAME millisecond as the send still clears — the deliberate
 * tie-break direction, since the alternative (skipping on equality) would
 * strand an MB-scale payload for a sub-ms turn, and both failure modes here
 * lose a record rather than resend a wrong one. The two sides also come from
 * different clocks (`lastMessageTime` is renderer-stamped, the idle
 * `timestamp` daemon-stamped) — same host over UDS so skew is ~0, and a
 * backward system-clock step between send and idle merely suppresses one
 * finalize until the next postdating idle (self-healing, bounded to one
 * record).
 */
function reduceAgentIdleReconcile(
  state: ChatStateSlice,
  agentId: string,
  eventTimestamp: string,
): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  // agent:idle fires for every agent in subscribed workspaces; never
  // materialize a chat-state entry for a chat that was never opened.
  if (!agent) return state;
  if (agent.lastAttemptedMessage === null || shouldPreserveLastAttemptedMessage(agent)) {
    return state;
  }
  const idleTime = Date.parse(eventTimestamp);
  if (!Number.isNaN(idleTime) && idleTime < agent.lastMessageTime) {
    return state;
  }
  return updateAgent(state, agentId, { lastAttemptedMessage: null });
}

/**
 * Daemon-authoritative content sync for parked retry records (#1011): the
 * `agent:queue:updated` snapshot carries the current content of every queued
 * entry, so a parked record whose entry is still PRESENT syncs its text —
 * an edit is reflected even when the save's self-drain (agent idle at save,
 * STAB-27 release awaits the drain BEFORE the RPC response returns) promotes
 * the record before ChatPanel's post-response `chatQueuedRetryRecordUpdated`
 * can run. Also covers edits made from another client/window. Present-entry
 * matching is turnId-aware: a terminal-failure requeue mints a NEW entry id
 * but keeps the original turnId, so the requeued entry still counts as
 * "present" for its record.
 *
 * Promotion is NOT inferred from snapshots (monorepo#1057): the exact
 * drain-start signal is `agent:queue:processing` (or the
 * `agent.sendQueuedMessageNow` RPC response, which carries the turnId
 * instead of the event, §5.5) — see reduceQueueProcessing. A record whose
 * entry vanishes from the snapshot stays PARKED: promoting on the vanishing
 * id would misfire on a requeue (entry re-appears under a new id), and a
 * whole-queue discard (`agent.editAndRegenerate`) drops records at the flow
 * site via `chatQueuedRetryRecordsCleared`. Records stranded by discards
 * with no local flow site (another client's clear) never promote — they
 * leak bounded by MAX_QUEUED_RETRY_RECORDS.
 */
function reduceQueueContentSync(
  state: ChatStateSlice,
  agentId: string,
  queue: QueuedMessage[],
): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  if (!agent) return state;
  if (Object.keys(agent.queuedRetryRecords).length === 0) return state;
  const presentById = new Map(queue.map((message) => [message.id, message]));
  const presentByTurnId = new Map<string, QueuedMessage>();
  for (const message of queue) {
    if (message.turnId !== undefined) presentByTurnId.set(message.turnId, message);
  }
  let textSynced = false;
  const next: Record<string, QueuedRetryRecord> = {};
  for (const [id, parked] of Object.entries(agent.queuedRetryRecords)) {
    const present = presentById.get(id) ?? presentByTurnId.get(parked.turnId);
    if (present && parked.record.text !== present.content) {
      textSynced = true;
      next[id] = { ...parked, record: { ...parked.record, text: present.content } };
    } else {
      next[id] = parked;
    }
  }
  return textSynced ? updateAgent(state, agentId, { queuedRetryRecords: next }) : state;
}

/**
 * Locate the parked record a drain-start / failure event names (monorepo
 * #1057) by its `turnId` — the only attribution key: it survives the
 * `agent.retry` redrive requeue, which mints a NEW entry id but keeps the
 * failed turn's original `turnId`. Returns the record's key, or null when
 * nothing matches (e.g. a redrive of an entry this client never parked —
 * promotion must NOT fall back to approximating with another record).
 */
function findParkedRecordKey(agent: ChatAgentState, turnId: string | undefined): string | null {
  if (turnId === undefined) return null;
  for (const [id, parked] of Object.entries(agent.queuedRetryRecords)) {
    if (parked.turnId === turnId) return id;
  }
  return null;
}

/**
 * Exact drain-start promotion (monorepo#1057): `agent:queue:processing` (or
 * the `agent.sendQueuedMessageNow` delivered response, which carries the
 * `turnId` instead of the event, §5.5) says the daemon dequeued THIS entry to
 * run it — promote its parked record into `lastAttemptedMessage` (including
 * the stale-banner clear: the promoted record's turn is now the active turn,
 * so a previous turn's failure banner must not persist over it). A no-op
 * when nothing matches: the entry was never parked by this client, or the
 * record was already promoted (it left `queuedRetryRecords`, so a duplicate
 * event cannot double-promote).
 */
function reduceQueueProcessing(
  state: ChatStateSlice,
  agentId: string,
  turnId: string | undefined,
): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  if (!agent) return state;
  const key = findParkedRecordKey(agent, turnId);
  if (key === null) return state;
  const parked = agent.queuedRetryRecords[key];
  const remaining = { ...agent.queuedRetryRecords };
  delete remaining[key];
  return updateAgent(state, agentId, {
    lastAttemptedMessage: parked.record,
    queuedRetryRecords: remaining,
    error: null,
    modelUnavailable: null,
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

function reduceActivityReceived(
  state: ChatStateSlice,
  agentId: string,
  isStreamActivity: boolean,
  timestamp: number,
): ChatStateSlice {
  if (!isStreamActivity) {
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

/**
 * Terminal `agent:stream:end` bookkeeping (dispatched by the daemon events
 * bridge): clear the spinner timers and status entries. The event is
 * disposition-NEUTRAL (PROTOCOL §7) — a failed turn ends its stream the same
 * way and only the follow-up lifecycle event carries the disposition
 * (`agent:idle` on success, `agent:failed` on error). Clearing the retry
 * payload here therefore raced ahead of the failure banner and left "Try
 * again" a no-op (#984). Preserve the record and defer the success-clear to
 * the `agent:idle` finalize (reduceAgentIdleReconcile, whose
 * error/modelUnavailable guards keep the #941/#964 preserve-on-failure
 * semantics). The one disposition this event DOES carry is the user
 * interrupt (`stopReason: "interrupted"`, §7.2) — clear the abandoned
 * payload inline here (#965), because the synthetic post-interrupt
 * `agent:idle` (agent_manager.rs interrupt_inner, STAB-28) is SUPPRESSED
 * when a ready-to-send queue exists or the interrupt carries a message, so
 * the idle finalize can't be relied on. When the synthetic idle does arrive,
 * its reconcile is a harmless no-op on the already-cleared record.
 */
function reduceStreamEnded(
  state: ChatStateSlice,
  agentId: string,
  stopReason: string | undefined,
): ChatStateSlice {
  return updateAgent(state, agentId, {
    streamingStartTime: null,
    lastChunkTime: null,
    receivedFirstChunk: false,
    statusEvents: [],
    lastAttemptedMessage:
      stopReason === 'interrupted' ? null : getAgent(state, agentId).lastAttemptedMessage,
    modelUnavailable: null,
    error: null,
  });
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
 * returned QueuedMessage id (#999). The record stays parked until the drain
 * starts (promotion into `lastAttemptedMessage`, see reduceQueueProcessing)
 * or the entry is removed (dropped). Dispatched by chat-send-service's
 * queue-on-send success branch. `turnId` (monorepo#1057) is the enqueue RPC's
 * turn-correlation id — the ONLY attribution key: records promote/pair
 * exactly on `agent:queue:processing` / `chatSendFailed` turnId matches. The
 * pinned daemon (≥0.2.12) returns it on every enqueue path.
 */
export const chatQueuedRetryRecordSet = createAction<
  [agentId: string, messageId: string, record: LastAttemptedMessage, turnId: string]
>('chatState/queuedRetryRecordSet');

/**
 * Park a retry payload for a send the DAEMON auto-queued mid-flight (#1011):
 * `agent.sendMessage` answered `{ queued: true, queuedMessage }` instead of
 * running a turn (agent mid-turn, quarantined session, or the turn-startup
 * race). The caller already overwrote `lastAttemptedMessage` with this payload
 * before the wire call — but no turn is running it, so leaving it there pairs
 * an in-flight turn's failure banner with the WRONG message. This action parks
 * the record under the queued entry's id (drain-start promotion then
 * re-activates it for the turn that actually runs it, see
 * reduceQueueProcessing) and undoes the mid-turn overwrite:
 * `lastAttemptedMessage` is cleared only when it still structurally equals
 * the parked payload, so a concurrently recorded attempt is never clobbered.
 * Dispatched by the agent-send queued branch. `turnId`
 * (monorepo#1057) — see `chatQueuedRetryRecordSet`; here it comes from the
 * auto-queued `agent.sendMessage` response's top-level `turnId` (or the
 * echoed `queuedMessage.turnId`).
 */
export const chatQueuedRetryRecordParked = createAction<
  [agentId: string, messageId: string, record: LastAttemptedMessage, turnId: string]
>('chatState/queuedRetryRecordParked');

/**
 * Sync a parked retry record after `agent.editQueuedMessage` succeeds (#1011):
 * the daemon's queued entry now carries the edited content, so the parked
 * payload must match — otherwise a post-drain "Try again" resends the
 * PRE-edit text. Only the text changes (the edit RPC carries no
 * model/noteIds/imageBlocks); `seq` and recorded options are preserved. A
 * no-op when nothing is parked under the id (e.g. the entry predates this
 * chat's records). Dispatched by ChatPanel's edit-queued handler.
 */
export const chatQueuedRetryRecordUpdated = createAction<
  [agentId: string, messageId: string, text: string]
>('chatState/queuedRetryRecordUpdated');

/**
 * Drop ALL parked retry records without promotion (#999). Dispatched by the
 * flow site that KNOWS the daemon discarded the whole queue —
 * `agent.editAndRegenerate` calls `clear_queue` (PROTOCOL §5.5) — so the
 * discarded entries never run and no `agent:queue:processing` will ever
 * promote their records; dropping them eagerly prevents a bounded leak
 * (records only otherwise leave via promotion, user removal, or reset).
 */
export const chatQueuedRetryRecordsCleared = createAction<[agentId: string]>(
  'chatState/queuedRetryRecordsCleared',
);

/**
 * Send failed (activation or network error). `turnId` is the daemon's
 * turn-correlation id from the `agent:failed` event (PROTOCOL §6.6) when
 * present (monorepo#1057): when a PARKED record carries the same turnId, the
 * reducer promotes it into `lastAttemptedMessage` alongside setting the error
 * — exact failure pairing, covering the `agent.retry` redrive where the
 * failed turn's record may still be parked (its requeued entry has a new id,
 * so no drain-start event under this client's key ever promoted it).
 */
export const chatSendFailed =
  createAction<[agentId: string, error: string, turnId?: string]>('chatState/sendFailed');

/**
 * `agent:queue:processing` drain-start signal (PROTOCOL §6.5): the daemon
 * dequeued an entry and is starting its turn — carrying the entry's
 * turn-correlation id. This is the EXACT promotion signal for retry records
 * (monorepo#1057): the reducer promotes the parked record whose `turnId`
 * matches; a match survives an `agent.retry` redrive (requeued entry: new
 * id, same turnId). `turnId` stays optional purely as wire defensiveness —
 * the pinned daemon backfills legacy pre-#1022 rows on rehydration
 * (agent_queue_repo COALESCEs NULL turn_id to the row id), so it should
 * always be present; the reducer no-ops if it ever is not. Dispatched by
 * the events bridge (and chat-send-service's "Send now" success branch,
 * whose RPC response carries the turnId instead of the event, §5.5).
 */
export const chatQueueProcessingReceived = createAction<
  [agentId: string, turnId?: string]
>('chatState/queueProcessingReceived');

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

// --- Streaming event actions (dispatched by the daemon events bridge) ---

/**
 * Live stream activity tick (`agent:stream:activity` / `agent:tool:call`,
 * PROTOCOL §7). Content-free: the standing `chat.subscribe` delta stream
 * owns the transcript; this action only drives the chat-state spinner
 * bookkeeping (`lastChunkTime`, the `receivedFirstChunk` flip that appends
 * the "Streaming response…" status entry once response text exists).
 * `isStreamActivity` is `true` for a text-bearing `agent:stream:activity`
 * ping (flips `receivedFirstChunk`) and `false` for `agent:tool:call` and
 * pre-first-token pings (timestamp refresh only). The wire signal is
 * leading-edge throttled per agent (first ping immediate, then ≤1/s), so
 * timestamps refresh at most once a second mid-turn.
 */
export const streamActivityReceived = createAction(
  'chatState/streamActivityReceived',
  (
    agentId: string,
    isStreamActivity: boolean,
    timestamp = Date.now(),
  ): [string, boolean, number] => [agentId, isStreamActivity, timestamp],
);

/**
 * Terminal `agent:stream:end` (PROTOCOL §7): clears the spinner timers and
 * status entries in chat-state (see reduceStreamEnded for the #984/#965
 * retry-record semantics) and the session busy flags in agent-session.
 * `stopReason` is `"interrupted"` when the user stopped the turn.
 */
export const streamEnded = createAction<[agentId: string, stopReason?: string]>(
  'chatState/streamEnded',
);

/**
 * `agent:failed` bookkeeping: clears the spinner state and session busy
 * flags with a default interrupted error. When the event carries an explicit
 * error string, the bridge follows up with `chatSendFailed` to surface it.
 */
export const streamFailed = createAction<[agentId: string]>('chatState/streamFailed');

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

/**
 * Standing `chat.subscribe` lifecycle phase report (observational, deduped
 * at the live client). Dispatched by chat-subscribe-service from the
 * client's onPhase callback; `null` on subscription teardown so a closed
 * stream never leaves a stale pre-live phase behind.
 */
export const chatLiveStreamPhaseChanged = createAction<
  [agentId: string, phase: LiveStreamPhase | null]
>('chatState/liveStreamPhaseChanged');

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
  .with(chatQueuedRetryRecordSet, (state, { payload: [agentId, messageId, record, turnId] }) => {
    const agent = getAgent(state, agentId);
    return updateAgent(state, agentId, {
      agentId,
      queuedRetryRecords: parkRetryRecord(agent, messageId, record, turnId),
    });
  })
  .with(
    chatQueuedRetryRecordParked,
    (state, { payload: [agentId, messageId, record, turnId] }) => {
      const agent = getAgent(state, agentId);
      return updateAgent(state, agentId, {
        agentId,
        queuedRetryRecords: parkRetryRecord(agent, messageId, record, turnId),
        // Undo the caller's own mid-turn overwrite (#1011) — but only when the
        // slot still holds this exact payload; a different value means another
        // attempt recorded itself since and must keep its record.
        lastAttemptedMessage: deepEqual(agent.lastAttemptedMessage, record)
          ? null
          : agent.lastAttemptedMessage,
      });
    },
  )
  .with(chatQueuedRetryRecordUpdated, (state, { payload: [agentId, messageId, text] }) => {
    const agent = state.byAgentId[agentId];
    const parked = agent?.queuedRetryRecords[messageId];
    if (!parked) return state;
    return updateAgent(state, agentId, {
      queuedRetryRecords: {
        ...agent.queuedRetryRecords,
        [messageId]: { ...parked, record: { ...parked.record, text } },
      },
    });
  })
  .with(chatQueuedRetryRecordsCleared, (state, { payload: [agentId] }) => {
    const agent = state.byAgentId[agentId];
    if (!agent || Object.keys(agent.queuedRetryRecords).length === 0) return state;
    return updateAgent(state, agentId, { queuedRetryRecords: {} });
  })
  .with(replaceAgentQueue, (state, { payload: [agentId, messages] }) =>
    reduceQueueContentSync(state, agentId, messages),
  )
  .with(removeQueuedMessageFromAgentQueue, (state, { payload: [agentId, messageId] }) =>
    reduceQueuedRecordRemoved(state, agentId, messageId),
  )
  .with(chatQueueProcessingReceived, (state, { payload: [agentId, turnId] }) =>
    reduceQueueProcessing(state, agentId, turnId),
  )
  .with(chatSendFailed, (state, { payload: [agentId, error, turnId] }) => {
    // monorepo#1057: when the failure names a turn whose record is still
    // PARKED (e.g. an agent.retry redrive that failed again — its requeued
    // entry has a new id, so no processing event promoted it under this
    // client's key), pair the banner with the exact record.
    // An already-promoted or unknown turnId leaves the slot untouched —
    // `lastAttemptedMessage` already holds the right payload (or none).
    const agent = state.byAgentId[agentId];
    const key = agent ? findParkedRecordKey(agent, turnId) : null;
    if (agent && key !== null) {
      const remaining = { ...agent.queuedRetryRecords };
      delete remaining[key];
      return updateAgent(state, agentId, {
        streamingStartTime: null,
        error,
        modelUnavailable: null,
        lastAttemptedMessage: agent.queuedRetryRecords[key].record,
        queuedRetryRecords: remaining,
      });
    }
    return updateAgent(state, agentId, {
      streamingStartTime: null,
      error,
      modelUnavailable: null,
    });
  })
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
  .with(streamActivityReceived, (state, { payload: [agentId, isStreamActivity, timestamp] }) =>
    reduceActivityReceived(state, agentId, isStreamActivity, timestamp),
  )
  .with(streamEnded, (state, { payload: [agentId, stopReason] }) =>
    reduceStreamEnded(state, agentId, stopReason),
  )
  .with(streamFailed, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      statusEvents: [],
      modelUnavailable: null,
      error: m.chat_state_interrupted_error(),
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
  .with(chatRebindStarted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isRebinding: true }),
  )
  .with(chatRebindEnded, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isRebinding: false }),
  )
  .with(chatTrackedWorkspaceSet, (state, { payload: [agentId, trackedWsId] }) =>
    updateAgent(state, agentId, { trackedWorkspaceId: trackedWsId }),
  )
  .with(chatLiveStreamPhaseChanged, (state, { payload: [agentId, phase] }) => {
    // Teardown reset (null) on a chat never opened must not materialize an
    // entry; a real phase report may (mid-turn open precedes chatInitialized).
    if (phase === null && !state.byAgentId[agentId]) return state;
    return updateAgent(state, agentId, { agentId, liveStreamPhase: phase });
  })
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
    return reduceAgentIdleReconcile(state, agentId, event.timestamp);
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

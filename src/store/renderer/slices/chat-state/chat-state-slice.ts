import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  ChatAgentState,
  ChatStateSlice,
  HydratedBlockEntry,
  StatusEvent,
  LastAttemptedMessage,
  LiveStreamPhase,
  ModelUnavailableInfo,
  QueuedRetryRecord,
  SendMessagePayload,
  InitializeChatOptions,
  PendingProposalRecovery,
  StreamStatusContext,
  StreamFailureCorrelation,
  TranscriptSnapshotMeta,
} from './chat-state-types';
import {
  MAX_HYDRATED_BLOCKS,
  MAX_QUEUED_RETRY_RECORDS,
  hydratedBlockKey,
} from './chat-state-types';
import { sanitizeStatusEvent } from './chat-state-serialization';
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from '../workspace-agents/workspace-agents-stream-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import { markAgentAsViewed } from '../unread-tracking/unread-tracking-slice';
import {
  removeQueuedMessageFromAgentQueue,
  replaceAgentQueue,
} from '../agent-queue/agent-queue-slice';
import type { ContentBlock, QueuedMessage } from '$shared/types';
import type { Question } from '$shared/types/question-resource';
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
  fetchingOlderHistory: false,
  fetchingGapFill: false,
  scrollbackOlderToken: null,
  scrollbackGapToken: null,
  fetchingHistorySeek: false,
  historySeekUnsupported: false,
  scrollbackDiscardEpoch: 0,
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
    Object.values(agent.queuedRetryRecords).reduce((max, parked) => Math.max(max, parked.seq), 0) +
    1;
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
 * Write one hydrated-block entry with the next monotonic seq, evicting the
 * oldest SETTLED (loaded/error) entries beyond MAX_HYDRATED_BLOCKS. In-flight
 * `loading` entries are exempt from eviction — the single-flight dedup
 * depends on them surviving until the fetch settles.
 */
function setHydratedBlock(
  agent: ChatAgentState,
  key: string,
  entry:
    | { status: 'loading' }
    | { status: 'loaded'; block: ContentBlock }
    | { status: 'error'; error: string },
): Record<string, HydratedBlockEntry> {
  const current = agent.hydratedBlocks ?? {};
  const seq = Object.values(current).reduce((max, e) => Math.max(max, e.seq), 0) + 1;
  const next: Record<string, HydratedBlockEntry> = {
    ...current,
    [key]: { ...entry, seq } as HydratedBlockEntry,
  };
  const settledIds = Object.keys(next).filter((id) => next[id].status !== 'loading');
  const overflow = Object.keys(next).length - MAX_HYDRATED_BLOCKS;
  if (overflow > 0) {
    settledIds.sort((a, b) => next[a].seq - next[b].seq);
    for (const id of settledIds.slice(0, overflow)) {
      if (id !== key) delete next[id];
    }
  }
  return next;
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

function getStreamFailureMessage(payload: AgentStreamUpdatePayload): string | null {
  if (payload.error) return payload.error;
  // Scoped to the timeout eventType only: `finishReason` is the OPEN union of
  // abnormal ACP stop reasons from the wire (PROTOCOL §7.3), so a future
  // daemon-side reason spelled "timeout" on a `complete` payload must not
  // surface a stream-failure banner.
  if (payload.eventType === 'timeout') {
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
 * Dispatched by the agent-stream-lifecycle queued branch. `turnId`
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
  createAction<
    [agentId: string, error: string, turnId?: string, failureCorrelation?: StreamFailureCorrelation]
  >('chatState/sendFailed');

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
export const chatQueueProcessingReceived = createAction<[agentId: string, turnId?: string]>(
  'chatState/queueProcessingReceived',
);

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

/** Live stream activity tick (`agent:stream:activity` / `agent:tool:call`). */
export const streamActivityReceived = createAction(
  'chatState/streamActivityReceived',
  (
    agentId: string,
    isStreamActivity: boolean,
    timestamp = Date.now(),
  ): [string, boolean, number] => [agentId, isStreamActivity, timestamp],
);

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
const chatStatusEventsHydrated = createAction<[agentId: string, statusEvents: StatusEvent[]]>(
  'chatState/statusEventsHydrated',
);

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

/** A newest-window source completed successfully for an agent. */
export const transcriptHydrationSettled = createAction<[agentId: string]>(
  'chatState/transcriptHydrationSettled',
);

/** Every bounded newest-window source failed; the panel may offer a retry. */
export const transcriptHydrationFailed = createAction<[agentId: string]>(
  'chatState/transcriptHydrationFailed',
);

/**
 * A seq-0 snapshot from the standing `chat.subscribe` subscription was applied
 * to the store (single-transfer hydration). Dispatched by the chat-subscribe
 * saga with the snapshot's page metadata; the reducer stamps a per-agent
 * monotonic `seq` so waiters can both read the latest snapshot from state and
 * `take` this action for the arrival signal.
 */
export const chatTranscriptSnapshotApplied = createAction<
  [agentId: string, meta: Omit<TranscriptSnapshotMeta, 'seq'>]
>('chatState/transcriptSnapshotApplied');

/** Standing chat.subscribe lifecycle phase reported by the live client. */
export const chatLiveStreamPhaseChanged = createAction<
  [agentId: string, phase: LiveStreamPhase | null]
>('chatState/liveStreamPhaseChanged');

/**
 * Bounded fallback for the transcript reveal gates: the subscribe saga's
 * timer elapsed with the switch-back snapshot gate and/or the utility-footer
 * gate still armed, so BOTH clear and the transcript reveals (without the
 * footer, which pops in later — today's behavior) instead of an indefinite
 * skeleton. A no-op when neither gate is armed (snapshot applied and footer
 * ready, subscription closed, or a stale timer from a superseded switch).
 */
export const chatSwitchBackRevealTimedOut = createAction<[agentId: string]>(
  'chatState/switchBackRevealTimedOut',
);

/**
 * The subscribe saga observed the utility-footer data sources settle
 * (`isUtilityFooterReady` composed true for the agent's workspace) — clear
 * the footer reveal gate so transcript and footer flip in the same paint.
 * A no-op when the gate is not armed.
 */
export const chatUtilityFooterReady = createAction<[agentId: string]>(
  'chatState/utilityFooterReady',
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

/**
 * Declare the exact child transcripts needed by one mounted subscription-list
 * owner. The chat subscribe saga reference-counts owners, opens only the listed
 * agent streams, and releases them when the owner updates or unmounts.
 */
export const retainedChatTranscriptsSet = createAction<
  [ownerId: string, wsId: string, agentIds: string[]]
>('chatState/retainedChatTranscriptsSet');

/** Request transcript reconciliation from a daemon event or reconnect path. */
export const refreshChatTranscriptRequested = createAction<[wsId: string, agentId: string]>(
  'chatState/refreshChatTranscriptRequested',
);

/**
 * Mid-hydration snapshot re-request: the chat-read saga's bounded seq-0 wait
 * timed out a window with hydration still `loading`, and asks the subscribe
 * saga to give the next window something to settle on (replay a held
 * snapshot, re-emit the last reconciled one, or force-cycle the
 * registration). Saga trigger only — no reducer state change.
 */
export const chatTranscriptSnapshotRerequested = createAction<[wsId: string, agentId: string]>(
  'chatState/transcriptSnapshotRerequested',
);

// --- Scrollback paging actions (on-demand history segment fetches) ---

/**
 * UI request: fetch ONE older-history page (200 rows) into the scrollback
 * history segment. Deduped per agent by the `fetchingOlderHistory` flag
 * (takeLeading semantics per agent); a no-op once `oldestReached`.
 */
export const olderHistoryPageRequested = createAction<[wsId: string, agentId: string]>(
  'chatState/olderHistoryPageRequested',
);

/**
 * UI request: fetch ONE page (200 rows) refilling the hole between the
 * scrollback history segment and the live tail. Deduped per agent by the
 * `fetchingGapFill` flag; a no-op unless the segment's `gapToTail` is open.
 */
export const historyGapFillRequested = createAction<[wsId: string, agentId: string]>(
  'chatState/historyGapFillRequested',
);

/**
 * UI request: far-flick seek — jump the scrollback history segment to the
 * page containing `targetOrdinal` (0-based from the OLDEST message) with ONE
 * `aroundIndex` fetch, replacing the current segment. Deduped per agent by
 * the `fetchingHistorySeek` flag; a no-op when the daemon already rejected
 * `aroundIndex` (`historySeekUnsupported` — the serial walk applies instead).
 */
export const historySeekRequested = createAction<
  [wsId: string, agentId: string, targetOrdinal: number]
>('chatState/historySeekRequested');

/** Fetch the one authoritative marked question row with a bounded targeted seek. */
export const pendingQuestionRecoveryRequested = createAction<[agentId: string, messageId: string]>(
  'chatState/pendingQuestionRecoveryRequested',
);

export const pendingQuestionRecoverySettled = createAction<
  [
    agentId: string,
    messageId: string,
    outcome: 'found' | 'not-found' | 'error' | 'cancelled',
    questions?: Question[],
  ]
>('chatState/pendingQuestionRecoverySettled');

export const pendingQuestionRecoveryCleared = createAction<[agentId: string]>(
  'chatState/pendingQuestionRecoveryCleared',
);

/** Fetch one pending-proposal carrying message with a bounded targeted seek. */
export const pendingProposalRecoveryRequested = createAction<[agentId: string, messageId: string]>(
  'chatState/pendingProposalRecoveryRequested',
);

export const pendingProposalRecoverySettled = createAction<
  [
    agentId: string,
    messageId: string,
    outcome: 'found' | 'not-found' | 'error' | 'cancelled',
    proposals?: NonNullable<PendingProposalRecovery['proposals']>,
  ]
>('chatState/pendingProposalRecoverySettled');

/** Drop recovery entries for messages the metadata refs no longer name. */
export const pendingProposalRecoveryPruned = createAction<
  [agentId: string, keepMessageIds: string[]]
>('chatState/pendingProposalRecoveryPruned');

/** A scrollback page fetch entered flight for the given direction. */
export const scrollbackFetchStarted = createAction<
  [agentId: string, direction: 'older' | 'gap' | 'seek']
>('chatState/scrollbackFetchStarted');

/**
 * An older scrollback page fetch settled (success or swallowed error).
 * Clears `fetchingOlderHistory` and persists the backward continuation
 * cursor (`null` on error or exhaustion ⇒ the next request re-seeks). Also
 * drops the gap-refill cursor: the prepend may have cap-pruned history's
 * newest side, so a forward walk continuing from the old position would
 * skip the pruned rows.
 */
export const scrollbackOlderPageSettled = createAction<[agentId: string, nextToken: string | null]>(
  'chatState/scrollbackOlderPageSettled',
);

/**
 * A gap-refill scrollback page fetch settled (success or swallowed error).
 * Clears `fetchingGapFill` and persists the forward continuation cursor
 * (`null` on error or tail reached ⇒ the next request re-seeks). Also drops
 * the older cursor: the append may have cap-pruned history's oldest side,
 * so a backward walk continuing from the old position would skip the
 * pruned rows.
 */
export const scrollbackGapPageSettled = createAction<[agentId: string, prevToken: string | null]>(
  'chatState/scrollbackGapPageSettled',
);

/**
 * An `aroundIndex` seek fetch settled. Clears `fetchingHistorySeek` and — on
 * success — persists BOTH continuation cursors minted by the landing page
 * (backward `nextToken`, forward `prevToken`), so subsequent walks continue
 * in either direction from the landing without re-seeking. `unsupported`
 * latches `historySeekUnsupported` (daemon predates `aroundIndex`).
 */
export const scrollbackSeekSettled = createAction<
  [
    agentId: string,
    tokens: { nextToken: string | null; prevToken: string | null },
    unsupported?: boolean,
  ]
>('chatState/scrollbackSeekSettled');

/**
 * Drop the agent's scrollback continuation state (both cursors + fetching
 * flags). Dispatched by the scrollback saga whenever the history segment is
 * cleared out from under the walk (session removal, explicit segment clear,
 * §7.1 `resumed: false` rehydration).
 */
export const scrollbackContinuationReset = createAction<[agentId: string]>(
  'chatState/scrollbackContinuationReset',
);

// --- Lazy block hydration (§5.5 slim projection → v7.2 agent.getMessageBlock) ---

/**
 * Saga trigger + single-flight marker: the user expanded a truncated tool row
 * or asked for a truncated image's original. The reducer records `loading`
 * under `{messageId}|{blockId}` (deduping concurrent expands — the saga
 * ignores triggers whose entry is already loading/loaded), then the
 * chat-read saga fetches via `agent.getMessageBlock`.
 */
export const messageBlockHydrationRequested = createAction<
  [agentId: string, messageId: string, blockId: string]
>('chatState/messageBlockHydrationRequested');

/** The full block arrived: cache it for rendering (bounded, oldest evicted). */
export const messageBlockHydrated = createAction<
  [agentId: string, messageId: string, blockId: string, block: ContentBlock]
>('chatState/messageBlockHydrated');

/** The fetch failed: record the error so the next expand can retry. */
export const messageBlockHydrationFailed = createAction<
  [agentId: string, messageId: string, blockId: string, error: string]
>('chatState/messageBlockHydrationFailed');

// --- Send message saga trigger (no reducer state change) ---

/** Trigger the send-message saga. Dispatched from ChatPanel after DOM serialization. */
export const sendMessage = createAction(
  'chatState/sendMessage',
  (agentId: string, payload: SendMessagePayload & { wsId: string }) => ({ agentId, payload }),
);

// ============================================================================
// Reducer
// ============================================================================

export const chatStateReducer = createReducer<ChatStateSlice>(initialState);
chatStateReducer.with(chatInitialized, (state, { payload: [agentId, data] }) =>
  updateAgent(state, agentId, {
    agentId,
    error: null,
    failureCorrelation: undefined,
    lastAttemptedMessage: data.lastAttemptedMessage,
  }),
);
chatStateReducer.with(chatInitFailed, (state, { payload: [agentId, error] }) =>
  updateAgent(state, agentId, { error, failureCorrelation: undefined, modelUnavailable: null }),
);
chatStateReducer.with(chatSendStarted, (state, { payload: { agentId, timestamp } }) =>
  updateAgent(state, agentId, {
    error: null,
    failureCorrelation: undefined,
    modelUnavailable: null,
    streamingStartTime: timestamp,
    lastMessageTime: timestamp,
    lastChunkTime: null,
    receivedFirstChunk: false,
    statusEvents: [],
  }),
);
chatStateReducer.with(
  chatLastAttemptedMessageSet,
  (state, { payload: [agentId, lastAttemptedMessage] }) =>
    updateAgent(state, agentId, { lastAttemptedMessage }),
);
chatStateReducer.with(
  chatQueuedRetryRecordSet,
  (state, { payload: [agentId, messageId, record, turnId] }) => {
    const agent = getAgent(state, agentId);
    return updateAgent(state, agentId, {
      agentId,
      queuedRetryRecords: parkRetryRecord(agent, messageId, record, turnId),
    });
  },
);
chatStateReducer.with(
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
);
chatStateReducer.with(
  chatQueuedRetryRecordUpdated,
  (state, { payload: [agentId, messageId, text] }) => {
    const agent = state.byAgentId[agentId];
    const parked = agent?.queuedRetryRecords[messageId];
    if (!parked) return state;
    return updateAgent(state, agentId, {
      queuedRetryRecords: {
        ...agent.queuedRetryRecords,
        [messageId]: { ...parked, record: { ...parked.record, text } },
      },
    });
  },
);
chatStateReducer.with(chatQueuedRetryRecordsCleared, (state, { payload: [agentId] }) => {
  const agent = state.byAgentId[agentId];
  if (!agent || Object.keys(agent.queuedRetryRecords).length === 0) return state;
  return updateAgent(state, agentId, { queuedRetryRecords: {} });
});
chatStateReducer.with(replaceAgentQueue, (state, { payload: [agentId, messages] }) =>
  reduceQueueContentSync(state, agentId, messages),
);
chatStateReducer.with(
  removeQueuedMessageFromAgentQueue,
  (state, { payload: [agentId, messageId] }) =>
    reduceQueuedRecordRemoved(state, agentId, messageId),
);
chatStateReducer.with(chatQueueProcessingReceived, (state, { payload: [agentId, turnId] }) =>
  reduceQueueProcessing(state, agentId, turnId),
);
chatStateReducer.with(
  chatSendFailed,
  (state, { payload: [agentId, error, turnId, failureCorrelation] }) => {
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
        failureCorrelation,
        modelUnavailable: null,
        lastAttemptedMessage: agent.queuedRetryRecords[key].record,
        queuedRetryRecords: remaining,
      });
    }
    return updateAgent(state, agentId, {
      streamingStartTime: null,
      error,
      failureCorrelation,
      modelUnavailable: null,
    });
  },
);
chatStateReducer.with(chatInterrupted, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, {
    streamingStartTime: null,
  }),
);
chatStateReducer.with(chatModelUnavailableCleared, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, { modelUnavailable: null }),
);
chatStateReducer.with(chatErrorCleared, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, { error: null, failureCorrelation: undefined }),
);
chatStateReducer.with(chatStopInitiated, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, { isInterrupting: true }),
);
chatStateReducer.with(chatStopCompleted, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, {
    isInterrupting: false,
    streamingStartTime: null,
  }),
);
chatStateReducer.with(chatReset, (state, { payload: [agentId] }) =>
  setAgent(state, agentId, { ...emptyChatAgentState }),
);
chatStateReducer.with(chatStreamingReconciled, (state, { payload: { agentId, timestamp } }) => {
  const agent = getAgent(state, agentId);
  // Only update the streamingStartTime (isProcessing/isStreaming are on agent-session now)
  if (!agent.streamingStartTime) {
    return updateAgent(state, agentId, {
      streamingStartTime: timestamp,
    });
  }
  return state;
});
chatStateReducer.with(agentStreamUpdateReceived, (state, { payload: [payload] }) =>
  reduceAgentStreamUpdate(state, payload),
);
chatStateReducer.with(
  streamActivityReceived,
  (state, { payload: [agentId, isStreamActivity, timestamp] }) =>
    reduceChunkReceived(state, agentId, isStreamActivity, timestamp),
);
chatStateReducer.with(streamCompleted, (state, { payload: [agentId, data] }) =>
  updateAgent(state, agentId, {
    streamingStartTime: null,
    lastChunkTime: null,
    receivedFirstChunk: false,
    statusEvents: [],
    lastAttemptedMessage: data.lastAttemptedMessage,
    modelUnavailable: data.modelUnavailable,
  }),
);
chatStateReducer.with(
  streamStatusReceived,
  (state, { payload: [agentId, statusEvent, resetFirstChunk] }) => {
    const agent = getAgent(state, agentId);
    return updateAgent(state, agentId, {
      statusEvents: [...agent.statusEvents, sanitizeStatusEvent(statusEvent)],
      receivedFirstChunk: resetFirstChunk ? false : agent.receivedFirstChunk,
    });
  },
);
chatStateReducer.with(chatStatusEventsHydrated, (state, { payload: [agentId, statusEvents] }) =>
  updateAgent(state, agentId, {
    agentId,
    statusEvents,
  }),
);
chatStateReducer.with(streamTimedOut, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, {
    streamingStartTime: null,
    error: m.chat_state_timeout_error(),
    failureCorrelation: undefined,
  }),
);
chatStateReducer.with(chatRebindStarted, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, { isRebinding: true }),
);
chatStateReducer.with(chatRebindEnded, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, { isRebinding: false }),
);
chatStateReducer.with(chatTrackedWorkspaceSet, (state, { payload: [agentId, trackedWsId] }) =>
  updateAgent(state, agentId, { trackedWorkspaceId: trackedWsId }),
);
chatStateReducer.with(transcriptHydrationStarted, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, { agentId, transcriptHydration: 'loading' }),
);
chatStateReducer.with(transcriptHydrationSettled, (state, { payload: [agentId] }) => {
  const agent = getAgent(state, agentId);
  return updateAgent(state, agentId, {
    agentId,
    transcriptHydration: 'settled',
    transcriptHydratedOnce: true,
    // First settle only (latch rising edge): hold the reveal until the
    // utility-footer data sources settle too, so transcript and footer flip
    // in the same paint. The subscribe saga clears it (footer ready) or its
    // bounded fallback does — never wedges. Refresh re-hydrations keep the
    // transcript visible and must not re-arm.
    awaitingUtilityFooter:
      agent.transcriptHydratedOnce === true ? agent.awaitingUtilityFooter : true,
  });
});
chatStateReducer.with(transcriptHydrationFailed, (state, { payload: [agentId] }) =>
  updateAgent(state, agentId, { agentId, transcriptHydration: 'error' }),
);
chatStateReducer.with(chatTranscriptSnapshotApplied, (state, { payload: [agentId, meta] }) => {
  const agent = getAgent(state, agentId);
  return updateAgent(state, agentId, {
    agentId,
    transcriptSnapshot: { ...meta, seq: (agent.transcriptSnapshot?.seq ?? 0) + 1 },
    // A snapshot from the CURRENT subscription is exactly what the
    // switch-back reveal gate waits for — reveal the transcript.
    awaitingSwitchBackSnapshot: false,
    // §7.1 `resumed: false` discard: the retained transcript (history
    // segment included) is dropped, so the whole scrollback walk resets
    // ATOMICALLY with the snapshot — stranded fetching flags from a wire
    // call that died with the socket would otherwise freeze the spacer
    // reconcile and suppress every walk driver forever. The epoch bump
    // invalidates workers still awaiting their wire call: a page resolving
    // after the discard must not recreate a segment or persist a cursor
    // minted against the discarded transcript. The saga's
    // `clearHistorySegment` chain still runs (and is idempotent here);
    // the `historySeekUnsupported` latch is a daemon capability, not walk
    // state, and survives.
    ...(meta.resumed === false
      ? {
          fetchingOlderHistory: false,
          fetchingGapFill: false,
          fetchingHistorySeek: false,
          scrollbackOlderToken: null,
          scrollbackGapToken: null,
          scrollbackDiscardEpoch: agent.scrollbackDiscardEpoch + 1,
        }
      : {}),
  });
});
chatStateReducer.with(
  messageBlockHydrationRequested,
  (state, { payload: [agentId, messageId, blockId] }) => {
    const agent = getAgent(state, agentId);
    const key = hydratedBlockKey(messageId, blockId);
    const existing = agent.hydratedBlocks?.[key];
    // Single-flight + read-through cache: an in-flight or already-loaded
    // entry ignores the re-request; only absent or errored entries start a
    // fresh fetch (the saga keys off the same predicate).
    if (existing && existing.status !== 'error') return state;
    return updateAgent(state, agentId, {
      agentId,
      hydratedBlocks: setHydratedBlock(agent, key, { status: 'loading' }),
    });
  },
);
chatStateReducer.with(
  messageBlockHydrated,
  (state, { payload: [agentId, messageId, blockId, block] }) => {
    const agent = getAgent(state, agentId);
    const key = hydratedBlockKey(messageId, blockId);
    return updateAgent(state, agentId, {
      agentId,
      hydratedBlocks: setHydratedBlock(agent, key, { status: 'loaded', block }),
    });
  },
);
chatStateReducer.with(
  messageBlockHydrationFailed,
  (state, { payload: [agentId, messageId, blockId, error] }) => {
    const agent = getAgent(state, agentId);
    const key = hydratedBlockKey(messageId, blockId);
    return updateAgent(state, agentId, {
      agentId,
      hydratedBlocks: setHydratedBlock(agent, key, { status: 'error', error }),
    });
  },
);
chatStateReducer.with(chatLiveStreamPhaseChanged, (state, { payload: [agentId, phase] }) => {
  if (phase === null && !state.byAgentId[agentId]) return state;
  // Phase null = subscription closed (teardown reset): the snapshot metadata
  // belongs to that subscription, so drop it — a reopen's hydration must wait
  // for the NEW subscription's snapshot, not settle on the stale one (whose
  // truncated flag may no longer describe the conversation). The switch-back
  // reveal gate clears too: with no open/opening subscription there is no
  // snapshot to wait for, and a background panel whose subscription closed
  // stays on its retained transcript.
  if (phase === null) {
    return updateAgent(state, agentId, {
      agentId,
      liveStreamPhase: null,
      transcriptSnapshot: undefined,
      awaitingSwitchBackSnapshot: false,
      // No open/opening subscription means no pending reveal either — a
      // backgrounded panel must not re-skeleton for footer readiness.
      awaitingUtilityFooter: false,
    });
  }
  return updateAgent(state, agentId, { agentId, liveStreamPhase: phase });
});
// Switch-back transcript reveal gate: armed SYNCHRONOUSLY with the view
// switch (same dispatch that triggers the subscribe saga's subscription
// swap), so no frame can paint the retained stale transcript before the
// reopening subscription's fresh seq-0 snapshot lands. Arms only for a
// conversation that hydrated at least once (the first-hydration path keeps
// its existing skeleton logic) and holds no snapshot from a current
// subscription (an already-open live subscription keeps rendering). Never
// materializes chat state for an agent whose chat was never opened.
// The utility-footer gate arms alongside it (same preconditions) so the
// re-view reveals transcript AND footer in one paint; when the footer data
// is already settled in the store the subscribe saga clears it in the same
// dispatch cascade, before any frame paints.
chatStateReducer.with(markAgentAsViewed, (state, { payload: [agentId] }) => {
  const agent = state.byAgentId[agentId];
  if (!agent) return state;
  if (agent.transcriptHydratedOnce !== true) return state;
  if (agent.transcriptSnapshot !== undefined) return state;
  if (agent.awaitingSwitchBackSnapshot === true) return state;
  return updateAgent(state, agentId, {
    awaitingSwitchBackSnapshot: true,
    awaitingUtilityFooter: true,
  });
});
chatStateReducer.with(chatSwitchBackRevealTimedOut, (state, { payload: [agentId] }) => {
  const agent = state.byAgentId[agentId];
  if (agent?.awaitingSwitchBackSnapshot !== true && agent?.awaitingUtilityFooter !== true) {
    return state;
  }
  return updateAgent(state, agentId, {
    awaitingSwitchBackSnapshot: false,
    awaitingUtilityFooter: false,
  });
});
chatStateReducer.with(chatUtilityFooterReady, (state, { payload: [agentId] }) => {
  const agent = state.byAgentId[agentId];
  if (agent?.awaitingUtilityFooter !== true) return state;
  return updateAgent(state, agentId, { awaitingUtilityFooter: false });
});
chatStateReducer.with(eventReceived, (state, { payload: [, event] }) => {
  if (event.type !== 'agent:idle') return state;
  const data: unknown = event.data;
  if (!isRecord(data)) return state;
  // PROTOCOL.md: agent:idle always carries data.agentId.
  const agentId = data.agentId;
  if (typeof agentId !== 'string' || agentId.length === 0) return state;
  return reduceAgentIdleReconcile(state, agentId, event.timestamp);
});
chatStateReducer.with(scrollbackFetchStarted, (state, { payload: [agentId, direction] }) =>
  updateAgent(state, agentId, {
    agentId,
    ...(direction === 'older'
      ? { fetchingOlderHistory: true }
      : direction === 'gap'
        ? { fetchingGapFill: true }
        : { fetchingHistorySeek: true }),
  }),
);
chatStateReducer.with(scrollbackOlderPageSettled, (state, { payload: [agentId, nextToken] }) =>
  updateAgent(state, agentId, {
    agentId,
    fetchingOlderHistory: false,
    scrollbackOlderToken: nextToken,
    scrollbackGapToken: null,
  }),
);
chatStateReducer.with(scrollbackGapPageSettled, (state, { payload: [agentId, prevToken] }) =>
  updateAgent(state, agentId, {
    agentId,
    fetchingGapFill: false,
    scrollbackGapToken: prevToken,
    scrollbackOlderToken: null,
  }),
);
chatStateReducer.with(scrollbackSeekSettled, (state, { payload: [agentId, tokens, unsupported] }) =>
  updateAgent(state, agentId, {
    agentId,
    fetchingHistorySeek: false,
    scrollbackOlderToken: tokens.nextToken,
    scrollbackGapToken: tokens.prevToken,
    ...(unsupported ? { historySeekUnsupported: true } : {}),
  }),
);
chatStateReducer.with(scrollbackContinuationReset, (state, { payload: [agentId] }) => {
  const agent = state.byAgentId[agentId];
  if (!agent) return state;
  if (
    !agent.fetchingOlderHistory &&
    !agent.fetchingGapFill &&
    !agent.fetchingHistorySeek &&
    agent.scrollbackOlderToken === null &&
    agent.scrollbackGapToken === null
  ) {
    return state;
  }
  return updateAgent(state, agentId, {
    fetchingOlderHistory: false,
    fetchingGapFill: false,
    fetchingHistorySeek: false,
    scrollbackOlderToken: null,
    scrollbackGapToken: null,
  });
});
chatStateReducer.with(
  pendingQuestionRecoveryRequested,
  (state, { payload: [agentId, messageId] }) => {
    const existing = getAgent(state, agentId).pendingQuestionRecovery;
    if (existing?.messageId === messageId) return state;
    return updateAgent(state, agentId, {
      agentId,
      pendingQuestionRecovery: { messageId, status: 'loading' },
    });
  },
);
chatStateReducer.with(
  pendingQuestionRecoverySettled,
  (state, { payload: [agentId, messageId, outcome, questions] }) => {
    const existing = state.byAgentId[agentId]?.pendingQuestionRecovery;
    if (existing?.messageId !== messageId) return state;
    return updateAgent(state, agentId, {
      pendingQuestionRecovery:
        outcome === 'cancelled'
          ? undefined
          : {
              messageId,
              status: outcome,
              ...(outcome === 'found' ? { questions: questions ?? [] } : {}),
            },
    });
  },
);
chatStateReducer.with(pendingQuestionRecoveryCleared, (state, { payload: [agentId] }) => {
  const agent = state.byAgentId[agentId];
  if (!agent?.pendingQuestionRecovery) return state;
  return updateAgent(state, agentId, { pendingQuestionRecovery: undefined });
});
chatStateReducer.with(
  pendingProposalRecoveryRequested,
  (state, { payload: [agentId, messageId] }) => {
    const existing = getAgent(state, agentId).pendingProposalRecovery;
    if (existing?.[messageId]) return state;
    return updateAgent(state, agentId, {
      agentId,
      pendingProposalRecovery: { ...existing, [messageId]: { status: 'loading' } },
    });
  },
);
chatStateReducer.with(
  pendingProposalRecoverySettled,
  (state, { payload: [agentId, messageId, outcome, proposals] }) => {
    const existing = state.byAgentId[agentId]?.pendingProposalRecovery;
    if (!existing?.[messageId]) return state;
    if (outcome === 'cancelled') {
      const { [messageId]: _dropped, ...rest } = existing;
      return updateAgent(state, agentId, { pendingProposalRecovery: rest });
    }
    return updateAgent(state, agentId, {
      pendingProposalRecovery: {
        ...existing,
        [messageId]: {
          status: outcome,
          ...(outcome === 'found' ? { proposals: proposals ?? [] } : {}),
        },
      },
    });
  },
);
chatStateReducer.with(
  pendingProposalRecoveryPruned,
  (state, { payload: [agentId, keepMessageIds] }) => {
    const existing = state.byAgentId[agentId]?.pendingProposalRecovery;
    if (!existing) return state;
    const keep = new Set(keepMessageIds);
    const entries = Object.entries(existing).filter(([messageId]) => keep.has(messageId));
    if (entries.length === Object.keys(existing).length) return state;
    return updateAgent(state, agentId, {
      pendingProposalRecovery: entries.length > 0 ? Object.fromEntries(entries) : undefined,
    });
  },
);
chatStateReducer.with(workspaceDeleted, (state, { payload: [, agentIds] }) => {
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

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
import { MAX_QUEUED_RETRY_RECORDS } from './chat-state-types';
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
 * Park a retry record under a queued-entry id with the next monotonic enqueue
 * seq (promotion order cannot rely on Record key order — integer-like keys
 * iterate first, breaking insertion order). Shared by the queue-on-send park
 * (#999) and the lifecycle auto-queue park (#1011). Bounded at
 * MAX_QUEUED_RETRY_RECORDS (#973-family memory): records stranded by missed
 * snapshots or per-agent deletion would otherwise accumulate for the app
 * session, each potentially carrying MB-scale base64 imageBlocks — parking
 * beyond the cap evicts the oldest (lowest-seq) records first. Note evicted
 * records also stop counting toward the promotion path's drainedCount, so at
 * >MAX parked records a clear-queue discard can degrade into a
 * single-vanishing-id diff and promote a discarded payload — keep the cap
 * comfortably above any realistic queue depth if it is ever tuned.
 */
function parkRetryRecord(
  agent: ChatAgentState,
  messageId: string,
  record: LastAttemptedMessage,
  turnId?: string,
): Record<string, QueuedRetryRecord> {
  const seq =
    Object.values(agent.queuedRetryRecords).reduce(
      (max, parked) => Math.max(max, parked.seq),
      0,
    ) + 1;
  const parked: QueuedRetryRecord = turnId !== undefined ? { seq, record, turnId } : { seq, record };
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
 * This reducer-side signature only sees PARKED ids, so a clear that wipes a
 * multi-entry queue holding exactly ONE parked record slips past it (#1032);
 * the events bridge covers that case with the raw last-snapshot length the
 * queue slice retains (see handleQueueUpdatedEvent), dispatching
 * `chatQueuedRetryRecordsCleared` before the snapshot lands here.
 *
 * turnId-keyed records (monorepo#1057) BYPASS the vanishing-id inference
 * entirely: their exact promotion signal is `agent:queue:processing` (or the
 * `agent.sendQueuedMessageNow` RPC response, which carries the turnId instead
 * of the event, §5.5). A record whose key vanishes from the snapshot but that
 * carries a turnId stays PARKED — promoting it here would misfire on a
 * terminal-failure requeue, where the entry re-appears under a NEW id (same
 * turnId) while the record's key is gone from every snapshot: the old
 * inference would promote it prematurely and wipe the fresh failure banner.
 * Present-entry matching is turnId-aware for the same reason: a requeued
 * entry (new id, same turnId) still counts as "present" for its record, so
 * the daemon-authoritative content sync keeps working across requeues.
 */
function reduceQueueSnapshotDiff(
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
  let promoted: QueuedRetryRecord | null = null;
  let drainedCount = 0;
  let textSynced = false;
  const remaining: Record<string, QueuedRetryRecord> = {};
  const vanishedTurnKeyed: string[] = [];
  for (const [id, parked] of Object.entries(agent.queuedRetryRecords)) {
    const present =
      presentById.get(id) ??
      (parked.turnId !== undefined ? presentByTurnId.get(parked.turnId) : undefined);
    if (present) {
      // #1011: the snapshot is the daemon-authoritative content of the queued
      // entry — sync the parked text so an edit is reflected even when the
      // save's self-drain snapshot (agent idle at save, STAB-27 release awaits
      // the drain BEFORE the RPC response returns) promotes the record before
      // ChatPanel's post-response `chatQueuedRetryRecordUpdated` can run. The
      // daemon publishes the post-edit snapshot ahead of the drain snapshot on
      // the same ordered socket, so the promotion always carries the edited
      // text. Also covers edits made from another client/window.
      if (parked.record.text === present.content) {
        remaining[id] = parked;
      } else {
        textSynced = true;
        remaining[id] = { ...parked, record: { ...parked.record, text: present.content } };
      }
    } else {
      drainedCount += 1;
      if (parked.turnId !== undefined) {
        // monorepo#1057: turnId-keyed records never promote via the
        // vanishing-id inference — `agent:queue:processing` (or the
        // sendQueuedMessageNow RPC turnId) is their exact signal. Keep the
        // record parked, but remember it: the clear-queue signature below
        // must still drop it (a cleared entry never drains, so no processing
        // event will ever arrive for it).
        remaining[id] = parked;
        vanishedTurnKeyed.push(id);
      } else if (promoted === null || parked.seq > promoted.seq) {
        promoted = parked;
      }
    }
  }
  if (queue.length === 0 && drainedCount > 1) {
    for (const id of vanishedTurnKeyed) delete remaining[id];
    return updateAgent(state, agentId, { queuedRetryRecords: remaining });
  }
  if (promoted === null) {
    return textSynced ? updateAgent(state, agentId, { queuedRetryRecords: remaining }) : state;
  }
  // A genuine drain promotion means the daemon dequeued the entry to RUN it
  // — the promoted record's turn is now the active turn, so a stale failure
  // banner from a previous turn must not persist over it (it also suppresses
  // the streaming indicator). The clear-queue signature branch above and the
  // pure text-sync path deliberately do NOT clear: those entries never run.
  return updateAgent(state, agentId, {
    lastAttemptedMessage: promoted.record,
    queuedRetryRecords: remaining,
    error: null,
    modelUnavailable: null,
  });
}

/**
 * Locate the parked record a drain-start / failure event names (monorepo
 * #1057): a `turnId` match wins — it survives the `agent.retry` redrive
 * requeue, which mints a NEW entry id but keeps the failed turn's original
 * `turnId` — with the entry-id key as the exact fallback for records parked
 * without one (older daemons). Returns the record's key, or null when
 * nothing matches (e.g. a redrive of an entry this client never parked —
 * promotion must NOT fall back to approximating with another record).
 */
function findParkedRecordKey(
  agent: ChatAgentState,
  messageId: string | undefined,
  turnId: string | undefined,
): string | null {
  if (turnId !== undefined) {
    for (const [id, parked] of Object.entries(agent.queuedRetryRecords)) {
      if (parked.turnId === turnId) return id;
    }
  }
  if (messageId !== undefined && messageId in agent.queuedRetryRecords) return messageId;
  return null;
}

/**
 * Exact drain-start promotion (monorepo#1057): `agent:queue:processing` (or
 * the `agent.sendQueuedMessageNow` delivered response, which carries the
 * `turnId` instead of the event, §5.5) says the daemon dequeued THIS entry to
 * run it — promote its parked record into `lastAttemptedMessage`, exactly
 * like the snapshot-diff drain promotion (including the stale-banner clear).
 * A no-op when nothing matches: the entry was never parked by this client,
 * or a no-turnId record was already promoted by the snapshot diff (the
 * shrunk `agent:queue:updated` precedes this event on the ordered socket) —
 * the already-promoted record left `queuedRetryRecords`, so this cannot
 * double-promote.
 */
function reduceQueueProcessing(
  state: ChatStateSlice,
  agentId: string,
  messageId: string,
  turnId: string | undefined,
): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  if (!agent) return state;
  const key = findParkedRecordKey(agent, messageId, turnId);
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
 * chat-send-service's queue-on-send success branch. `turnId` (monorepo#1057)
 * is the enqueue RPC's turn-correlation id when the daemon returned one —
 * records carrying it promote EXACTLY on `agent:queue:processing` /
 * `chatSendFailed` turnId matches instead of the snapshot-diff inference.
 */
export const chatQueuedRetryRecordSet = createAction<
  [agentId: string, messageId: string, record: LastAttemptedMessage, turnId?: string]
>('chatState/queuedRetryRecordSet');

/**
 * Park a retry payload for a send the DAEMON auto-queued mid-flight (#1011):
 * `agent.sendMessage` answered `{ queued: true, queuedMessage }` instead of
 * running a turn (agent mid-turn, quarantined session, or the turn-startup
 * race). The caller already overwrote `lastAttemptedMessage` with this payload
 * before the wire call — but no turn is running it, so leaving it there pairs
 * an in-flight turn's failure banner with the WRONG message. This action parks
 * the record under the queued entry's id (drain promotion then re-activates it
 * for the turn that actually runs it, see reduceQueueSnapshotDiff) and undoes
 * the mid-turn overwrite: `lastAttemptedMessage` is cleared only when it still
 * structurally equals the parked payload, so a concurrently recorded attempt
 * is never clobbered. Dispatched by the agent-stream-lifecycle queued branch.
 * `turnId` (monorepo#1057) — see `chatQueuedRetryRecordSet`; here it comes
 * from the auto-queued `agent.sendMessage` response's top-level `turnId` (or
 * the echoed `queuedMessage.turnId`).
 */
export const chatQueuedRetryRecordParked = createAction<
  [agentId: string, messageId: string, record: LastAttemptedMessage, turnId?: string]
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
 * Drop ALL parked retry records without promotion (#999). Two dispatch
 * sites: (1) a flow site that KNOWS the daemon discarded the whole queue —
 * `agent.editAndRegenerate` calls `clear_queue` (PROTOCOL §5.5) — so the
 * discarded entries never run and their records must not be promoted; the
 * snapshot-diff clear-queue signature (empty snapshot + >1 vanishing id)
 * cannot catch a SINGLE-entry discard (indistinguishable from a genuine
 * drain), and Electron does not order the event channel against the RPC
 * response: a late-arriving empty snapshot would promote the discarded
 * entry's payload over the flow's freshly recorded `lastAttemptedMessage`.
 * Dropping the records first makes that snapshot a no-op. (2) The events
 * bridge's `handleQueueUpdatedEvent` (#1032), which INFERS a clear from the
 * mirrored-count heuristic (empty snapshot wiping >1 last-snapshot entry)
 * for clears with no FE flow site — another client's `agent.forceMessage`.
 * turnId-keyed records (monorepo#1057) are dropped too: discarded entries
 * never drain, so no `agent:queue:processing` will ever promote them.
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
 * so no snapshot diff ever promoted it).
 */
export const chatSendFailed =
  createAction<[agentId: string, error: string, turnId?: string]>('chatState/sendFailed');

/**
 * `agent:queue:processing` drain-start signal (PROTOCOL §6.5): the daemon
 * dequeued entry `messageId` and is starting its turn — carrying the entry's
 * turn-correlation id when present. This is the EXACT promotion signal for
 * turnId-keyed retry records (monorepo#1057): the reducer promotes the parked
 * record whose `turnId` matches (falling back to the record keyed by
 * `messageId`), bypassing the snapshot-diff vanishing-id inference — which
 * misattributes on an `agent.retry` redrive (requeued entry: new id, same
 * turnId). Dispatched by the events bridge.
 */
export const chatQueueProcessingReceived = createAction<
  [agentId: string, messageId: string, turnId?: string]
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
    reduceQueueSnapshotDiff(state, agentId, messages),
  )
  .with(removeQueuedMessageFromAgentQueue, (state, { payload: [agentId, messageId] }) =>
    reduceQueuedRecordRemoved(state, agentId, messageId),
  )
  .with(chatQueueProcessingReceived, (state, { payload: [agentId, messageId, turnId] }) =>
    reduceQueueProcessing(state, agentId, messageId, turnId),
  )
  .with(chatSendFailed, (state, { payload: [agentId, error, turnId] }) => {
    // monorepo#1057: when the failure names a turn whose record is still
    // PARKED (e.g. an agent.retry redrive that failed again — its requeued
    // entry has a new id, so no snapshot diff or processing event promoted
    // it under this client's key), pair the banner with the exact record.
    // An already-promoted or unknown turnId leaves the slot untouched —
    // `lastAttemptedMessage` already holds the right payload (or none).
    const agent = state.byAgentId[agentId];
    const key = agent && turnId !== undefined ? findParkedRecordKey(agent, undefined, turnId) : null;
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

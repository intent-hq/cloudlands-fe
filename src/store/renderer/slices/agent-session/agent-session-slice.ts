import { deepEqual, shallowEqual } from 'fast-equals';
import type { AgentSession, AgentMessage, SessionStats } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
import type { CanonicalAgentStatusFields, WorkspaceEvent } from '$features/events/types';
import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  AgentHistorySegment,
  AgentSessionForkOptions,
  AgentSessionLaunchConfig,
  AgentSessionLaunchOptions,
  AgentSessionSendMessageOptions,
  AgentSessionState,
  StoredAgentSession,
} from './agent-session-types';
import {
  deduplicateAgentMessages,
  insertAgentMessageWithDedup,
  normalizeAgentMessage,
  normalizeDateValue,
  replaceAgentMessageByIdWithDedup,
} from '$shared/utils/message-dedup';
import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  chatSendStarted,
  chatSendFailed,
  chatInterrupted,
  chatStopCompleted,
  chatReset,
  chatStreamingReconciled,
  chatInitialized,
  chatTranscriptSnapshotApplied,
  streamCompleted,
  streamTimedOut,
} from '../chat-state/chat-state-slice';

export {
  computeMessageContentHash,
  hasCanonicalId,
  isTimestampClose,
} from '$shared/utils/message-dedup';

// ============================================================================
// Constants
// ============================================================================

/**
 * Single authoritative transcript cap: the store prunes each agent's messages
 * to the newest 200, and the transcript pagers (chat-read-service,
 * chat-read-saga's older-history fetch) deliberately stop fetching at the same
 * bound — pages past it would only be sliced off by the prune
 * (intent-hq/monorepo#2627). Kept small so a long ACTIVE conversation stays
 * memory-bounded in the renderer — evicted older rows are re-fetched on
 * demand by the scroll-to-load history segment. Keep pager bound and prune
 * cap coupled by importing this constant rather than mirroring the value.
 */
export const MAX_MESSAGES_PER_AGENT = 200;
/** Cap for the on-demand scrollback history segment (rows older than the tail). */
export const HISTORY_SEGMENT_MAX = 500;
const USER_REPLY_ORDER_WINDOW_MS = 1_000;

// ============================================================================
// Normalization helpers (copied from workspace-agents-slice)
// ============================================================================

type AgentFileChange = NonNullable<AgentSession['fileChanges']>[number];

function normalizeAgentFileChange(fileChange: AgentFileChange): AgentFileChange {
  return {
    ...fileChange,
    timestamp: normalizeDateValue(fileChange.timestamp),
  };
}

function normalizeAgentSession(agent: AgentSession): AgentSession {
  return {
    ...agent,
    createdAt: normalizeDateValue(agent.createdAt) ?? agent.createdAt,
    updatedAt: normalizeDateValue(agent.updatedAt) ?? agent.updatedAt,
    lastActivity: normalizeDateValue(agent.lastActivity),
    startedAt: normalizeDateValue(agent.startedAt),
    endedAt: normalizeDateValue(agent.endedAt),
    lastViewedAt: normalizeDateValue(agent.lastViewedAt),
    messages: agent.messages.map(normalizeAgentMessage),
    fileChanges: agent.fileChanges?.map(normalizeAgentFileChange),
  };
}

// ============================================================================
// Normalize / Prune helpers
// ============================================================================

function pruneMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_AGENT) return messages;
  return messages.slice(messages.length - MAX_MESSAGES_PER_AGENT);
}

function getTimestampMs(message: AgentMessage): number | null {
  const timestamp = message.timestamp;
  const ms = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp?.getTime?.();
  return typeof ms === 'number' && !Number.isNaN(ms) ? ms : null;
}

function areMessagesWithinUserReplyOrderWindow(a: AgentMessage, b: AgentMessage): boolean {
  const aMs = getTimestampMs(a);
  const bMs = getTimestampMs(b);
  if (aMs === null || bMs === null) return false;
  return Math.abs(aMs - bMs) <= USER_REPLY_ORDER_WINDOW_MS;
}

function repairNearSimultaneousOrphanAssistantOrdering(messages: AgentMessage[]): AgentMessage[] {
  let ordered = messages;
  for (let userIndex = 1; userIndex < ordered.length; userIndex++) {
    const userMessage = ordered[userIndex];
    if (userMessage.role !== 'user') continue;

    let runStart = userIndex;
    while (
      runStart > 0 &&
      ordered[runStart - 1].role === 'assistant' &&
      areMessagesWithinUserReplyOrderWindow(ordered[runStart - 1], userMessage)
    ) {
      runStart--;
    }

    if (runStart === userIndex || ordered[runStart - 1]?.role === 'user') continue;

    ordered = [
      ...ordered.slice(0, runStart),
      userMessage,
      ...ordered.slice(runStart, userIndex),
      ...ordered.slice(userIndex + 1),
    ];
  }
  return ordered;
}

/**
 * Order the transcript by the daemon's per-agent monotonic `seq` (PROTOCOL
 * §5.5) when any row carries one: seq-bearing rows sort ascending by seq;
 * rows WITHOUT a seq (optimistic user rows pre-echo, in-flight assistant
 * messages before the terminal frame) sort AFTER all seq-bearing rows,
 * preserving their local insertion order among themselves. `seq` lives in a
 * single clock domain (the daemon's), so this ordering is immune to
 * daemon/renderer clock skew — the idle-send transient inversion where a
 * skewed-ahead daemon timestamp on the user-row echo sorted the
 * renderer-clock in-flight assistant message above it cannot occur.
 *
 * Old-daemon compatibility: when NO row carries a seq (daemons predating the
 * per-message `seq` wire field, or purely-local transcripts), fall back to
 * the previous stable timestamp-ascending sort plus the near-simultaneous
 * orphan-assistant repair.
 */
function orderMessagesForConversation(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 1) return messages;
  if (messages.some((m) => typeof m.seq === 'number')) {
    const withSeq = messages
      .filter((m) => typeof m.seq === 'number')
      .sort((a, b) => (a.seq as number) - (b.seq as number));
    const withoutSeq = messages.filter((m) => typeof m.seq !== 'number');
    return [...withSeq, ...withoutSeq];
  }
  const sorted = [...messages].sort((a, b) => {
    const tsA =
      typeof a.timestamp === 'string' ? a.timestamp : (a.timestamp?.toISOString?.() ?? '');
    const tsB =
      typeof b.timestamp === 'string' ? b.timestamp : (b.timestamp?.toISOString?.() ?? '');
    if (tsA < tsB) return -1;
    if (tsA > tsB) return 1;
    return 0;
  });
  return repairNearSimultaneousOrphanAssistantOrdering(sorted);
}

function normalizeSortPruneMessages(messages: AgentMessage[]): AgentMessage[] {
  return pruneMessages(
    orderMessagesForConversation(deduplicateAgentMessages(messages.map(normalizeAgentMessage))),
  );
}

// ============================================================================
// History segment helpers (on-demand scrollback, bounded by HISTORY_SEGMENT_MAX)
// ============================================================================

const EMPTY_HISTORY_SEGMENT: AgentHistorySegment = {
  messages: [],
  gapToTail: false,
  oldestReached: false,
};

/**
 * Shift a seek-seeded segment's `startOrdinalEstimate` down by the number of
 * rows a prepend added BEFORE the previous first row (their position in the
 * merged order), floor 0. Untracked (serial-walk) segments stay untracked.
 */
function shiftStartOrdinalForPrepend(
  existing: AgentHistorySegment,
  merged: AgentMessage[],
): number | undefined {
  if (existing.startOrdinalEstimate === undefined) return undefined;
  const previousFirstId = existing.messages[0]?.id;
  if (previousFirstId === undefined) return existing.startOrdinalEstimate;
  const index = merged.findIndex((message) => message.id === previousFirstId);
  const addedOlder = index > 0 ? index : 0;
  return Math.max(0, existing.startOrdinalEstimate - addedOlder);
}

/** History rows use the tail's normalize/dedup/sort pipeline, minus the tail prune. */
function normalizeSortHistoryMessages(messages: AgentMessage[]): AgentMessage[] {
  return orderMessagesForConversation(
    deduplicateAgentMessages(messages.map(normalizeAgentMessage)),
  );
}

/**
 * Drop rows already present in the tail (identity by `id`/`appMessageId`, the
 * same identity keys the dedup helpers use) so a row never renders twice
 * across the two segments.
 */
function dropRowsPresentInTail(messages: AgentMessage[], tail: AgentMessage[]): AgentMessage[] {
  if (messages.length === 0 || tail.length === 0) return messages;
  const tailIds = new Set(tail.map((message) => message.id));
  const tailAppMessageIds = new Set(
    tail
      .map((message) => message.appMessageId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const filtered = messages.filter(
    (message) =>
      !tailIds.has(message.id) &&
      !(
        typeof message.appMessageId === 'string' &&
        message.appMessageId.length > 0 &&
        tailAppMessageIds.has(message.appMessageId)
      ),
  );
  return filtered.length === messages.length ? messages : filtered;
}

function getHistorySegment(
  state: AgentSessionState,
  agentId: string,
): AgentHistorySegment | undefined {
  return state.historySegmentsByAgentId?.[agentId];
}

function setHistorySegment(
  state: AgentSessionState,
  agentId: string,
  segment: AgentHistorySegment,
): AgentSessionState {
  return {
    ...state,
    historySegmentsByAgentId: { ...state.historySegmentsByAgentId, [agentId]: segment },
  };
}

function removeHistorySegment(state: AgentSessionState, agentId: string): AgentSessionState {
  if (!state.historySegmentsByAgentId || !(agentId in state.historySegmentsByAgentId)) {
    return state;
  }
  const { [agentId]: _, ...rest } = state.historySegmentsByAgentId;
  return { ...state, historySegmentsByAgentId: rest };
}

/** Remove the history segments of every agent in `agentIds`; no-op when none is present. */
function removeHistorySegmentsFor(
  state: AgentSessionState,
  agentIds: Iterable<string>,
): AgentSessionState {
  let next = state;
  for (const agentId of agentIds) {
    next = removeHistorySegment(next, agentId);
  }
  return next;
}

/**
 * Reuse prior message object identities when a full replacement contains rows
 * structurally equal to ones already in the store, so a background
 * older-history prepend does not re-render the already-rendered suffix of the
 * transcript. Returns the previous array itself when the replacement is
 * entirely equivalent (position-for-position), letting the reducer no-op.
 *
 * PERF: this runs on every `replaceMessages` dispatch, including per-emit
 * transcript applies during streaming. Its per-emit cost stays O(rows) only
 * because upstream emitters preserve unchanged-row identity — the transcript
 * reconciler reuses unchanged message objects across emits and the
 * older-history saga merges against the store's own rows — so each deepEqual
 * short-circuits on reference-equal nested fields (contentBlocks, metadata).
 * A change that rebuilds row objects per emit would silently degrade this to
 * O(transcript bytes) per streaming tick; keep that invariant upstream.
 */
function reconcileMessageIdentities(
  previous: AgentMessage[],
  next: AgentMessage[],
): AgentMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]));
  let unchanged = next.length === previous.length;
  const reconciled = next.map((message, index) => {
    const prior = previousById.get(message.id);
    if (prior && (prior === message || deepEqual(prior, message))) {
      if (prior !== previous[index]) unchanged = false;
      return prior;
    }
    unchanged = false;
    return message;
  });
  return unchanged ? previous : reconciled;
}

function isOptimisticUserMessage(message: AgentMessage): boolean {
  return (
    message.role === 'user' &&
    typeof message.id === 'string' &&
    message.id.startsWith('optimistic_')
  );
}

function mergeMissingOptimisticUserMessages(
  incomingMessages: AgentMessage[],
  existingMessages: AgentMessage[],
): AgentMessage[] {
  const incomingIds = new Set(incomingMessages.map((message) => message.id));
  const incomingAppMessageIds = new Set(
    incomingMessages.map((message) => message.appMessageId).filter(Boolean),
  );
  const missingOptimisticMessages = existingMessages.filter(
    (message) =>
      isOptimisticUserMessage(message) &&
      !incomingIds.has(message.id) &&
      (!message.appMessageId || !incomingAppMessageIds.has(message.appMessageId)),
  );
  if (missingOptimisticMessages.length === 0) return incomingMessages;
  return normalizeSortPruneMessages([...incomingMessages, ...missingOptimisticMessages]);
}

// ============================================================================
// State helpers
// ============================================================================

/** Normalize incoming session and keep its messages as an ordered array. */
function toStoredSession(session: AgentSession): StoredAgentSession {
  const normalized = normalizeAgentSession(session);
  const messages = normalizeSortPruneMessages(normalized.messages || []);
  return { ...normalized, messages };
}

function getSession(state: AgentSessionState, agentId: string): StoredAgentSession | undefined {
  return state.byAgentId[agentId];
}

function setSession(
  state: AgentSessionState,
  agentId: string,
  session: StoredAgentSession,
): AgentSessionState {
  return {
    ...state,
    byAgentId: { ...state.byAgentId, [agentId]: session },
  };
}

/**
 * Count how many of the rows a tail cap prune dropped were resident in the
 * PREVIOUS tail. Distinguishes genuine live growth past the cap (dropped
 * rows were tail-resident and are now lost client-side) from a
 * prepend-shaped replacement whose added older rows are sliced right back
 * off (those were never in the tail and are still hydrated elsewhere).
 */
function countDroppedResidentTailRows(
  previous: AgentMessage[],
  ordered: AgentMessage[],
  pruned: AgentMessage[],
): number {
  const droppedCount = ordered.length - pruned.length;
  if (droppedCount === 0 || previous.length === 0) return 0;
  const previousIds = new Set(previous.map((message) => message.id));
  let count = 0;
  for (let i = 0; i < droppedCount; i++) {
    if (previousIds.has(ordered[i].id)) count++;
  }
  return count;
}

/**
 * History-segment bookkeeping for rows the live tail's
 * `MAX_MESSAGES_PER_AGENT` prune dropped: the dropped rows now sit between
 * history's newest row and the tail's oldest retained row, so a contiguous
 * segment is severed (the gap opens) and serial-walk segments count the
 * dropped rows into the hole estimate so the virtual extent attributes them
 * to the hole. The per-session `tailCapPruned` latch is set by the caller
 * alongside the pruned messages array.
 */
function accountTailCapPrune(
  state: AgentSessionState,
  agentId: string,
  dropped: number,
): AgentSessionState {
  const segment = getHistorySegment(state, agentId);
  if (!segment || segment.messages.length === 0) return state;
  return setHistorySegment(state, agentId, {
    ...segment,
    gapToTail: true,
    ...(segment.startOrdinalEstimate === undefined
      ? { holeRowsEstimate: (segment.holeRowsEstimate ?? 0) + dropped }
      : {}),
  });
}

function addMessageToSession(
  state: AgentSessionState,
  agentId: string,
  message: AgentMessage,
): AgentSessionState {
  const session = getSession(state, agentId);
  if (!session) return state;
  const currentList = session.messages;
  const insertedMessages = insertAgentMessageWithDedup(currentList, message);
  if (insertedMessages === currentList) return state;
  const ordered = orderMessagesForConversation(insertedMessages);
  const nextMessages = pruneMessages(ordered);
  const droppedResident = countDroppedResidentTailRows(currentList, ordered, nextMessages);
  let next = setSession(state, agentId, {
    ...session,
    messages: nextMessages,
    ...(droppedResident > 0 ? { tailCapPruned: true } : {}),
  });
  if (droppedResident > 0) next = accountTailCapPrune(next, agentId, droppedResident);
  return next;
}

function replaceSessionMessageById(
  state: AgentSessionState,
  agentId: string,
  oldId: string,
  newMessage: AgentMessage,
): AgentSessionState {
  const session = getSession(state, agentId);
  if (!session) return state;
  if (!session.messages.some((message) => message.id === oldId)) return state;
  const currentList = session.messages;
  const nextMessages = replaceAgentMessageByIdWithDedup(currentList, oldId, newMessage);
  if (nextMessages === currentList) return state;
  return setSession(state, agentId, {
    ...session,
    messages: nextMessages,
  });
}

function updateSessionFields(
  state: AgentSessionState,
  agentId: string,
  partial: Partial<Omit<StoredAgentSession, 'messages'>>,
): AgentSessionState {
  const existing = getSession(state, agentId);
  if (!existing) return state;
  const merged = { ...existing, ...partial };
  if (shallowEqual(existing, merged)) return state;
  return setSession(state, agentId, merged);
}

type CanonicalAgentSessionUpdates = {
  status?: AgentSession['status'];
  activationState?: AgentSession['activationState'];
  isActive?: boolean;
  isStreaming?: boolean;
  isProcessing?: boolean;
  isResponding?: boolean;
  stopReason?: string | null;
  stopReasonTimestamp?: string | null;
  sessionCorrupted?: boolean;
  lastAgentResponse?: string;
  processQueueHint?: AgentSession['processQueueHint'];
  isWaitingForOtherAgents?: boolean;
  waitingForAgentIds?: string[];
  waitingOnHooks?: AgentSession['waitingOnHooks'];
  waitingOnPrMonitors?: AgentSession['waitingOnPrMonitors'];
  liveTurnOpen?: boolean;
  liveTurnOpenedAt?: string | undefined;
};

/** Wire statuses that mean a turn is running (lowercase IPC + PascalCase enum). */
const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'Active',
  'processing',
  'Processing',
  'responding',
  'Responding',
]);

/** Wire statuses that mean the turn/session ended (lowercase IPC + PascalCase enum). */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'idle',
  'Idle',
  'completed',
  'Completed',
  'failed',
  'error',
  'deleted',
]);

type CanonicalAgentStatusWithSummary = CanonicalAgentStatusFields & {
  lastResponseSummary?: unknown;
  isWaitingForOtherAgents?: unknown;
  waitingForAgentIds?: unknown;
};

function canonicalSessionUpdates(
  fields: CanonicalAgentStatusWithSummary,
  eventTimestamp?: string,
): CanonicalAgentSessionUpdates {
  const updates: CanonicalAgentSessionUpdates = {};
  if (fields.status !== null && fields.status !== undefined) {
    updates.status = fields.status as AgentSession['status'];
  }
  if (fields.activationState !== null && fields.activationState !== undefined) {
    updates.activationState = fields.activationState as AgentSession['activationState'];
  }
  if (fields.isActive !== null && fields.isActive !== undefined) updates.isActive = fields.isActive;
  if (fields.isStreaming !== null && fields.isStreaming !== undefined) {
    updates.isStreaming = fields.isStreaming;
  }
  if (fields.isProcessing !== null && fields.isProcessing !== undefined) {
    updates.isProcessing = fields.isProcessing;
  }
  if (fields.isResponding !== null && fields.isResponding !== undefined) {
    updates.isResponding = fields.isResponding;
  }
  // Only update stopReason when the key exists on the payload to avoid
  // clobbering a previously-set error text from agent:failed when
  // agent:status-changed arrives without a stopReason field.
  if (Object.prototype.hasOwnProperty.call(fields, 'stopReason')) {
    updates.stopReason = fields.stopReason;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'stopReasonTimestamp')) {
    updates.stopReasonTimestamp = fields.stopReasonTimestamp;
  }
  // sessionCorrupted is omitted-when-false on the wire (monorepo#940): apply
  // it when present, and clear any stale flag on a status transition that
  // arrives without it (e.g. after agent.retry recreates the provider session).
  if (fields.sessionCorrupted === true) {
    updates.sessionCorrupted = true;
  } else if (fields.status !== null && fields.status !== undefined) {
    updates.sessionCorrupted = false;
  }
  if (typeof fields.lastResponseSummary === 'string' && fields.lastResponseSummary.trim()) {
    updates.lastAgentResponse = fields.lastResponseSummary;
  }

  if (typeof fields.isWaitingForOtherAgents === 'boolean') {
    updates.isWaitingForOtherAgents = fields.isWaitingForOtherAgents;
  }
  if (Array.isArray(fields.waitingForAgentIds)) {
    updates.waitingForAgentIds = fields.waitingForAgentIds.filter(
      (id): id is string => typeof id === 'string',
    );
  }
  // waitingOnHooks/waitingOnPrMonitors (§3.1/§5.42): fold the live event's
  // list straight onto the session so HUD idle-bucketing (hud-selectors.ts)
  // doesn't have to wait on the async agent.list re-hydration. Presence-only
  // (same convention as waitingForAgentIds above) — the `agent:idle` branch
  // of canonicalFieldsFromWorkspaceEvent defaults the field to `[]` when
  // absent (protocol stamps it on every idle emit site, omitted only when
  // empty), so an idle event always clears a stale list; other canonical
  // event types that don't carry the field leave the existing value alone.
  if (Array.isArray(fields.waitingOnHooks)) updates.waitingOnHooks = fields.waitingOnHooks;
  if (Array.isArray(fields.waitingOnPrMonitors)) {
    updates.waitingOnPrMonitors = fields.waitingOnPrMonitors;
  }

  const isRunningTransition =
    fields.isActive === true &&
    typeof fields.status === 'string' &&
    RUNNING_STATUSES.has(fields.status);
  if (isRunningTransition && typeof fields.isWaitingForOtherAgents !== 'boolean') {
    updates.isWaitingForOtherAgents = false;
    if (!Array.isArray(fields.waitingForAgentIds)) updates.waitingForAgentIds = [];
  }
  if (isRunningTransition) {
    updates.liveTurnOpen = true;
    // Stamp the daemon's own event timestamp (never renderer-generated) so
    // the monorepo#1815 stale-snapshot guard has an ordering signal.
    if (typeof eventTimestamp === 'string') updates.liveTurnOpenedAt = eventTimestamp;
  }

  // When the status indicates a terminal/idle state, default streaming flags
  // to false unless the caller explicitly provided them.
  if (
    fields.isActive === false ||
    (typeof fields.status === 'string' && TERMINAL_STATUSES.has(fields.status))
  ) {
    updates.isStreaming = fields.isStreaming ?? false;
    updates.isProcessing = fields.isProcessing ?? false;
    updates.isResponding = fields.isResponding ?? false;
    updates.liveTurnOpen = false;
    updates.liveTurnOpenedAt = undefined;
  }

  // Defensively clear processQueueHint when agent transitions to normal running state
  // or terminal state. This handles reconnect cases where agent:process:resumed may
  // not arrive, and prevents stale hints after failed/idle transitions.
  if (
    fields.isResponding === true ||
    fields.isActive === true ||
    (typeof fields.status === 'string' && TERMINAL_STATUSES.has(fields.status))
  ) {
    updates.processQueueHint = undefined;
  }

  return updates;
}

function canonicalFieldsFromWorkspaceEvent(event: {
  type?: string;
  data?: any;
}): [string, CanonicalAgentStatusFields] | null {
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const agentId = data.agentId ?? data.sessionId;
  if (!agentId) return null;

  if (event.type === 'agent:idle') {
    return [
      agentId,
      {
        ...data,
        status: data.status ?? 'idle',
        activationState: data.activationState ?? null,
        isActive: data.isActive ?? false,
        isStreaming: data.isStreaming ?? false,
        isProcessing: data.isProcessing ?? false,
        isResponding: data.isResponding ?? false,
        stopReason: data.stopReason ?? data.finishReason ?? null,
        stopReasonTimestamp: data.stopReasonTimestamp ?? null,
        // waitingOnHooks/waitingOnPrMonitors (§3.1/§5.42) are stamped on
        // EVERY idle emit site, omitted only when empty (never absent for
        // lack-of-support — an older daemon simply never populates them) —
        // default to [] so a stale list from a prior idle is cleared.
        waitingOnHooks: data.waitingOnHooks ?? [],
        waitingOnPrMonitors: data.waitingOnPrMonitors ?? [],
      },
    ];
  }
  if (event.type === 'agent:failed') {
    return [
      agentId,
      {
        ...data,
        status: data.status ?? 'error',
        activationState: data.activationState ?? 'error',
        isActive: data.isActive ?? false,
        isStreaming: data.isStreaming ?? false,
        isProcessing: data.isProcessing ?? false,
        isResponding: data.isResponding ?? false,
        stopReason: data.stopReason ?? data.error ?? null,
        stopReasonTimestamp: data.stopReasonTimestamp ?? null,
      },
    ];
  }
  if (event.type === 'agent:session-completed') {
    return [
      agentId,
      {
        ...data,
        status: data.status ?? 'completed',
        activationState: data.activationState ?? null,
        isActive: data.isActive ?? false,
        isStreaming: data.isStreaming ?? false,
        isProcessing: data.isProcessing ?? false,
        isResponding: data.isResponding ?? false,
        stopReason: data.stopReason ?? data.finishReason ?? null,
        stopReasonTimestamp: data.stopReasonTimestamp ?? null,
      },
    ];
  }
  if (event.type === 'agent:status-changed' || event.type === 'agent:session-updated') {
    return [agentId, data];
  }
  if (event.type === 'agent:subscriptions-changed') {
    return [agentId, data];
  }
  return null;
}

function userMessageFromWorkspaceEvent(event: WorkspaceEvent): [string, AgentMessage] | null {
  if (event.type !== 'agent:user-message:sent') return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const { agentId, messageId, appMessageId, content } = data;
  if (
    typeof agentId !== 'string' ||
    typeof messageId !== 'string' ||
    typeof content !== 'string' ||
    typeof event.timestamp !== 'string'
  ) {
    return null;
  }

  const contentBlocks: NonNullable<AgentMessage['contentBlocks']> = [
    { type: 'text', text: content },
  ];
  if (Array.isArray(data.imageBlocks)) {
    contentBlocks.push(...data.imageBlocks);
  }
  // Attachment-reference file blocks ride the event too, so other clients
  // render the file chips without waiting for a conversation refetch.
  if (Array.isArray(data.fileBlocks)) {
    contentBlocks.push(...data.fileBlocks);
  }

  return [
    agentId,
    {
      id: messageId,
      ...(typeof appMessageId === 'string' && appMessageId.length > 0 ? { appMessageId } : {}),
      role: 'user',
      contentBlocks,
      timestamp: event.timestamp,
    },
  ];
}

/**
 * Extract the `(agentId, stats)` pair from an `agent:session-stats-changed`
 * event (PROTOCOL §5.24). The payload prefers `agentId` and falls back to
 * `sessionId` since the daemon keys the FE session by agent id.
 */
function statsFromWorkspaceEvent(event: WorkspaceEvent): [string, SessionStats] | null {
  if (event.type !== 'agent:session-stats-changed') return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const agentId = data.agentId ?? data.sessionId;
  if (typeof agentId !== 'string' || agentId.length === 0) return null;
  const stats = data.stats;
  if (!stats || typeof stats !== 'object') return null;
  const { creditsUsed, messageCount, toolCount } = stats;
  if (
    (creditsUsed !== null && typeof creditsUsed !== 'number') ||
    typeof messageCount !== 'number' ||
    typeof toolCount !== 'number'
  ) {
    return null;
  }
  return [agentId, { creditsUsed, messageCount, toolCount }];
}

function registerInWorkspaceIndex(
  state: AgentSessionState,
  agentId: string,
  wsId: string,
): AgentSessionState {
  const existing = state.agentIdsByWorkspace[wsId] ?? [];
  if (existing.includes(agentId)) return state;
  return {
    ...state,
    agentIdsByWorkspace: {
      ...state.agentIdsByWorkspace,
      [wsId]: [...existing, agentId],
    },
  };
}

type SessionComparisonSnapshot = Pick<
  StoredAgentSession,
  | 'status'
  | 'name'
  | 'model'
  | 'isStreaming'
  | 'isProcessing'
  | 'isResponding'
  | 'isWaitingOnTool'
  | 'isWaitingForOtherAgents'
  | 'digest'
  | 'lastMessageRole'
  | 'lastUserMessage'
  | 'lastAgentResponse'
  | 'backendSessionId'
  | 'acpSessionId'
  | 'createdAt'
  | 'updatedAt'
  | 'lastActivity'
  | 'hasUnread'
  | 'currentTurnNumber'
  | 'isBackground'
  | 'activationState'
  | 'isActive'
  | 'stopReason'
  | 'stopReasonTimestamp'
  | 'sessionCorrupted'
> & {
  messageCount: number;
  wireMessageCount: number | undefined;
  lastMessageId: AgentMessage['id'] | undefined;
  wireLastMessageId: string | undefined;
  lastMessageBlockCount: number;
  attentionRequestKind: string | undefined;
  attentionRequestReason: string | undefined;
  attentionRequestTimestamp: string | undefined;
  specialist: string | undefined;
  completionReport: string | undefined;
  taskNoteId: string | undefined;
  dismissedQuestionsMessageId: string | undefined;
  pendingQuestionsMessageId: string | undefined;
  lastSeenMessageId: string | undefined;
  sandboxId: string | undefined;
  sandboxPath: string | undefined;
  sandboxBranch: string | undefined;
  waitingForAgentIdsKey: string | undefined;
  turnInFlight: boolean | undefined;
  liveTurnOpen: boolean | undefined;
  liveTurnOpenedAt: string | undefined;
  tailCapPruned: boolean | undefined;
  harnessVersion: string | undefined;
  harnessFeaturesKey: string | undefined;
};

function toSessionComparisonSnapshot(session: StoredAgentSession): SessionComparisonSnapshot {
  const messages = session.messages;
  const attentionRequest = getAgentAttentionRequest(session);
  const metadata = session.metadata;
  return {
    status: session.status,
    name: session.name,
    model: session.model,
    isStreaming: session.isStreaming,
    isProcessing: session.isProcessing,
    isResponding: session.isResponding,
    isWaitingOnTool: session.isWaitingOnTool,
    isWaitingForOtherAgents: session.isWaitingForOtherAgents,
    digest: session.digest,
    lastMessageRole: session.lastMessageRole,
    lastUserMessage: session.lastUserMessage,
    lastAgentResponse: session.lastAgentResponse,
    // Wire lastMessageId (§5.5 AgentLite, monorepo#1597) — one input of the
    // hasUnread derivation; distinct key because `lastMessageId` below is the
    // transcript-derived last message id.
    wireLastMessageId:
      typeof session.lastMessageId === 'string' ? session.lastMessageId : undefined,
    backendSessionId: session.backendSessionId,
    acpSessionId: session.acpSessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivity: session.lastActivity,
    hasUnread: session.hasUnread,
    currentTurnNumber: session.currentTurnNumber,
    isBackground: session.isBackground,
    activationState: session.activationState,
    isActive: session.isActive,
    stopReason: session.stopReason,
    stopReasonTimestamp: session.stopReasonTimestamp,
    sessionCorrupted: session.sessionCorrupted,
    attentionRequestKind: attentionRequest?.kind,
    attentionRequestReason: attentionRequest?.reason,
    attentionRequestTimestamp: attentionRequest?.timestamp,
    specialist: typeof metadata?.specialist === 'string' ? metadata.specialist : undefined,
    completionReport:
      typeof metadata?.completionReport === 'string' ? metadata.completionReport : undefined,
    taskNoteId: typeof metadata?.taskNoteId === 'string' ? metadata.taskNoteId : undefined,
    dismissedQuestionsMessageId:
      typeof metadata?.dismissedQuestionsMessageId === 'string'
        ? metadata.dismissedQuestionsMessageId
        : undefined,
    pendingQuestionsMessageId:
      typeof metadata?.pendingQuestionsMessageId === 'string'
        ? metadata.pendingQuestionsMessageId
        : undefined,
    lastSeenMessageId:
      typeof metadata?.lastSeenMessageId === 'string' ? metadata.lastSeenMessageId : undefined,
    sandboxId: typeof metadata?.sandboxId === 'string' ? metadata.sandboxId : undefined,
    sandboxPath: typeof metadata?.sandboxPath === 'string' ? metadata.sandboxPath : undefined,
    sandboxBranch: typeof metadata?.sandboxBranch === 'string' ? metadata.sandboxBranch : undefined,
    waitingForAgentIdsKey: Array.isArray(session.waitingForAgentIds)
      ? session.waitingForAgentIds.join(',')
      : undefined,
    turnInFlight: session.turnInFlight === true ? true : undefined,
    liveTurnOpen: session.liveTurnOpen === true ? true : undefined,
    liveTurnOpenedAt:
      typeof session.liveTurnOpenedAt === 'string' ? session.liveTurnOpenedAt : undefined,
    tailCapPruned: session.tailCapPruned === true ? true : undefined,
    // Harness stamp (§5.5, additive): normally immutable, but a daemon
    // upgrade backfills harnessVersion on legacy rows and first activation
    // materializes harnessFeatures — those upserts must not be swallowed
    // (e.g. the AgentCard "Harness vX.Y" menu item would never appear).
    harnessVersion: typeof session.harnessVersion === 'string' ? session.harnessVersion : undefined,
    harnessFeaturesKey: session.harnessFeatures
      ? Object.entries(session.harnessFeatures)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => `${k}=${v}`)
          .join(',')
      : undefined,
    messageCount: messages.length,
    wireMessageCount: typeof session.messageCount === 'number' ? session.messageCount : undefined,
    lastMessageId: messages.length === 0 ? undefined : messages[messages.length - 1]?.id,
    // The daemon can append trailing blocks to an already-stored message
    // (e.g. the §7.1 lifted proposal-resource block the live accumulator
    // missed), leaving count/id unchanged — include the last message's block
    // count so re-hydration is not swallowed as a no-op.
    lastMessageBlockCount:
      messages.length === 0 ? 0 : (messages[messages.length - 1]?.contentBlocks?.length ?? 0),
  };
}

/**
 * Shallow equivalence check for upsertSession no-op guard.
 * Compares key scalar fields, wire message signals, and loaded transcript
 * count / last message ID / last message content-block count to avoid creating
 * new state references when nothing changed.
 */
function isSessionEquivalent(a: StoredAgentSession, b: StoredAgentSession): boolean {
  return shallowEqual(toSessionComparisonSnapshot(a), toSessionComparisonSnapshot(b));
}

type SessionUpsertStorageOptions = {
  preserveExplicitRuntimeFlags: boolean;
  allowActiveTurnRuntimeFlagClear: boolean;
};

function applySessionUpsert(
  state: AgentSessionState,
  session: AgentSession,
  options: SessionUpsertStorageOptions,
): AgentSessionState {
  const finalSession = toStoredSession(session);
  const agentId = String(finalSession.id);
  const wsId = String(session.workspaceId);
  const existing = getSession(state, agentId);

  // The latch is FE-owned: wire sessions never carry it, so an upsert must
  // not clear it. An incoming snapshot itself overflowing the cap also
  // latches (its overflow rows were just dropped client-side). No hole
  // accounting here — a re-delivered snapshot must not double-count.
  if (
    existing?.tailCapPruned === true ||
    (session.messages?.length ?? 0) > MAX_MESSAGES_PER_AGENT
  ) {
    finalSession.tailCapPruned = true;
  }

  if (existing) {
    // When a turn is actively in flight (both runtime flags set, e.g. right
    // after chatSendStarted started a queued turn), a session snapshot's
    // explicit `false` is stale for these ephemeral flags and must not clobber
    // the live turn — only explicit clear actions (streamCompleted,
    // setAgentStreaming, chatStopCompleted, …) may end it. Deliberate
    // upsert-based clears (e.g. the stream safety timeout) flip a flag off
    // first, so this pair-guard never blocks them.
    const activeTurnInFlight = existing.isStreaming === true && existing.isProcessing === true;
    if (activeTurnInFlight) {
      finalSession.messages = mergeMissingOptimisticUserMessages(
        finalSession.messages,
        existing.messages,
      );
    }
    if (
      existing.isStreaming &&
      ((activeTurnInFlight && !options.allowActiveTurnRuntimeFlagClear) ||
        options.preserveExplicitRuntimeFlags ||
        finalSession.isStreaming === undefined)
    ) {
      finalSession.isStreaming = true;
    }
    if (
      existing.isProcessing &&
      ((activeTurnInFlight && !options.allowActiveTurnRuntimeFlagClear) ||
        options.preserveExplicitRuntimeFlags ||
        finalSession.isProcessing === undefined)
    ) {
      finalSession.isProcessing = true;
    }

    // Guard: if agent:idle/streamCompleted already cleared the streaming
    // flags (existing is authoritatively idle), don't let stale incoming
    // data from an async saga re-introduce isStreaming=true.
    // Only chatSendStarted should transition idle→streaming.
    const existingStatus = existing.status as string;
    if (
      (existingStatus === AgentStatus.Idle || existingStatus === 'idle') &&
      existing.stopReason &&
      !existing.isStreaming
    ) {
      finalSession.isStreaming = false;
      finalSession.isProcessing = false;
    }

    // Guard: if a live event (agent:failed/agent:idle) already set stopReason,
    // don't let an older hydration snapshot lacking the field clobber it.
    // Only update stopReason when the key exists on the incoming session.
    // This mirrors the canonicalSessionUpdates guard from Phase 1.
    if (
      existing.stopReason !== undefined &&
      !Object.prototype.hasOwnProperty.call(session, 'stopReason')
    ) {
      finalSession.stopReason = existing.stopReason;
    }
    if (
      existing.stopReasonTimestamp !== undefined &&
      !Object.prototype.hasOwnProperty.call(session, 'stopReasonTimestamp')
    ) {
      finalSession.stopReasonTimestamp = existing.stopReasonTimestamp;
    }
    if (
      existing.lastAgentResponse !== undefined &&
      !Object.prototype.hasOwnProperty.call(session, 'lastAgentResponse')
    ) {
      finalSession.lastAgentResponse = existing.lastAgentResponse;
    }
    if (existing.liveTurnOpen === true && finalSession.liveTurnOpen === undefined) {
      const incomingClosed =
        session.isActive === false ||
        (typeof session.status === 'string' && TERMINAL_STATUSES.has(session.status));
      if (!incomingClosed) {
        finalSession.liveTurnOpen = true;
        finalSession.liveTurnOpenedAt = existing.liveTurnOpenedAt;
      }
    }

    // Guard (monorepo#1815): an agents.list snapshot fetched while the daemon
    // still reported a failure can land AFTER the live crash-recovery edges
    // (error→pending→active, stopReason:null) already converged the session
    // onto the redriven turn. When a live running edge opened a turn
    // (liveTurnOpen) and the existing status is running, an incoming
    // failure-status snapshot whose failure PREDATES that live edge
    // (stopReasonTimestamp ≤ liveTurnOpenedAt, both daemon-stamped) is
    // provably stale — keep the recovered live fields instead of regressing
    // status/stopReason (which re-arms the "Response failed" banner over the
    // streaming turn). A failure the ordering signal cannot prove stale still
    // applies: a daemon crash mid-turn (monorepo#1250) emits no terminal edge,
    // so the parked error arrives ONLY via snapshot, with a
    // stopReasonTimestamp recorded after the live edge (or with the signal
    // absent) — that convergence path must never be blocked.
    const incomingStatus = finalSession.status as string;
    if (
      existing.liveTurnOpen === true &&
      RUNNING_STATUSES.has(existing.status as string) &&
      (incomingStatus === 'error' || incomingStatus === 'failed') &&
      typeof existing.liveTurnOpenedAt === 'string' &&
      typeof finalSession.stopReasonTimestamp === 'string' &&
      finalSession.stopReasonTimestamp <= existing.liveTurnOpenedAt
    ) {
      finalSession.status = existing.status;
      finalSession.activationState = existing.activationState;
      finalSession.isActive = existing.isActive;
      finalSession.stopReason = existing.stopReason;
      finalSession.stopReasonTimestamp = existing.stopReasonTimestamp;
      finalSession.sessionCorrupted = existing.sessionCorrupted;
      finalSession.liveTurnOpen = true;
      finalSession.liveTurnOpenedAt = existing.liveTurnOpenedAt;
    }
  }

  const alreadyIndexed = (state.agentIdsByWorkspace[wsId] ?? []).includes(agentId);
  if (existing && alreadyIndexed && isSessionEquivalent(existing, finalSession)) {
    return state;
  }

  let next = setSession(state, agentId, finalSession);
  next = registerInWorkspaceIndex(next, agentId, wsId);
  return next;
}

function removeFromWorkspaceIndex(state: AgentSessionState, agentId: string): AgentSessionState {
  const agentIdsByWorkspace = { ...state.agentIdsByWorkspace };
  for (const wsId of Object.keys(agentIdsByWorkspace)) {
    const agents = agentIdsByWorkspace[wsId];
    const filtered = agents.filter((id) => id !== agentId);
    if (filtered.length !== agents.length) {
      if (filtered.length === 0) {
        delete agentIdsByWorkspace[wsId];
      } else {
        agentIdsByWorkspace[wsId] = filtered;
      }
    }
  }
  return { ...state, agentIdsByWorkspace };
}

// ============================================================================
// Initial State
// ============================================================================

export const initialState: AgentSessionState = {
  byAgentId: {},
  agentIdsByWorkspace: {},
};

// ============================================================================
// Actions
// ============================================================================

/** Upsert a session — normalize dates, order/prune messages to `MAX_MESSAGES_PER_AGENT`, register in workspace index */
export const upsertSession = createAction<[session: AgentSession]>('agentSessions/upsertSession');

/** Remove a session by agentId (from byAgentId and agentIdsByWorkspace) */
export const removeSession = createAction<[agentId: string]>('agentSessions/removeSession');

/** Set streaming flag for an agent. Streaming state is agent/session-scoped. */
export const setAgentStreaming = createAction<[agentId: string, isStreaming: boolean]>(
  'agentSessions/setAgentStreaming',
);

/** Add a single message (normalize, exact-ID guard, prune) */
export const addMessage = createAction<[agentId: string, message: AgentMessage]>(
  'agentSessions/addMessage',
);

/** Update a single message by messageId */
export const updateMessage = createAction<
  [agentId: string, messageId: string, updates: Partial<AgentMessage>]
>('agentSessions/updateMessage');

/** Full replacement of messages (normalize/order/prune) */
export const replaceMessages = createAction<[agentId: string, messages: AgentMessage[]]>(
  'agentSessions/replaceMessages',
);

/** Atomically remove a single message by ID */
export const removeMessage = createAction<[agentId: string, messageId: string]>(
  'agentSessions/removeMessage',
);

/**
 * Swaps the message at the matched index in place. Does not re-sort — the
 * caller must ensure the new message is semantically close enough to the old
 * one (same logical turn). Used by the saga's content-match dedup to preserve
 * canonical-ID without reordering.
 *
 * If a duplicate message already exists (same ID, or equivalent canonical
 * assistant content from the same turn), that stale entry is dropped so the
 * list never contains duplicate logical messages.
 */
export const replaceMessageById = createAction<
  [agentId: string, oldId: string, newMessage: AgentMessage]
>('agentSessions/replaceMessageById');

/** Non-message field updates (plus the FE-owned sticky liveness fields). */
export const updateSession = createAction<
  [
    agentId: string,
    updates: Partial<AgentSession> & Pick<StoredAgentSession, 'liveTurnOpen' | 'liveTurnOpenedAt'>,
  ]
>('agentSessions/updateSession');

/** Saga-owned core stop side effect trigger. */
export const agentSessionStopChatRequested = createAsyncAction<[agentId: string], void>(
  'agentSessions/stopChat',
  'agentSessions/stopChatRequested',
);

/** Saga-owned persistent question dismissal trigger. */
export const agentSessionDismissQuestionsRequested = createAsyncAction<
  [agentId: string, wsId: string, messageId: string],
  void
>('agentSessions/dismissQuestions', 'agentSessions/dismissQuestionsRequested');

/**
 * Saga-owned pending-proposal resolution trigger (`agent.resolveProposal`,
 * PROTOCOL §5.5). Success reconciles the proposal-lifecycle slice
 * (`proposalResolutionReconciled`); failure surfaces a toast and leaves the
 * proposal pending.
 */
export const agentProposalResolveRequested = createAsyncAction<
  [
    agentId: string,
    wsId: string,
    request: { proposalId: string; outcome: 'applied' | 'dismissed'; detail?: string },
  ],
  void
>('agentSessions/resolveProposal', 'agentSessions/resolveProposalRequested');

/** Saga-owned agent launch side effect trigger. Resolves with the created session. */
export const agentSessionLaunchAgentRequested = createAsyncAction<
  [wsId: string, config: AgentSessionLaunchConfig, options?: AgentSessionLaunchOptions],
  AgentSession
>('agentSessions/launchAgent', 'agentSessions/launchAgentRequested');

/** Saga-owned edit/regenerate side effect trigger. */
export const agentSessionEditAndRegenerateRequested = createAsyncAction<
  [
    agentId: string,
    wsId: string,
    messageId: string,
    newText: string,
    options?: AgentSessionSendMessageOptions,
  ],
  void
>('agentSessions/editAndRegenerate', 'agentSessions/editAndRegenerateRequested');

/** Saga-owned regenerate-from-message side effect trigger. */
export const agentSessionRegenerateFromMessageRequested = createAsyncAction<
  [
    agentId: string,
    wsId: string,
    assistantMessageId: string,
    options?: AgentSessionSendMessageOptions,
  ],
  void
>('agentSessions/regenerateFromMessage', 'agentSessions/regenerateFromMessageRequested');

/** Saga-owned retry-last-message side effect trigger. */
export const agentSessionRetryLastMessageRequested = createAsyncAction<
  [agentId: string, wsId: string],
  void
>('agentSessions/retryLastMessage', 'agentSessions/retryLastMessageRequested');

/** Saga-owned retry-with-model side effect trigger. */
export const agentSessionRetryWithModelRequested = createAsyncAction<
  [agentId: string, wsId: string, model: string],
  void
>('agentSessions/retryWithModel', 'agentSessions/retryWithModelRequested');

/**
 * Saga-owned retry-from-stalled side effect trigger (monorepo#3402): cancels
 * the hung turn, waits for the stop to settle, then re-sends the identical
 * last user input. A no-op when the stall is no longer active by the time
 * the command runs (resumed event, stream delta, or turn end).
 */
export const agentSessionRetryFromStalledRequested = createAsyncAction<
  [agentId: string, wsId: string],
  void
>('agentSessions/retryFromStalled', 'agentSessions/retryFromStalledRequested');

/**
 * Saga-owned fork-session side effect trigger. Resolves with the forked agent id.
 * @public not dispatched yet — reserved for the fork feature (intent-hq/intent#3729)
 */
export const agentSessionForkSessionRequested = createAsyncAction<
  [agentId: string, wsId: string, options?: AgentSessionForkOptions],
  string
>('agentSessions/forkSession', 'agentSessions/forkSessionRequested');

/** Update an agent's digest field. Kept on the legacy action type for dispatch compatibility. */
export const updateAgentDigest = createAction<
  [wsId: string, agentId: string, digest: string | null]
>('workspaceAgents/updateAgentDigest');

/**
 * Set process queue hint (agent:process:queued event).
 * Payload: [agentId, used, cap, reason] — `reason` names the admission
 * constraint the spawn queued under ('slots' | 'memory-budget').
 */
export const setProcessQueueHint = createAction<
  [agentId: string, used: number, cap: number, reason: 'slots' | 'memory-budget']
>('agentSessions/setProcessQueueHint');

/**
 * Clear process queue hint (agent:process:resumed or normal state transition).
 * Payload: [agentId]
 */
export const clearProcessQueueHint = createAction<[agentId: string]>(
  'agentSessions/clearProcessQueueHint',
);

/**
 * Agent process evicted (agent:process:evicted, §6.5). The daemon parked the
 * agent's OS process — dropped from the spawn queue, or reaped by the idle
 * TTL sweep (reason "idle-ttl", intent-hq/intentd#1356). The session row
 * survives and the next send transparently respawns the process, so this is
 * NOT an "agent ended" transition. The daemon only evicts idle processes,
 * so any FE busy indicator at that moment is provably stale (monorepo#3040):
 * clear the queue hint and the optimistic busy flags, and demote a stale
 * RUNNING status to 'idle' (waiting/error/terminal statuses stay untouched).
 * Payload: [agentId]
 */
export const processEvicted = createAction<[agentId: string]>('agentSessions/processEvicted');

/** Rename agent session */
export const renameSession = createAction<[agentId: string, name: string]>(
  'agentSessions/renameSession',
);

/** Rename an agent session. Kept on the legacy action type for dispatch compatibility. */
export const renameAgent = createAction<[wsId: string, agentId: string, name: string]>(
  'workspaceAgents/renameAgent',
);

export type BulkUpsertSessionsOptions = {
  /**
   * Defaults to true for existing disk/snapshot load paths. The batching saga
   * sets this false so queued upsertSession actions preserve prior single-upsert
   * semantics where explicit false clears runtime flags.
   */
  preserveExplicitRuntimeFlags?: boolean;
  /**
   * Restore/load paths may first normalize a snapshot to prove there is no live
   * streaming message/handler. In that narrow case, explicit false flags are
   * authoritative even when the existing session has the historical both-true
   * in-flight pair.
   */
  allowActiveTurnRuntimeFlagClear?: boolean;
  /**
   * Mixed list snapshots may contain both crash-leftover idle rows and live
   * rows. IDs listed here receive the authoritative stale-clear semantics
   * (`preserveExplicitRuntimeFlags: false` plus active-turn clear) without
   * splitting one hydration into multiple reducer commits.
   */
  staleRuntimeFlagClearAgentIds?: string[];
};

/** Bulk upsert sessions (initial load / snapshot reconciliation / batched upsert storage) */
export const bulkUpsertSessions = createAction<
  [sessions: AgentSession[], options?: BulkUpsertSessionsOptions]
>('agentSessions/bulkUpsertSessions');

/** Remove all sessions for a workspace */
export const removeWorkspaceSessions = createAction<[wsId: string]>(
  'agentSessions/removeWorkspaceSessions',
);

/** Clear all sessions */
export const clearAllSessions = createAction('agentSessions/clearAllSessions');

/**
 * Prepend OLDER rows to the scrollback history segment (normalize/dedup/sort).
 * Past `HISTORY_SEGMENT_MAX`, prunes from the NEWEST side of history and sets
 * `gapToTail: true` — the pruned rows severed contiguity with the tail.
 */
export const prependHistoryMessages = createAction<[agentId: string, messages: AgentMessage[]]>(
  'agentSessions/prependHistoryMessages',
);

/**
 * Append NEWER rows to the scrollback history segment (hole refill;
 * normalize/dedup/sort). Past `HISTORY_SEGMENT_MAX`, prunes from the OLDEST
 * side. When appended rows overlap rows present in the tail, the overlap is
 * dropped from history and `gapToTail` flips false (hole closed).
 */
export const appendHistoryMessages = createAction<[agentId: string, messages: AgentMessage[]]>(
  'agentSessions/appendHistoryMessages',
);

/** Mark that the conversation's true first message has been hydrated into history. */
export const setHistoryOldestReached = createAction<[agentId: string, oldestReached?: boolean]>(
  'agentSessions/setHistoryOldestReached',
);

/**
 * REPLACE the scrollback history segment with a seek landing page
 * (`aroundIndex` far-flick seek): the old segment is discarded wholesale and
 * the landing rows seed a fresh one. `startOrdinalEstimate` is the estimated
 * conversation ordinal of the landing page's first row — it anchors the
 * above/below split of the virtual scroll extent. `gapToTail` opens unless
 * the landing rows overlap rows the tail already holds (landed at/near the
 * newest end ⇒ contiguous, mirroring the append overlap rule).
 */
export const seedHistoryAround = createAction<
  [agentId: string, messages: AgentMessage[], startOrdinalEstimate: number]
>('agentSessions/seedHistoryAround');

/** Drop an agent's scrollback history segment entirely. */
export const clearHistorySegment = createAction<[agentId: string]>(
  'agentSessions/clearHistorySegment',
);

// ============================================================================
// Reducer
// ============================================================================

export const agentSessionReducer = createReducer<AgentSessionState>(initialState);
agentSessionReducer.with(removeSession, (state, { payload: [agentId] }) => {
  if (!state.byAgentId[agentId]) return state;

  const { [agentId]: _, ...rest } = state.byAgentId;
  let next: AgentSessionState = { ...state, byAgentId: rest };
  next = removeFromWorkspaceIndex(next, agentId);
  next = removeHistorySegment(next, agentId);
  return next;
});
agentSessionReducer.with(addMessage, (state, { payload: [agentId, message] }) =>
  addMessageToSession(state, agentId, message),
);
agentSessionReducer.with(updateMessage, (state, { payload: [agentId, messageId, updates] }) => {
  const session = getSession(state, agentId);
  if (!session) return state;
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index === -1) return state;
  const nextMessage = { ...session.messages[index], ...updates, id: messageId };
  if (shallowEqual(nextMessage, session.messages[index])) return state;
  const nextMessages = session.messages.slice();
  nextMessages[index] = nextMessage;
  return setSession(state, agentId, { ...session, messages: nextMessages });
});
agentSessionReducer.with(replaceMessages, (state, { payload: [agentId, messages] }) => {
  const session = getSession(state, agentId);
  if (!session) return state;
  const ordered = normalizeSortHistoryMessages(messages);
  const pruned = pruneMessages(ordered);
  const nextMessages = reconcileMessageIdentities(session.messages, pruned);
  if (nextMessages === session.messages) return state;
  // Cap prune dropped rows that were tail-resident: live growth past the cap
  // (not a prepend-shaped replacement re-slicing rows never in the tail) —
  // latch it and account the dropped rows into the history-segment gap.
  const droppedResident = countDroppedResidentTailRows(session.messages, ordered, pruned);
  let next = setSession(state, agentId, {
    ...session,
    messages: nextMessages,
    ...(droppedResident > 0 ? { tailCapPruned: true } : {}),
  });
  if (droppedResident > 0) next = accountTailCapPrune(next, agentId, droppedResident);
  return next;
});
agentSessionReducer.with(removeMessage, (state, { payload: [agentId, messageId] }) => {
  const session = getSession(state, agentId);
  if (!session) return state;
  const nextMessages = session.messages.filter((message) => message.id !== messageId);
  if (nextMessages.length === session.messages.length) return state;
  return setSession(state, agentId, { ...session, messages: nextMessages });
});
agentSessionReducer.with(replaceMessageById, (state, { payload: [agentId, oldId, newMessage] }) =>
  replaceSessionMessageById(state, agentId, oldId, newMessage),
);
agentSessionReducer.with(updateSession, (state, { payload: [agentId, updates] }) => {
  const session = getSession(state, agentId);
  if (!session) return state;
  const { messages, ...otherUpdates } = updates;
  let merged: StoredAgentSession = { ...session, ...otherUpdates };
  let droppedResident = 0;
  if (messages && Array.isArray(messages)) {
    const ordered = normalizeSortHistoryMessages(messages);
    const pruned = pruneMessages(ordered);
    droppedResident = countDroppedResidentTailRows(session.messages, ordered, pruned);
    merged = {
      ...merged,
      messages: pruned,
      ...(droppedResident > 0 ? { tailCapPruned: true } : {}),
    };
  }
  let next = setSession(state, agentId, merged);
  if (droppedResident > 0) next = accountTailCapPrune(next, agentId, droppedResident);
  return next;
});
agentSessionReducer.with(eventReceived, (state, { payload: [, event] }) => {
  const userMessage = userMessageFromWorkspaceEvent(event);
  if (userMessage) {
    return addMessageToSession(state, userMessage[0], userMessage[1]);
  }

  const statsUpdate = statsFromWorkspaceEvent(event);
  if (statsUpdate) {
    const [agentId, stats] = statsUpdate;
    const existing = getSession(state, agentId);
    if (!existing) return state;
    if (existing.stats && shallowEqual(existing.stats, stats)) return state;
    return updateSessionFields(state, agentId, { stats });
  }

  const canonical = canonicalFieldsFromWorkspaceEvent(event);
  if (!canonical) return state;
  const [agentId, fields] = canonical;
  const updates = canonicalSessionUpdates(
    fields,
    typeof event.timestamp === 'string' ? event.timestamp : undefined,
  );
  if (Object.keys(updates).length === 0) return state;
  // Fresh running edge (the sticky liveTurnOpen slot transitions closed →
  // open): clear the previous turn's `lastToolUse` so it cannot render as a
  // live tool chip during the startup window before the first
  // `agent:stream:activity` ping of the new turn arrives. Keyed on the slot
  // EDGE, not on every running status event — mid-turn status ticks (slot
  // already open) must not wipe the current turn's live tool. The first
  // tool-arm ping of the new turn repopulates the field.
  const existing = getSession(state, agentId);
  const opensLiveTurn = updates.liveTurnOpen === true && existing?.liveTurnOpen !== true;
  const merged: Partial<Omit<StoredAgentSession, 'messages'>> = {
    ...(updates as Partial<Omit<StoredAgentSession, 'messages'>>),
    ...(opensLiveTurn && existing?.lastToolUse ? { lastToolUse: undefined } : {}),
  };
  return updateSessionFields(state, agentId, merged);
});
agentSessionReducer.with(renameSession, (state, { payload: [agentId, name] }) => {
  const session = getSession(state, agentId);
  if (!session || session.name === name) return state;
  return setSession(state, agentId, { ...session, name });
});
agentSessionReducer.with(bulkUpsertSessions, (state, { payload: [sessions, options] }) => {
  let next = state;
  const defaultStorageOptions: SessionUpsertStorageOptions = {
    preserveExplicitRuntimeFlags: options?.preserveExplicitRuntimeFlags ?? true,
    allowActiveTurnRuntimeFlagClear: options?.allowActiveTurnRuntimeFlagClear ?? false,
  };
  const staleClearIds = new Set(options?.staleRuntimeFlagClearAgentIds ?? []);
  for (const session of sessions) {
    const storageOptions = staleClearIds.has(String(session.id))
      ? {
          preserveExplicitRuntimeFlags: false,
          allowActiveTurnRuntimeFlagClear: true,
        }
      : defaultStorageOptions;
    next = applySessionUpsert(next, session, storageOptions);
  }
  return next;
});
agentSessionReducer.with(removeWorkspaceSessions, (state, { payload: [wsId] }) => {
  const agentIds = state.agentIdsByWorkspace[wsId] ?? [];
  if (agentIds.length === 0 && !state.agentIdsByWorkspace[wsId]) return state;
  const byAgentId = { ...state.byAgentId };
  for (const id of agentIds) {
    delete byAgentId[id];
  }

  const { [wsId]: _, ...restWorkspaces } = state.agentIdsByWorkspace;
  return removeHistorySegmentsFor(
    { ...state, byAgentId, agentIdsByWorkspace: restWorkspaces },
    agentIds,
  );
});
agentSessionReducer.with(workspaceDeleted, (state, { payload: [wsId, agentIds] }) => {
  const indexedAgentIds = state.agentIdsByWorkspace[wsId] ?? [];
  const doomed = new Set<string>([...indexedAgentIds, ...agentIds]);
  if (doomed.size === 0 && !state.agentIdsByWorkspace[wsId]) return state;
  const byAgentId = { ...state.byAgentId };
  let byAgentIdChanged = false;
  for (const id of doomed) {
    if (id in byAgentId) {
      delete byAgentId[id];
      byAgentIdChanged = true;
    }
  }
  if (!byAgentIdChanged && !(wsId in state.agentIdsByWorkspace)) return state;
  const { [wsId]: _, ...restWorkspaces } = state.agentIdsByWorkspace;
  return removeHistorySegmentsFor(
    { ...state, byAgentId, agentIdsByWorkspace: restWorkspaces },
    doomed,
  );
});
agentSessionReducer.with(clearAllSessions, () => initialState);
// -----------------------------------------------------------------------
// Cross-slice: handle workspace-agents actions directly (replaces bridge saga)
// -----------------------------------------------------------------------
agentSessionReducer.with(setAgentStreaming, (state, { payload: [agentId, isStreaming] }) => {
  const session = getSession(state, agentId);
  if (!session || session.isStreaming === isStreaming) return state;
  return updateSessionFields(state, agentId, { isStreaming });
});
agentSessionReducer.with(updateAgentDigest, (state, { payload: [, agentId, digest] }) => {
  const session = getSession(state, agentId);
  const nextDigest = digest ?? undefined;
  if (!session || session.digest === nextDigest) return state;
  return setSession(state, agentId, { ...session, digest: nextDigest });
});
agentSessionReducer.with(renameAgent, (state, { payload: [, agentId, name] }) => {
  const session = getSession(state, agentId);
  if (!session || session.name === name) return state;
  return setSession(state, agentId, { ...session, name });
});
// -----------------------------------------------------------------------
// Cross-slice: handle chat-state actions for isStreaming/isProcessing
// agent-session is the single source of truth for these flags.
// -----------------------------------------------------------------------
agentSessionReducer.with(chatSendStarted, (state, { payload: { agentId, wsId, timestampIso } }) => {
  const existing = getSession(state, agentId);
  if (existing) {
    return updateSessionFields(state, agentId, { isStreaming: true, isProcessing: true });
  }
  if (!wsId) return state;
  // Session not yet loaded (e.g. restored workspace where disk load is still in flight).
  // Create a minimal placeholder so the UI can show the processing indicator immediately.
  // The full session will be populated when upsertSession arrives.
  const placeholder: StoredAgentSession = {
    id: agentId as AgentSession['id'],
    backendSessionId: null,
    workspaceId: wsId as AgentSession['workspaceId'],
    name: '',
    status: 'idle' as any,
    messages: [],
    isStreaming: true,
    isProcessing: true,
    createdAt: timestampIso,
    updatedAt: timestampIso,
  };
  let next = setSession(state, agentId, placeholder);
  next = registerInWorkspaceIndex(next, agentId, wsId);
  return next;
});
agentSessionReducer.with(chatSendFailed, (state, { payload: [agentId] }) =>
  updateSessionFields(state, agentId, {
    isStreaming: false,
    isProcessing: false,
    isResponding: false,
  }),
);
agentSessionReducer.with(chatInterrupted, (state, { payload: [agentId] }) =>
  updateSessionFields(state, agentId, {
    isStreaming: false,
    isProcessing: false,
    isResponding: false,
  }),
);
agentSessionReducer.with(chatStopCompleted, (state, { payload: [agentId] }) =>
  updateSessionFields(state, agentId, {
    isStreaming: false,
    isProcessing: false,
    isResponding: false,
  }),
);
agentSessionReducer.with(chatReset, (state, { payload: [agentId] }) =>
  removeHistorySegment(
    updateSessionFields(state, agentId, {
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      // Full transcript reset — the cap-pruned latch no longer describes the
      // fresh transcript (only written when latched, keeping no-ops no-ops).
      ...(getSession(state, agentId)?.tailCapPruned === true ? { tailCapPruned: false } : {}),
    }),
    agentId,
  ),
);
agentSessionReducer.with(chatStreamingReconciled, (state, { payload: { agentId } }) =>
  updateSessionFields(state, agentId, { isStreaming: true, isProcessing: true }),
);
agentSessionReducer.with(chatInitialized, (state, { payload: [agentId, data] }) => {
  const session = getSession(state, agentId);
  if (!session) return state;
  // chatInitialized may only CLEAR streaming flags, never SET them.
  // Setting isStreaming=true is chatSendStarted's responsibility.
  // The saga captures a streaming-state snapshot that can be stale by
  // the time chatInitialized is dispatched — if agent:idle already
  // cleared the flags, re-introducing isStreaming=true causes the UI
  // to think the agent is still streaming and blocks follow-up messages.
  if (!data.isStreaming) {
    if (!session.isStreaming && !session.isProcessing) return state;
    return updateSessionFields(state, agentId, { isStreaming: false, isProcessing: false });
  }
  return state;
});
agentSessionReducer.with(streamCompleted, (state, { payload: [agentId] }) =>
  updateSessionFields(state, agentId, {
    isStreaming: false,
    isProcessing: false,
    isResponding: false,
  }),
);
agentSessionReducer.with(streamTimedOut, (state, { payload: [agentId] }) =>
  updateSessionFields(state, agentId, {
    isStreaming: false,
    isProcessing: false,
    isResponding: false,
  }),
);
agentSessionReducer.with(setProcessQueueHint, (state, { payload: [agentId, used, cap, reason] }) =>
  updateSessionFields(state, agentId, {
    processQueueHint: { waiting: true, used, cap, reason },
  }),
);
agentSessionReducer.with(clearProcessQueueHint, (state, { payload: [agentId] }) =>
  updateSessionFields(state, agentId, {
    processQueueHint: undefined,
  }),
);
// Process parked (queue drop or idle-TTL reap): the daemon only evicts idle
// processes, so besides the queue hint, clear any stale optimistic busy flags
// (and the sticky liveTurnOpen) that would otherwise render a phantom
// "Thinking" indicator until the next canonical event (monorepo#3040). A
// stale RUNNING status ('active'/'processing'/'responding', e.g. a missed
// agent:idle) would keep isAgentRunningState — and thus the Thinking
// indicator — true on its own, and §6.5 guarantees an evicted process is
// idle, so demote it to 'idle' (the same status the agent:idle branch
// defaults to). Non-running statuses (waiting/error/terminal) are BE-owned
// signals the eviction says nothing about and stay untouched.
agentSessionReducer.with(processEvicted, (state, { payload: [agentId] }) => {
  const existing = getSession(state, agentId);
  if (!existing) return state;
  const updates: Partial<Omit<StoredAgentSession, 'messages'>> = {
    processQueueHint: undefined,
    isStreaming: false,
    isProcessing: false,
    isResponding: false,
    liveTurnOpen: false,
    liveTurnOpenedAt: undefined,
  };
  if (RUNNING_STATUSES.has(existing.status as string)) {
    updates.status = AgentStatus.RuntimeIdle;
  }
  return updateSessionFields(state, agentId, updates);
});
// -----------------------------------------------------------------------
// Scrollback history segment (bounded, on-demand; tail semantics untouched)
// -----------------------------------------------------------------------
agentSessionReducer.with(prependHistoryMessages, (state, { payload: [agentId, messages] }) => {
  const session = getSession(state, agentId);
  if (!session) return state;
  const existing = getHistorySegment(state, agentId) ?? EMPTY_HISTORY_SEGMENT;
  const merged = dropRowsPresentInTail(
    normalizeSortHistoryMessages([...existing.messages, ...messages]),
    session.messages,
  );
  // Seek-seeded segments track the estimated ordinal of the first row: rows
  // landing BEFORE the previous first row shift the estimate down by their
  // count (floor 0). An estimate only — oldestReached pins it to exactly 0.
  const startOrdinalEstimate = shiftStartOrdinalForPrepend(existing, merged);
  if (merged.length <= HISTORY_SEGMENT_MAX) {
    return setHistorySegment(state, agentId, {
      ...existing,
      messages: merged,
      startOrdinalEstimate,
    });
  }
  // Past the cap: prune from the NEWEST side (viewport is walking up), which
  // severs contiguity with the tail — a hole opens. Serial-walk segments
  // (untracked start ordinal) count the pruned rows into the hole estimate so
  // the virtual extent attributes them BELOW the segment, not above.
  const prunedNewer = merged.length - HISTORY_SEGMENT_MAX;
  return setHistorySegment(state, agentId, {
    ...existing,
    messages: merged.slice(0, HISTORY_SEGMENT_MAX),
    gapToTail: true,
    startOrdinalEstimate,
    ...(startOrdinalEstimate === undefined
      ? { holeRowsEstimate: (existing.holeRowsEstimate ?? 0) + prunedNewer }
      : {}),
  });
});
agentSessionReducer.with(appendHistoryMessages, (state, { payload: [agentId, messages] }) => {
  const session = getSession(state, agentId);
  if (!session) return state;
  const existing = getHistorySegment(state, agentId) ?? EMPTY_HISTORY_SEGMENT;
  const incoming = normalizeSortHistoryMessages(messages);
  const incomingWithoutTailRows = dropRowsPresentInTail(incoming, session.messages);
  // Appended rows overlapping rows the tail already holds mean the refill
  // reached the tail — the hole is closed (overlap itself stays in the tail).
  const overlapsTail = incomingWithoutTailRows.length !== incoming.length;
  const merged = dropRowsPresentInTail(
    normalizeSortHistoryMessages([...existing.messages, ...incomingWithoutTailRows]),
    session.messages,
  );
  const gapToTail = overlapsTail ? false : existing.gapToTail;
  // Refilled rows moved OUT of the hole into history: shrink the serial-walk
  // hole estimate by the actual row gain (floor 0); a closed hole drops it.
  const holeRowsEstimate =
    !gapToTail || existing.holeRowsEstimate === undefined
      ? undefined
      : Math.max(0, existing.holeRowsEstimate - (merged.length - existing.messages.length));
  if (merged.length <= HISTORY_SEGMENT_MAX) {
    const { holeRowsEstimate: _dropped, ...rest } = existing;
    return setHistorySegment(state, agentId, {
      ...rest,
      messages: merged,
      gapToTail,
      ...(holeRowsEstimate !== undefined ? { holeRowsEstimate } : {}),
    });
  }
  // Past the cap: prune from the OLDEST side (viewport is walking down). The
  // true first message may be evicted, so oldestReached no longer holds; a
  // tracked start ordinal shifts up by the pruned row count.
  const prunedOlder = merged.length - HISTORY_SEGMENT_MAX;
  return setHistorySegment(state, agentId, {
    messages: merged.slice(prunedOlder),
    gapToTail,
    oldestReached: false,
    ...(existing.startOrdinalEstimate !== undefined
      ? { startOrdinalEstimate: existing.startOrdinalEstimate + prunedOlder }
      : {}),
    ...(holeRowsEstimate !== undefined ? { holeRowsEstimate } : {}),
  });
});
agentSessionReducer.with(
  setHistoryOldestReached,
  (state, { payload: [agentId, oldestReached] }) => {
    const existing = getHistorySegment(state, agentId) ?? EMPTY_HISTORY_SEGMENT;
    const next = oldestReached ?? true;
    if (existing.oldestReached === next && getHistorySegment(state, agentId)) return state;
    // The true first row is resident — the estimate becomes exact.
    const startOrdinalEstimate =
      next && existing.startOrdinalEstimate !== undefined ? 0 : existing.startOrdinalEstimate;
    return setHistorySegment(state, agentId, {
      ...existing,
      oldestReached: next,
      startOrdinalEstimate,
    });
  },
);
agentSessionReducer.with(
  seedHistoryAround,
  (state, { payload: [agentId, messages, startOrdinalEstimate] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const incoming = normalizeSortHistoryMessages(messages);
    const seeded = dropRowsPresentInTail(incoming, session.messages).slice(0, HISTORY_SEGMENT_MAX);
    // Landing rows overlapping the tail mean the seek landed at/near the
    // newest end — the segment is contiguous with the tail (no hole), same
    // overlap rule as the gap-refill append.
    const overlapsTail = seeded.length !== incoming.length;
    if (seeded.length === 0) {
      // Every landing row is already tail-resident: nothing older to show.
      return removeHistorySegment(state, agentId);
    }
    return setHistorySegment(state, agentId, {
      messages: seeded,
      gapToTail: !overlapsTail,
      // An estimated 0 start is still an estimate — exact only via the
      // walk's nextToken === null (setHistoryOldestReached).
      oldestReached: false,
      startOrdinalEstimate: Math.max(0, Math.round(startOrdinalEstimate)),
    });
  },
);
agentSessionReducer.with(clearHistorySegment, (state, { payload: [agentId] }) =>
  removeHistorySegment(state, agentId),
);
// Cross-slice: a §7.1 `resumed: false` seq-0 snapshot discards the retained
// transcript, so the history segment — unanchored against the fresh
// transcript — is dropped in the SAME dispatch the chat-state reducer resets
// the walk cursors and fetching flags in (atomic walk reset; the scrollback
// saga's clearHistorySegment chain still runs and is idempotent here).
agentSessionReducer.with(chatTranscriptSnapshotApplied, (state, { payload: [agentId, meta] }) => {
  if (meta.resumed !== false) return state;
  // Fresh (non-resumed) transcript: clear the FE-owned cap-pruned latch with
  // the segment — both described the discarded transcript. Only touch the
  // session when actually latched so an unlatched apply stays a state no-op.
  const next =
    getSession(state, agentId)?.tailCapPruned === true
      ? updateSessionFields(state, agentId, { tailCapPruned: false })
      : state;
  return removeHistorySegment(next, agentId);
});

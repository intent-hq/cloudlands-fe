import { shallowEqual } from 'fast-equals';
import type { AgentSession, AgentMessage, SessionStats } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
import type { CanonicalAgentStatusFields, WorkspaceEvent } from '$features/events/types';
import {
  createAction,
  createAsyncAction,
} from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type {
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
  streamEnded,
  streamFailed,
} from '../chat-state/chat-state-slice';

export {
  computeMessageContentHash,
  hasCanonicalId,
  isTimestampClose,
} from '$shared/utils/message-dedup';

// ============================================================================
// Constants
// ============================================================================

const MAX_MESSAGES_PER_AGENT = 500;
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
 * Stable sort by timestamp ascending, then repair the close event-ordering case
 * where a subsequent assistant reply sorts immediately above its user reply.
 */
function orderMessagesForConversation(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 1) return messages;
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
  const nextMessages = pruneMessages(orderMessagesForConversation(insertedMessages));
  return setSession(state, agentId, {
    ...session,
    messages: nextMessages,
  });
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
  liveTurnOpen?: boolean;
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

/**
 * Wire statuses that mean the turn/session ended (lowercase IPC + PascalCase
 * enum) — no runtime .toLowerCase() transformation.
 */
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
  // Same key-exists guard for the companion timestamp.
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
  // Completion-watch waiting state: `agent:idle` freezes
  // `isWaitingForOtherAgents` into its payload at emit time (§6.5), and
  // `agent:subscriptions-changed` carries the refreshed snapshot with the
  // awaited `waitingForAgentIds` set — fold both verbatim so a waiting
  // coordinator (and the agents it awaits) stays visible on HUD cards
  // between turns without a refetch.
  if (typeof fields.isWaitingForOtherAgents === 'boolean') {
    updates.isWaitingForOtherAgents = fields.isWaitingForOtherAgents;
  }
  if (Array.isArray(fields.waitingForAgentIds)) {
    updates.waitingForAgentIds = fields.waitingForAgentIds.filter(
      (id): id is string => typeof id === 'string',
    );
  }

  // A live running transition ends the parked completion-watch state. The
  // daemon's turn-start `agent:status-changed` carries ONLY
  // `{ agentId, status: "active", isActive: true }` (§6.5/§6.7
  // `persist_status`) — no liveness flags and no waiting fields — so without
  // this a coordinator whose previous turn ended waiting on children
  // (`agent:idle` froze `isWaitingForOtherAgents: true`) would keep bucketing
  // idle on HUD cards for its ENTIRE next turn while the feed shows AGENT
  // RUNNING off the same event. In event order running-after-waiting means
  // the wait ended (the wake started a turn); the turn-end `agent:idle` /
  // `agent:subscriptions-changed` re-freeze the flag when watches still
  // pend. Guarded on the waiting keys being ABSENT from the payload so
  // snapshots that carry both stay verbatim, and on `isActive: true` so the
  // between-turns status overshoot (parked coordinators are isActive: false)
  // never clears a genuine wait.
  const isRunningTransition =
    fields.isActive === true &&
    typeof fields.status === 'string' &&
    RUNNING_STATUSES.has(fields.status);
  if (isRunningTransition && typeof fields.isWaitingForOtherAgents !== 'boolean') {
    updates.isWaitingForOtherAgents = false;
    if (!Array.isArray(fields.waitingForAgentIds)) updates.waitingForAgentIds = [];
  }
  // Sticky FE turn-liveness: the daemon emits this turn-start event BEFORE
  // opening the STAB-125 live-turn slot (agent_manager: try_begin →
  // persist_status(Active) → run_prompt_turn → begin_live_turn), so the
  // STAB-9 refetch fired off this very event can resolve with
  // `turnInFlight: false` mid-turn and re-park a watch-holding coordinator
  // grey. Open the FE-owned slot here; only an explicit close signal (a
  // terminal status / isActive: false, below or via hydration) clears it.
  if (isRunningTransition) updates.liveTurnOpen = true;

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
    // Refreshed completion-watch snapshot for the parent (§6.5):
    // `{ agentId, isWaitingForOtherAgents, waitingForAgentIds }`. Passed
    // through verbatim — `canonicalSessionUpdates` folds only the waiting
    // fields (no status/activity keys on this payload), so hint-only
    // variants without the snapshot no-op.
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
  lastMessageId: AgentMessage['id'] | undefined;
  lastMessageBlockCount: number;
  attentionRequestKind: string | undefined;
  attentionRequestReason: string | undefined;
  attentionRequestTimestamp: string | undefined;
  completionReport: string | undefined;
  taskNoteId: string | undefined;
  dismissedQuestionsMessageId: string | undefined;
  lastSeenMessageId: string | undefined;
  sandboxId: string | undefined;
  sandboxPath: string | undefined;
  sandboxBranch: string | undefined;
  waitingForAgentIdsKey: string | undefined;
  turnInFlight: boolean | undefined;
  liveTurnOpen: boolean | undefined;
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
    // Freshness-wins preview fields (AgentLite, PROTOCOL §5.5) — an upsert
    // whose only change is these render-relevant fields must not be
    // swallowed as a no-op.
    lastMessageRole: session.lastMessageRole,
    lastUserMessage: session.lastUserMessage,
    lastAgentResponse: session.lastAgentResponse,
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
    // Derived via the shared helper so metadata-carried AgentLite attention
    // fields register as changes too, not just the top-level projection.
    attentionRequestKind: attentionRequest?.kind,
    attentionRequestReason: attentionRequest?.reason,
    attentionRequestTimestamp: attentionRequest?.timestamp,
    // Mutable render-relevant metadata scalars (monorepo#1231) — an upsert
    // whose only change is one of these must not be swallowed as a no-op:
    // completionReport feeds AgentCard's effectiveCompletionReport preview,
    // dismissedQuestionsMessageId gates the questions wizard, taskNoteId can
    // change on post-creation task assignment.
    completionReport:
      typeof metadata?.completionReport === 'string' ? metadata.completionReport : undefined,
    taskNoteId: typeof metadata?.taskNoteId === 'string' ? metadata.taskNoteId : undefined,
    dismissedQuestionsMessageId:
      typeof metadata?.dismissedQuestionsMessageId === 'string'
        ? metadata.dismissedQuestionsMessageId
        : undefined,
    // Seen marker (PROTOCOL §5.5 agent.markSeen) — anchors the "New messages"
    // divider; a cross-client agent:updated convergence whose only change is
    // this marker must not be swallowed as a no-op.
    lastSeenMessageId:
      typeof metadata?.lastSeenMessageId === 'string' ? metadata.lastSeenMessageId : undefined,
    // Sandbox fields settle onto the session AFTER creation (async CoW
    // provisioning, settle_provisioned_sandbox) and gate the reveal-sandbox
    // affordance — the settling re-hydration must not be swallowed either.
    sandboxId: typeof metadata?.sandboxId === 'string' ? metadata.sandboxId : undefined,
    sandboxPath: typeof metadata?.sandboxPath === 'string' ? metadata.sandboxPath : undefined,
    sandboxBranch:
      typeof metadata?.sandboxBranch === 'string' ? metadata.sandboxBranch : undefined,
    // Awaited-children set (§5.5 `waitingForAgentIds`) — the HUD card keeps
    // the awaited agents' rows visible, so a re-hydration whose only change
    // is this list must not be swallowed as a no-op. Joined to a scalar for
    // the shallow comparison.
    waitingForAgentIdsKey: Array.isArray(session.waitingForAgentIds)
      ? session.waitingForAgentIds.join(',')
      : undefined,
    // STAB-125 turn-liveness (§5.5, additive — not declared on AgentSession):
    // the HUD bucket gate reads it to defeat the waiting check mid-turn, so a
    // re-hydration whose only change is this flag flipping must not be
    // swallowed as a no-op (the STAB-9 refetch on agent:status-changed is the
    // only path that updates it for HUD summary-only sessions).
    turnInFlight:
      (session as { turnInFlight?: unknown }).turnInFlight === true ? true : undefined,
    // FE-owned sticky turn slot — an upsert whose only change is this flag
    // (e.g. the hydration close on isActive: false) must not be swallowed.
    liveTurnOpen: session.liveTurnOpen === true ? true : undefined,
    messageCount: messages.length,
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
 * Compares key scalar fields and message count / last message ID / last
 * message content-block count to avoid creating new state references when
 * nothing changed.
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

  if (existing) {
    // When a turn is actively in flight (both runtime flags set, e.g. right
    // after chatSendStarted started a queued turn), a session snapshot's
    // explicit `false` is stale for these ephemeral flags and must not clobber
    // the live turn — only explicit clear actions (streamEnded,
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

    // Guard: if agent:idle/streamEnded already cleared the streaming
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
    // Same guard for the companion timestamp.
    if (
      existing.stopReasonTimestamp !== undefined &&
      !Object.prototype.hasOwnProperty.call(session, 'stopReasonTimestamp')
    ) {
      finalSession.stopReasonTimestamp = existing.stopReasonTimestamp;
    }

    // Same guard for the last-response summary: a live `agent:status-changed`
    // (`lastResponseSummary`) can be fresher than a snapshot that omits the
    // field — only an incoming session that carries the key may replace it.
    if (
      existing.lastAgentResponse !== undefined &&
      !Object.prototype.hasOwnProperty.call(session, 'lastAgentResponse')
    ) {
      finalSession.lastAgentResponse = existing.lastAgentResponse;
    }

    // Same guard for the live tool preview (§7 `lastToolUse`, push-applied
    // from `agent:stream:activity`): no hydration payload carries it, so an
    // upsert that applies for any other reason would otherwise erase the
    // pushed value mid-turn and flicker the row back to stale text.
    if (
      existing.lastToolUse !== undefined &&
      !Object.prototype.hasOwnProperty.call(session, 'lastToolUse')
    ) {
      finalSession.lastToolUse = existing.lastToolUse;
    }

    // Sticky FE turn slot (liveTurnOpen): hydration snapshots never carry
    // this FE-owned flag, and the daemon opens the STAB-125 live-turn slot
    // only AFTER emitting the turn-start event (try_begin →
    // persist_status(Active) → begin_live_turn) — so the STAB-9 refetch that
    // event triggers can land with `turnInFlight: false` mid-turn. Keep the
    // slot open across such snapshots; only an authoritative close —
    // `isActive: false` or a terminal status on the fresh session — ends it.
    if (existing.liveTurnOpen === true && finalSession.liveTurnOpen === undefined) {
      const incomingClosed =
        session.isActive === false ||
        (typeof session.status === 'string' && TERMINAL_STATUSES.has(session.status));
      if (!incomingClosed) finalSession.liveTurnOpen = true;
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

/** Upsert a session — normalize dates, order/prune messages to 500, register in workspace index */
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

/** Non-message field updates */
export const updateSession = createAction<[agentId: string, updates: Partial<AgentSession>]>(
  'agentSessions/updateSession',
);

/** Saga-owned core send side effect trigger. */
export const agentSessionSendMessageRequested = createAsyncAction<
  [agentId: string, wsId: string, text: string, options?: AgentSessionSendMessageOptions],
  void
>('agentSessions/sendMessage', 'agentSessions/sendMessageRequested');

/** Saga-owned core stop side effect trigger. */
export const agentSessionStopChatRequested = createAsyncAction<[agentId: string], void>(
  'agentSessions/stopChat',
  'agentSessions/stopChatRequested',
);

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

/** Saga-owned fork-session side effect trigger. Resolves with the forked agent id. */
export const agentSessionForkSessionRequested = createAsyncAction<
  [agentId: string, wsId: string, options?: AgentSessionForkOptions],
  string
>('agentSessions/forkSession', 'agentSessions/forkSessionRequested');

/**
 * Dismiss the pending Agent Q&A question set (`agent.dismissQuestions`,
 * PROTOCOL §5.5). `messageId` is the question-bearing assistant message id.
 * The mutation middleware applies the dismissal marker to session metadata
 * optimistically BEFORE the wire call and rolls it back on failure; the
 * daemon persists `dismissedQuestionsMessageId` (survives reload) and emits
 * `agent:updated` to reconcile other windows.
 */
export const agentSessionDismissQuestionsRequested = createAsyncAction<
  [agentId: string, wsId: string, messageId: string],
  void
>('agentSessions/dismissQuestions', 'agentSessions/dismissQuestionsRequested');

/** Update an agent's digest field. Kept on the legacy action type for dispatch compatibility. */
export const updateAgentDigest = createAction<
  [wsId: string, agentId: string, digest: string | null]
>('workspaceAgents/updateAgentDigest');

/**
 * Set process queue hint (agent:process:queued event).
 * Payload: [agentId, used, cap]
 */
export const setProcessQueueHint = createAction<[agentId: string, used: number, cap: number]>(
  'agentSessions/setProcessQueueHint',
);

/**
 * Clear process queue hint (agent:process:resumed or normal state transition).
 * Payload: [agentId]
 */
export const clearProcessQueueHint = createAction<[agentId: string]>(
  'agentSessions/clearProcessQueueHint',
);

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

// ============================================================================
// Reducer
// ============================================================================

export const agentSessionReducer = createReducer<AgentSessionState>(initialState)
  .with(removeSession, (state, { payload: [agentId] }) => {
    if (!state.byAgentId[agentId]) return state;

    const { [agentId]: _, ...rest } = state.byAgentId;
    let next: AgentSessionState = { ...state, byAgentId: rest };
    next = removeFromWorkspaceIndex(next, agentId);
    return next;
  })
  .with(addMessage, (state, { payload: [agentId, message] }) =>
    addMessageToSession(state, agentId, message),
  )
  .with(updateMessage, (state, { payload: [agentId, messageId, updates] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const index = session.messages.findIndex((message) => message.id === messageId);
    if (index === -1) return state;
    const nextMessage = { ...session.messages[index], ...updates, id: messageId };
    if (shallowEqual(nextMessage, session.messages[index])) return state;
    const nextMessages = session.messages.slice();
    nextMessages[index] = nextMessage;
    return setSession(state, agentId, { ...session, messages: nextMessages });
  })
  .with(replaceMessages, (state, { payload: [agentId, messages] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    return setSession(state, agentId, {
      ...session,
      messages: normalizeSortPruneMessages(messages),
    });
  })
  .with(removeMessage, (state, { payload: [agentId, messageId] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const nextMessages = session.messages.filter((message) => message.id !== messageId);
    if (nextMessages.length === session.messages.length) return state;
    return setSession(state, agentId, { ...session, messages: nextMessages });
  })
  .with(replaceMessageById, (state, { payload: [agentId, oldId, newMessage] }) =>
    replaceSessionMessageById(state, agentId, oldId, newMessage),
  )
  .with(updateSession, (state, { payload: [agentId, updates] }) => {
    const session = getSession(state, agentId);
    if (!session) return state;
    const { messages, ...otherUpdates } = updates;
    let merged: StoredAgentSession = { ...session, ...otherUpdates };
    if (messages && Array.isArray(messages)) {
      merged = { ...merged, messages: normalizeSortPruneMessages(messages) };
    }
    return setSession(state, agentId, merged);
  })
  .with(eventReceived, (state, { payload: [, event] }) => {
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
    const updates = canonicalSessionUpdates(fields);
    if (Object.keys(updates).length === 0) return state;
    return updateSessionFields(
      state,
      agentId,
      updates as Partial<Omit<StoredAgentSession, 'messages'>>,
    );
  })
  .with(renameSession, (state, { payload: [agentId, name] }) => {
    const session = getSession(state, agentId);
    if (!session || session.name === name) return state;
    return setSession(state, agentId, { ...session, name });
  })
  .with(bulkUpsertSessions, (state, { payload: [sessions, options] }) => {
    let next = state;
    const storageOptions: SessionUpsertStorageOptions = {
      preserveExplicitRuntimeFlags: options?.preserveExplicitRuntimeFlags ?? true,
      allowActiveTurnRuntimeFlagClear: options?.allowActiveTurnRuntimeFlagClear ?? false,
    };
    for (const session of sessions) {
      next = applySessionUpsert(next, session, storageOptions);
    }
    return next;
  })
  .with(removeWorkspaceSessions, (state, { payload: [wsId] }) => {
    const agentIds = state.agentIdsByWorkspace[wsId] ?? [];
    if (agentIds.length === 0 && !state.agentIdsByWorkspace[wsId]) return state;
    const byAgentId = { ...state.byAgentId };
    for (const id of agentIds) {
      delete byAgentId[id];
    }

    const { [wsId]: _, ...restWorkspaces } = state.agentIdsByWorkspace;
    return { byAgentId, agentIdsByWorkspace: restWorkspaces };
  })
  .with(workspaceDeleted, (state, { payload: [wsId, agentIds] }) => {
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
    return { byAgentId, agentIdsByWorkspace: restWorkspaces };
  })
  .with(clearAllSessions, () => initialState)
  // -----------------------------------------------------------------------
  // Cross-slice: handle workspace-agents actions directly (replaces bridge saga)
  // -----------------------------------------------------------------------
  .with(setAgentStreaming, (state, { payload: [agentId, isStreaming] }) => {
    const session = getSession(state, agentId);
    if (!session || session.isStreaming === isStreaming) return state;
    return updateSessionFields(state, agentId, { isStreaming });
  })
  .with(updateAgentDigest, (state, { payload: [, agentId, digest] }) => {
    const session = getSession(state, agentId);
    // Normalize undefined vs null so clearing an already-absent digest is a
    // true no-op (the turn-boundary clear fires once per turn, digest or not).
    if (!session || (session.digest ?? null) === digest) return state;
    return setSession(state, agentId, { ...session, digest: digest ?? undefined });
  })
  .with(renameAgent, (state, { payload: [, agentId, name] }) => {
    const session = getSession(state, agentId);
    if (!session || session.name === name) return state;
    return setSession(state, agentId, { ...session, name });
  })
  // -----------------------------------------------------------------------
  // Cross-slice: handle chat-state actions for isStreaming/isProcessing
  // agent-session is the single source of truth for these flags.
  // -----------------------------------------------------------------------
  .with(chatSendStarted, (state, { payload: { agentId, wsId, timestampIso } }) => {
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
  })
  .with(chatSendFailed, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, {
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    }),
  )
  .with(chatInterrupted, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, {
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    }),
  )
  .with(chatStopCompleted, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, {
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    }),
  )
  .with(chatReset, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, {
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    }),
  )
  .with(chatStreamingReconciled, (state, { payload: { agentId } }) =>
    updateSessionFields(state, agentId, { isStreaming: true, isProcessing: true }),
  )
  .with(chatInitialized, (state, { payload: [agentId, data] }) => {
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
  })
  .with(streamEnded, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, {
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    }),
  )
  .with(streamFailed, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, {
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    }),
  )
  .with(setProcessQueueHint, (state, { payload: [agentId, used, cap] }) =>
    updateSessionFields(state, agentId, {
      processQueueHint: { waiting: true, used, cap },
    }),
  )
  .with(clearProcessQueueHint, (state, { payload: [agentId] }) =>
    updateSessionFields(state, agentId, {
      processQueueHint: undefined,
    }),
  );

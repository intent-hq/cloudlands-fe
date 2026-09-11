// ============================================================================
// Per-Agent Chat State
// ============================================================================

export interface StatusEvent {
  phase: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: number;
  /**
   * Additive on the daemon's `stalled` status event (monorepo#3402): the
   * silence already measured when the event was emitted, so the live
   * "No model activity for N" counter can anchor at `timestamp - silentMs`.
   */
  silentMs?: number;
}

export interface StreamStatusContext {
  sessionId: string;
}

export interface LastAttemptedMessage {
  text: string;
  options?: SendMessageOptions;
}

/**
 * A parked, turn-scoped retry payload for a daemon-queued send (#999).
 * `seq` is a per-agent monotonic park sequence (derived in the reducer as
 * max existing seq + 1) used ONLY for the MAX_QUEUED_RETRY_RECORDS eviction
 * order — `Record` key iteration order is NOT insertion order for
 * integer-like keys, so key order alone cannot encode park order.
 *
 * `turnId` (monorepo#1057) is the daemon's turn correlation id captured from
 * the enqueue RPC response (PROTOCOL §5.5/§6.6) and is the ONLY attribution
 * key: promotion (`agent:queue:processing` / the `agent.sendQueuedMessageNow`
 * response) and failure pairing (`agent:failed`) match on it. A fresh enqueue
 * has `turnId === entry id` (the record's key), but a terminal-failure
 * requeue mints a NEW entry id while preserving the failed turn's ORIGINAL
 * `turnId` — matching on it is what keeps attribution exact across
 * `agent.retry` redrives. Required: the pinned daemon (≥0.2.12) returns it on
 * every enqueue path, and a record without one could never promote.
 */
export interface QueuedRetryRecord {
  seq: number;
  record: LastAttemptedMessage;
  turnId: string;
}

export interface ModelUnavailableInfo {
  failedModel: string;
  nextAvailableModel: string;
}

interface SendMessageOptions {
  contextItems?: SerializableContextItem[];
  noteIds?: string[];
  personality?: string;
  resetHistory?: boolean;
  model?: string;
  agentId?: string;
  contextReferences?: ContextReference[];
  /**
   * Image blocks the original send carried, recorded so "Try again" resends
   * them with the message (#965). Inline arm carries plain base64 data;
   * reference arm carries the attachment-registry UUID (monorepo#3338) —
   * serializable/redux-safe either way.
   */
  imageBlocks?: Array<{ type: 'image'; data?: string; mimeType?: string; attachmentId?: string }>;
  /**
   * Attachment-reference file blocks the original send carried, recorded so
   * "Try again" resends them. UUID + metadata only — no bytes.
   */
  fileBlocks?: Array<{
    type: 'file';
    attachmentId: string;
    fileName: string;
    mimeType?: string;
    size?: number;
  }>;
  /**
   * Opaque per-message tag the original send carried (PROTOCOL §5.5), recorded
   * so "Try again" resends it: an untagged retry of a wizard answer would leave
   * the daemon's pending question set unanswered and re-surface the sticky wizard.
   */
  messageMetadata?: Record<string, unknown>;
}

/**
 * Serializable subset of the chat input ContextItem.
 * Excludes the `file` field (a non-serializable `File` object).
 */
type SerializableContextItem = Omit<ChatInputContextItem, 'file'>;

/**
 * Transcript hydration status: 'loading' while the newest window is unresolved,
 * 'settled' after a successful source paints, and 'error' when all bounded
 * first-window sources fail. Defaults to undefined (not yet started).
 */
export type TranscriptHydrationStatus = 'loading' | 'settled' | 'error';

/** One bounded lookup for an authoritative question marker outside the tail page. */
interface PendingQuestionRecovery {
  messageId: string;
  status: 'loading' | 'found' | 'not-found' | 'error';
  /** Wizard projection retained after one successful lookup; never transcript state. */
  questions?: Question[];
}

/**
 * One bounded lookup for a pending-proposal carrying message outside the
 * loaded window. Unlike the single-slot question recovery, proposals may span
 * multiple carrying messages, so these are kept in a per-messageId record.
 */
export interface PendingProposalRecovery {
  status: 'loading' | 'found' | 'not-found' | 'error';
  /** Tray projection retained after one successful lookup; never transcript state. */
  proposals?: { proposalId: string; proposal: Proposal }[];
}

/**
 * Metadata of the LAST seq-0 snapshot the standing `chat.subscribe`
 * subscription applied to the store (single-transfer hydration). Written by
 * the chat-subscribe saga on every `fromSnapshot` transcript emit; consumed
 * by the chat-read saga to settle hydration and anchor the background
 * older-history fetch without a second conversation transfer.
 */
export interface TranscriptSnapshotMeta {
  /** Daemon `truncated` flag: older history exists beyond the snapshot page. */
  truncated: boolean;
  /** Daemon `totalMessages` count at snapshot time. */
  totalMessages: number;
  /** Id of the oldest message in the snapshot page (undefined when empty). */
  oldestMessageId?: string;
  /** §7.1 resume disposition when the registration requested one. */
  resumed?: boolean;
  /** Monotonic per-agent counter so waiters can detect a NEW snapshot. */
  seq: number;
}

/**
 * Lifecycle phase of the agent's standing `chat.subscribe` stream, mirrored
 * from the live client's observational phase reports (see ChatLiveStreamPhase
 * in app-client.ts). Drives the pre-live hydration indicator in ChatPanel.
 * `null`/absent means no standing subscription is open for the agent.
 */
export type LiveStreamPhase = 'connecting' | 'awaiting-snapshot' | 'live' | 'resyncing' | 'delayed';

/**
 * One lazily hydrated content block (PROTOCOL §5.5 slim projection + v7.2
 * `agent.getMessageBlock`): the FULL body fetched on demand when the user
 * expands a truncated tool row or views a truncated image. Keyed in
 * `ChatAgentState.hydratedBlocks` by `{messageId}|{blockId}`. `seq` is a
 * per-agent monotonic counter used ONLY for cap eviction (Record key order
 * is not insertion order for integer-like keys).
 */
export type HydratedBlockEntry =
  | { status: 'loading'; seq: number }
  | { status: 'loaded'; seq: number; block: ContentBlock }
  | { status: 'error'; seq: number; error: string };

export interface StreamFailureCorrelation {
  turnCorrelation?: string;
  turnIdCorrelation?: string;
}

/**
 * Serializable per-agent chat state stored in Redux.
 * Serializable per-agent chat state without non-serializable fields
 * (those stay in the saga).
 */
export interface ChatAgentState {
  agentId: string;
  // NOTE: isStreaming and isProcessing have been moved to agent-session slice.
  // Read them from AgentSession via canonical agent-session selectors.
  isInterrupting: boolean;
  error: string | null;
  failureCorrelation?: StreamFailureCorrelation;
  lastChunkTime: number | null;
  receivedFirstChunk: boolean;
  streamingStartTime: number | null;
  lastAttemptedMessage: LastAttemptedMessage | null;
  /**
   * Turn-scoped retry records for daemon-queued sends (#999), keyed by the
   * QueuedMessage id returned from a successful enqueue. When the daemon
   * dequeues an entry to run it (`agent:queue:processing`, matched by
   * `turnId`), the record is PROMOTED into `lastAttemptedMessage` so a
   * failure in the drained turn retries that turn's own payload — not the
   * previous in-flight turn's. User-removed entries drop their record
   * instead of promoting.
   */
  queuedRetryRecords: Record<string, QueuedRetryRecord>;
  modelUnavailable: ModelUnavailableInfo | null;
  statusEvents: StatusEvent[];
  /** Workspace ID last recorded by the rebind tracker (mirrors WorkspaceRebindTracker). */
  trackedWorkspaceId: string | null;
  /** True while an async initializeChat triggered by a workspace rebind is in flight. */
  isRebinding: boolean;
  /** Timestamp of the last accepted message send (for saga-owned rate limiting) */
  lastMessageTime: number;
  /** Timestamp of the last chunk received (for reconciliation skip logic) */
  lastChunkReceivedAt: number;
  /**
   * Transcript hydration status for this agent. Undefined means hydration has not
   * started; 'loading' means the newest window is unresolved, 'settled' means a source
   * succeeded, and 'error' exposes a retry instead of a false new-chat welcome.
   */
  transcriptHydration?: TranscriptHydrationStatus;
  /**
   * True once transcript hydration has settled at least once for this agent.
   * Distinguishes the FIRST hydration (ChatPanel keeps the indeterminate
   * skeleton up even if partial messages have already landed, e.g. the
   * standing subscription's newest page arriving ahead of the paged history
   * read) from a refresh re-hydration (messages keep rendering). Never reset
   * except by chatReset.
   */
  transcriptHydratedOnce?: boolean;
  /**
   * Current standing `chat.subscribe` lifecycle phase for this agent, or
   * null when no subscription is open (teardown resets it). Written by
   * chat-subscribe saga from the live client's onPhase reports.
   */
  liveStreamPhase: LiveStreamPhase | null;
  /**
   * Metadata of the last applied seq-0 snapshot from the standing
   * subscription, or undefined when none has arrived yet. See
   * TranscriptSnapshotMeta.
   */
  transcriptSnapshot?: TranscriptSnapshotMeta;
  /** True while an on-demand older-history scrollback page fetch is in flight. */
  fetchingOlderHistory: boolean;
  /** True while an on-demand gap-refill scrollback page fetch is in flight. */
  fetchingGapFill: boolean;
  /**
   * Opaque §5.5 backward cursor continuing the older-history walk from where
   * the last fetched page stopped, or null when the next request must re-seek
   * (`aroundMessageId`) at the history segment's oldest row. Only honored
   * while the history segment it was minted against still has rows; dropped
   * when a gap-refill append lands (the append may have cap-pruned history's
   * oldest side, and continuing backward would skip the pruned rows).
   */
  scrollbackOlderToken: string | null;
  /**
   * Opaque §5.5 forward cursor continuing the gap-refill walk toward the live
   * tail, or null when the next request must re-seek at the history segment's
   * newest row. Dropped when an older prepend lands (the prepend may have
   * cap-pruned history's newest side, and continuing forward would skip the
   * pruned rows).
   */
  scrollbackGapToken: string | null;
  /** True while an `aroundIndex` far-flick seek fetch is in flight. */
  fetchingHistorySeek: boolean;
  /**
   * Monotonic §7.1 discard counter: bumped atomically by the
   * `resumed: false` snapshot reducer (the same write that resets the walk
   * cursors + fetching flags). Scrollback workers capture it before their
   * wire call and drop the result when it changed mid-flight — a page that
   * resolves after the discard was fetched against the discarded transcript
   * and must not recreate a segment or persist a cursor.
   */
  scrollbackDiscardEpoch: number;
  /**
   * True once the daemon rejected `aroundIndex` with INVALID_PARAMS —
   * a daemon predating the param. Seeks are disabled for this agent for the
   * rest of the session (the serial walk covers deep scrolls instead).
   */
  historySeekUnsupported: boolean;
  /** State of the single targeted `aroundMessageId` lookup for the current marker. */
  pendingQuestionRecovery?: PendingQuestionRecovery;
  /**
   * Targeted `aroundMessageId` lookups for pending-proposal carrying messages
   * outside the loaded window, keyed by carrying messageId. Entries are
   * pruned when the metadata refs no longer name the message.
   */
  pendingProposalRecovery?: Record<string, PendingProposalRecovery>;
  /**
   * Switch-back transcript reveal gate: true while the VIEWED conversation is
   * awaiting a fresh seq-0 snapshot from its (re)opening standing
   * subscription. Armed synchronously by the `markAgentAsViewed` reducer case
   * (only when the transcript hydrated at least once and no snapshot from the
   * current subscription exists) so no frame can paint the retained stale
   * transcript; cleared when a snapshot applies, when the subscription
   * closes (the retained transcript is then the right thing to show), or by
   * the subscribe saga's bounded fallback timeout.
   */
  awaitingSwitchBackSnapshot?: boolean;
  /**
   * Lazily hydrated full content blocks, keyed `{messageId}|{blockId}`
   * (§5.5 slim projection → v7.2 `agent.getMessageBlock`). Read-through
   * cache of daemon responses: `loading` de-dupes concurrent expand clicks
   * (single-flight per block), `loaded` renders instead of the slim preview,
   * `error` re-enables the fetch on the next expand. Bounded at
   * MAX_HYDRATED_BLOCKS (oldest-seq evicted first) since each entry can
   * carry an MB-scale body.
   */
  hydratedBlocks?: Record<string, HydratedBlockEntry>;
}

/**
 * Payload for the sendMessage saga-trigger action.
 * DOM-derived context may be raw; the saga owns serialization before IPC.
 */
export interface SendMessagePayload {
  text: string;
  /** Stable identity shared by the optimistic row and its composer transition. */
  userAppMessageId?: string;
  contextItems?: ChatInputContextItem[];
  serializedContextItems?: SerializableContextItem[];
  workspaceContextStr?: string;
  noteIds?: string[];
  /** Image blocks extracted from serialized context items (inline or reference arm) */
  imageBlocks?: Array<{ type: 'image'; data?: string; mimeType?: string; attachmentId?: string }>;
  /** Attachment-reference file blocks extracted from context items */
  fileBlocks?: Array<{
    type: 'file';
    attachmentId: string;
    fileName: string;
    mimeType?: string;
    size?: number;
  }>;
  /**
   * Queued entry id for the atomic "Send now" path
   * (`agent.sendQueuedMessageNow`): when present, the send middleware makes
   * that single wire call instead of the lifecycle send.
   */
  queuedMessageId?: string;
  /** Whether saga-owned stop orchestration should run before sending. */
  forceSubmit?: boolean;
  /** Agent name used for reinitializing chat on workspace change */
  agentName?: string;
  /** Agent model used for reinitializing chat on workspace change */
  agentModel?: string;
  /** Whether this is the initial workspace agent */
  isInitialWorkspaceAgent?: boolean;
  /**
   * Opaque per-message payload forwarded verbatim as `agent.sendMessage`'s
   * `messageMetadata` (PROTOCOL §5.5) — the Q&A wizard tags its flattened
   * answer message with `{ type: "question_answers", answeredQuestionsMessageId }`.
   */
  messageMetadata?: Record<string, unknown>;
}

/**
 * Options for the initializeChat saga-trigger action.
 * Optional parameters for the initializeChatRequested action.
 */
export interface InitializeChatOptions {
  agentName?: string;
  agentModel?: string;
  agentType?: string;
  isInitialWorkspaceAgent?: boolean;
}

import type { ContextItem as ChatInputContextItem } from '$lib/components/chat/input/context-api';
import type { ContextReference } from '$features/agent/agent-context';
import type { ContentBlock } from '$shared/types';
import type { Question } from '$shared/types/question-resource';
import type { Proposal } from '$shared/types/proposal';

// ============================================================================
// Top-level slice state (flat, agent-keyed)
// ============================================================================

export interface ChatStateSlice {
  byAgentId: Record<string, ChatAgentState>;
}

/**
 * Cap on parked `queuedRetryRecords` per agent (#973-family memory bound).
 * Records normally leave via processing-event promotion, user removal, or
 * reset — but a dropped events subscription or per-agent deletion can strand
 * them for the app session, and each can carry MB-scale base64 imageBlocks.
 * Parking beyond the cap evicts the oldest (lowest-seq) records first; 20
 * comfortably exceeds any realistic queue depth.
 */
export const MAX_QUEUED_RETRY_RECORDS = 20;

/**
 * Cap on cached `hydratedBlocks` per agent (memory bound): each entry can
 * carry an MB-scale full tool body or original image. Hydrating beyond the
 * cap evicts the oldest (lowest-seq) settled entries first; in-flight
 * `loading` entries are never evicted (the single-flight guard depends on
 * them). 30 comfortably exceeds the number of expanded rows a user works
 * with at once while bounding worst-case retention.
 */
export const MAX_HYDRATED_BLOCKS = 30;

/** Key for one hydrated block in `ChatAgentState.hydratedBlocks`. */
export function hydratedBlockKey(messageId: string, blockId: string): string {
  return `${messageId}|${blockId}`;
}

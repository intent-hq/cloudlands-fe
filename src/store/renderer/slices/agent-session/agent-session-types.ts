import type { AgentSession, AgentMessage } from '$shared/types';
import type { UnifiedAgentConfig } from '$shared/types/agent.types';

interface AgentSessionSendContextItem {
  id: string;
  type: string;
  label?: string;
  content?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  file?: File;
  imageData?: string;
  imageMimeType?: string;
}

interface AgentSessionContextReference {
  type: string;
  filePath?: string;
  noteId?: string;
  selectedText?: string;
  [key: string]: unknown;
}

export interface AgentSessionSendMessageOptions {
  contextItems?: AgentSessionSendContextItem[];
  noteIds?: string[];
  personality?: string;
  resetHistory?: boolean;
  model?: string;
  agentId?: string;
  contextReferences?: AgentSessionContextReference[];
  /** Image content blocks riding the message (PROTOCOL §5.5) — plain base64. */
  imageBlocks?: Array<{ type: 'image'; data?: string; mimeType?: string; attachmentId?: string }>;
  /**
   * Attachment-reference file blocks riding the message (PROTOCOL §5.5) —
   * registry UUID + metadata only, never bytes.
   */
  fileBlocks?: Array<{
    type: 'file';
    attachmentId: string;
    fileName: string;
    mimeType?: string;
    size?: number;
  }>;
  /**
   * Pre-generated logical app message ID for the user message. When the send
   * path stages an optimistic user message, the canonical user message reuses
   * this ID so the two merge via appMessageId dedup instead of duplicating.
   */
  userAppMessageId?: string;
  /** Local ID of the staged optimistic user message, used to mark it with an error on send failure. */
  optimisticMessageId?: string;
}

export interface AgentSessionForkOptions {
  forkFromMessageId?: string;
  switchToForked?: boolean;
  name?: string;
  model?: string;
  selectedText?: string;
}

export type AgentSessionLaunchConfig = Omit<UnifiedAgentConfig, 'workspaceId'> & {
  workspaceId?: UnifiedAgentConfig['workspaceId'];
};

export interface AgentSessionLaunchOptions {
  /** Optional UI correlation key for selector-backed creation result handling. */
  requestId?: string;
  openAgent?: boolean;
  openInAdjacentPanel?: boolean;
  panelId?: string;
  sourcePanelId?: string;
  assignTaskNoteId?: string;
  reloadNotes?: boolean;
  markInitialMessageSent?: boolean;
}

/**
 * FE-owned session fields: set by reducer actions / the event fold, never
 * carried by the `agent.get` / `agent.list` wire snapshot. Because
 * `applySessionUpsert` rebuilds the stored session from the incoming
 * snapshot, every field declared here MUST have a carry-forward entry in
 * `FE_OWNED_FIELD_POLICY` (agent-session-slice.ts) — the policy table is
 * typed exhaustively over these keys, so adding a field without a policy is
 * a compile error.
 */
export interface FeOwnedSessionState {
  /**
   * FE-owned sticky turn-liveness. Set by the event fold when a live running
   * transition lands (`agent:status-changed` with a running status and
   * `isActive: true`), cleared only by an explicit close signal (a
   * terminal/idle status or `isActive: false` — event or hydration snapshot).
   *
   * Exists because the daemon emits the turn-start event BEFORE opening the
   * STAB-125 live-turn slot (agent_manager: try_begin → persist_status(Active)
   * → run_prompt_turn → begin_live_turn), so the STAB-9 per-agent `agent.get`
   * refetch fired off that very event can resolve with `turnInFlight: false` mid-turn
   * — the HUD waiting gate must not trust that single racy snapshot field.
   */
  liveTurnOpen?: boolean;
  /**
   * Daemon timestamp of the live running edge that opened `liveTurnOpen`
   * (the `agent:status-changed` event's own `timestamp`, never
   * renderer-generated). Ordering signal for the monorepo#1815 stale-snapshot
   * guard: a hydrate snapshot's failure (`stopReasonTimestamp`) that predates
   * this edge is provably stale, while a failure recorded after it (e.g. a
   * terminal event missed across a disconnect) still applies.
   */
  liveTurnOpenedAt?: string;
  /**
   * FE-owned latch: true once the client-side `MAX_MESSAGES_PER_AGENT` cap
   * actually dropped rows from the live tail (live growth past the cap).
   * The chat-init transcript snapshot meta (`truncated`/`totalMessages`) is
   * captured once per init and goes stale as the conversation grows, so the
   * scrollback triggers OR this latch into their "older rows exist" inputs.
   * Wire sessions never carry it (preserved across upserts); cleared only by
   * a full transcript reset (chatReset / a §7.1 `resumed: false` snapshot).
   */
  tailCapPruned?: boolean;
  /**
   * Process queue hint (PROTOCOL §6.5 agent:process:queued/resumed).
   * Set when the agent is queued for admission (a process slot or memory
   * headroom), cleared when resumed or transitions to normal running state.
   * `reason` names the constraint the spawn queued under
   * (intent-hq/intentd#1196); an absent wire `reason` (older daemons) is
   * normalized to `'slots'` at the events bridge.
   */
  processQueueHint?: {
    waiting: boolean;
    used: number;
    cap: number;
    reason: 'slots' | 'memory-budget';
  };
}

/**
 * A daemon snapshot accepted by the wire upserts (`upsertSession` /
 * `bulkUpsertSessions`). The wire never carries the FE-owned fields, so the
 * payload forbids them: a `StoredAgentSession` (or any object carrying an
 * FE-owned key) is a compile error at the reducer signature, which is what
 * keeps a stored row from being re-read as an incoming snapshot and losing
 * those fields to the carry-forward policy. Mutations of an already-stored
 * session are local updates (`updateSession` / `restoreStoredSessions`).
 */
export type WireAgentSession = AgentSession & { [K in keyof FeOwnedSessionState]?: never };

/**
 * Internal storage shape for a single agent session.
 *
 * Mirrors the public `AgentSession` type while keeping `messages` as the
 * ordered `AgentMessage[]` consumed by UI, sagas, persistence payloads, and
 * retry/regenerate flows, plus the FE-owned fields the wire never carries.
 */
export type StoredAgentSession = Omit<AgentSession, 'messages' | keyof FeOwnedSessionState> & {
  messages: AgentMessage[];
} & FeOwnedSessionState;

/**
 * Bounded, on-demand history segment for infinite scrollback.
 *
 * Holds rows OLDER than the always-resident tail (`session.messages`),
 * hydrated page-by-page as the user scrolls up. Capped at
 * `HISTORY_SEGMENT_MAX` rows; pruning past the cap can open a hole (gap)
 * between history and tail that is refilled on demand.
 */
export interface AgentHistorySegment {
  /** Hydrated older rows, ordered ascending by timestamp (same ordering as the tail). */
  messages: AgentMessage[];
  /**
   * true when a hole is open between history's newest row and the tail's
   * oldest retained row (newest-side pruning severed contiguity). When false
   * and history is non-empty, history's newest row directly precedes the
   * tail's oldest retained row, so the renderer may concatenate without a
   * gap affordance.
   */
  gapToTail: boolean;
  /** true once the conversation's true first message has been hydrated. */
  oldestReached: boolean;
  /**
   * Estimated conversation ordinal (0-based from the OLDEST message) of the
   * segment's FIRST row. Present only on segments seeded by an `aroundIndex`
   * seek landing — it anchors the above/below split of the virtual scroll
   * extent (`splitUnloadedRows`). Maintained as an estimate across
   * prepends/appends (shifted by rows added/pruned at the older side) and
   * pinned to exactly 0 when `oldestReached` flips true. Absent/undefined on
   * serial-walk segments, which are split by `holeRowsEstimate` instead.
   */
  startOrdinalEstimate?: number;
  /**
   * Estimated number of rows inside the open history→tail hole for a
   * SERIAL-walk segment: grown by the exact newest-side prune count when a
   * prepend passes the cap, shrunk by the rows a gap refill moves back into
   * history, and dropped when the hole closes. Anchors the below side of
   * `splitUnloadedRows` so hole rows never inflate the above extent (they
   * used to be attributed all-above, overestimating the virtual extent by up
   * to 2x mid-walk). Absent on seek-seeded segments (`startOrdinalEstimate`
   * anchors their split) and while the segment is contiguous with the tail.
   * Rows the TAIL cap-prunes into the hole (live appends past
   * `MAX_MESSAGES_PER_AGENT` while a contiguous segment is loaded) are also
   * counted here — the tail prune opens the gap and adds the dropped count.
   */
  holeRowsEstimate?: number;
}

/**
 * Agent Session Slice State
 *
 * Flat, agent-keyed state for all AgentSession data.
 * All Date fields are stored as ISO strings (serializable).
 * Messages are stored as an ordered, serializable array.
 */
export interface AgentSessionState {
  /** Agent sessions keyed by agentId */
  byAgentId: Record<string, StoredAgentSession>;
  /** Index: workspace ID → array of agent IDs belonging to that workspace */
  agentIdsByWorkspace: Record<string, string[]>;
  /**
   * On-demand scrollback history segments keyed by agentId. Absent/undefined
   * means no agent has hydrated history (equivalent to an empty record).
   */
  historySegmentsByAgentId?: Record<string, AgentHistorySegment>;
  /**
   * Agents whose detail projection (`agent.get` / `agent.getSession`) has
   * been read at least once this session. A stored row seeded only from the
   * `agent.list` projection (PROTOCOL §5.5) omits the detail-only fields, so
   * their absence is ambiguous until this is set. Absent/undefined means no
   * agent has been detail-hydrated (equivalent to an empty record).
   */
  detailHydrated?: Record<string, true>;
}

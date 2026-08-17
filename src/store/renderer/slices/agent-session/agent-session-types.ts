import type { AgentSession, AgentMessage } from "$shared/types";
import type { UnifiedAgentConfig } from "$shared/types/agent.types";

export interface AgentSessionSendContextItem {
  id: string;
  type: string;
  label?: string;
  content?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  file?: File;
  imageData?: string;
  imageMimeType?: string;
  fileData?: string;
  fileMimeType?: string;
}

export interface AgentSessionContextReference {
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
  imageBlocks?: Array<{ type: "image"; data: string; mimeType: string }>;
  /**
   * Attachment-reference file blocks riding the message (PROTOCOL §5.5) —
   * registry UUID + metadata only, never bytes.
   */
  fileBlocks?: Array<{
    type: "file";
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

export type AgentSessionLaunchConfig = Omit<UnifiedAgentConfig, "workspaceId"> & {
  workspaceId?: UnifiedAgentConfig["workspaceId"];
};

export interface AgentSessionLaunchOptions {
  openAgent?: boolean;
  openInAdjacentPanel?: boolean;
  panelId?: string;
  sourcePanelId?: string;
  assignTaskNoteId?: string;
  reloadNotes?: boolean;
  markInitialMessageSent?: boolean;
}

/**
 * Internal storage shape for a single agent session.
 *
 * Mirrors the public `AgentSession` type while keeping `messages` as the
 * ordered `AgentMessage[]` consumed by UI, sagas, persistence payloads, and
 * retry/regenerate flows.
 */
export type StoredAgentSession = Omit<AgentSession, "messages"> & {
  messages: AgentMessage[];
  /**
   * FE-owned sticky turn-liveness. Set by the event fold when a live running
   * transition lands (`agent:status-changed` with a running status and
   * `isActive: true`), cleared only by an explicit close signal (a
   * terminal/idle status or `isActive: false` — event or hydration snapshot).
   *
   * Exists because the daemon emits the turn-start event BEFORE opening the
   * STAB-125 live-turn slot (agent_manager: try_begin → persist_status(Active)
   * → run_prompt_turn → begin_live_turn), so the STAB-9 `agent.list` refetch
   * fired off that very event can resolve with `turnInFlight: false` mid-turn
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
};

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
}


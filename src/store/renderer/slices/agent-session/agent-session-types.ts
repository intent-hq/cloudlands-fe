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
};

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
}


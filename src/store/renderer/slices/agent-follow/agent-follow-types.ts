/**
 * Types for the agent-follow Redux slice.
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type AgentColor = {
  start: string;
  end: string;
  gradient: string;
};

export type PendingChange = {
  file: string;
  content: string;
  isAddition: boolean;
  timestamp: number;
};

export type AgentFollowState = {
  isFollowing: boolean;
  followedAgentId: string | null;
  agentColor: AgentColor | null;
  currentFile: string | null;
  currentNoteId: string | null;
  isAnimating: boolean;
  isPaused: boolean;
  typingSpeed: number;
  pendingChanges: PendingChange[];
};


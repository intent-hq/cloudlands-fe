/**
 * Agent Lock Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

/**
 * Per-workspace agent lock state.
 * Tracks which agents and files are locked due to auto-commit + active agents.
 */
export type AgentLockWorkspaceState = {
  /** Agent IDs that are currently locked (auto-commit enabled + actively working) */
  lockedAgentIds: Record<string, true>;
  /** File paths that are locked because they belong to a locked agent */
  lockedFilePaths: Record<string, true>;
};

/**
 * Root agent lock state shape.
 */
export type AgentLockState = {
  byWorkspaceId: Record<string, AgentLockWorkspaceState>;
};


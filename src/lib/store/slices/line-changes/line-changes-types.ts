/**
 * Line Changes Types
 *
 * Types for tracking line change statistics across workspaces and agents.
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type LineChangeStats = {
  additions: number;
  deletions: number;
  timestamp: string;
};

export type FileLineChange = {
  path: string;
  additions: number;
  deletions: number;
  action: "create" | "modify" | "delete";
};

export type LineChangesState = {
  /** Workspace stats keyed by workspace ID */
  workspaceStats: Record<string, LineChangeStats>;
  /** Agent stats keyed by agent ID */
  agentStats: Record<string, LineChangeStats>;
  /** File changes keyed by workspace or agent ID */
  fileChanges: Record<string, FileLineChange[]>;
};


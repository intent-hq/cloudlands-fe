/**
 * Session Stats Types
 *
 * Types for session credit usage statistics.
 * Safe to import from any process (renderer, main, shared, preload).
 */

/** Stats for a single agent session */
export type AgentSessionStats = {
  sessionId: string;
  messageCount: number;
  toolCount: number;
  creditsUsed: number | null;
  parentCreditsUsed: number | null;
  subAgentCreditsUsed: number | null;
  /** ISO timestamp when stats were last fetched */
  lastFetchedAt: string;
};

/** Aggregate stats for all agents in a workspace */
export type WorkspaceAggregateStats = {
  totalCreditsUsed: number;
  totalMessageCount: number;
  totalToolCount: number;
  agentCount: number;
  /** Whether any session has credits still being computed */
  hasPendingCredits: boolean;
  /** True if some session stats requests failed (partial aggregate). */
  isPartial: boolean;
  /** Number of session stats requests that failed. */
  failedCount: number;
  /** ISO timestamp when stats were last fetched */
  lastFetchedAt: string;
};

/** Session stats slice state */
export type SessionStatsState = {
  /** Per-agent stats keyed by agentId */
  agentStats: Record<string, AgentSessionStats>;
  /** Workspace-level aggregate stats keyed by workspaceId */
  workspaceStats: Record<string, WorkspaceAggregateStats>;
  /** Workspace-stats loading state keyed by workspaceId */
  loadingWorkspaceStats: Record<string, boolean>;
  /** Loading state per agent (keyed by agentId) */
  loadingAgentStats: Record<string, boolean>;
  /** Per-workspace error messages (keyed by workspaceId) */
  workspaceStatsErrors: Record<string, string>;
  /** Per-agent error messages */
  agentStatsErrors: Record<string, string>;
};

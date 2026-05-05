/**
 * Session Stats Types
 *
 * Shared types for the session credit usage stats feature.
 * These types mirror the JSON output of `auggie session stats <sessionId> --json`.
 */

/**
 * Stats for a single session as returned by the CLI.
 *
 * Nullable fields reflect the real CLI output:
 * - `title` is null for sessions that haven't been titled yet.
 * - `creditsUsed` / `parentCreditsUsed` / `subAgentCreditsUsed` are null
 *   when credits haven't been computed yet (e.g. session still in progress).
 */
export interface SessionStats {
  sessionId: string;
  created: string;
  modified: string;
  title: string | null;
  messageCount: number;
  toolCount: number;
  creditsUsed: number | null;
  parentCreditsUsed: number | null;
  subAgentCreditsUsed: number | null;
}

/**
 * Aggregated stats across multiple sessions (e.g., all agents in a workspace).
 *
 * Totals treat null credit values as 0. Use `hasPendingCredits` to distinguish
 * "0 credits used" from "credits not yet computed".
 */
export interface AggregatedSessionStats {
  sessions: SessionStats[];
  totalCreditsUsed: number;
  totalParentCreditsUsed: number;
  totalSubAgentCreditsUsed: number;
  totalMessageCount: number;
  totalToolCount: number;
  /** True if any session has null creditsUsed (credits not yet computed). */
  hasPendingCredits: boolean;
  /** True if some session stats requests failed (partial aggregate). */
  isPartial: boolean;
  /** Number of session stats requests that failed. */
  failedCount: number;
}

/**
 * PR Status Slice Types
 *
 * Types for the pr-status Redux slice. Safe to import from any process.
 */

export type PRStatusRefreshResult = {
  success: boolean;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  discovered?: boolean;
};

/**
 * Per-workspace PR status state.
 */
export type PRStatusWorkspaceState = {
  /** Timestamp of last successful refresh (ms since epoch) */
  lastRefreshTime: number | null;
  /** Whether a refresh is currently in progress */
  isRefreshing: boolean;
  /** Last refresh error message */
  lastError: string | null;
};

export type PRStatusState = {
  byWorkspaceId: Record<string, PRStatusWorkspaceState>;
};


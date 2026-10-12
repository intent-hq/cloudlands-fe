export type PRRefreshProvenance = {
  principalContext: string;
  physicalOwnerId: string;
};

/**
 * Per-workspace PR status state.
 */
export type PRStatusWorkspaceState = {
  /** Timestamp of last successful refresh (ms since epoch) */
  lastRefreshTime: number | null;
  /** Only a successful explicitly scoped refresh can attest this timestamp. */
  refreshProvenance?: PRRefreshProvenance;
  /** Whether a refresh is currently in progress */
  isRefreshing: boolean;
  /** Last refresh error message */
  lastError: string | null;
};

export type PRStatusState = {
  byWorkspaceId: Record<string, PRStatusWorkspaceState>;
};

import type { WorkspaceDiffSummary, WorkspaceGitSummary } from "$shared/types";

/** Per-workspace on-demand diff/git summary state. */
export interface WorkspaceSummariesWorkspaceState {
  /** Latest diff summary fetched from WORKSPACE_CHANNELS.GET_DIFF_SUMMARY (null when unavailable). */
  diffSummary: WorkspaceDiffSummary | null;
  /** Latest git summary fetched from WORKSPACE_CHANNELS.GET_GIT_SUMMARY (null when unavailable). */
  gitSummary: WorkspaceGitSummary | null;
  loading: boolean;
  error: string | null;
  /** True once summaries have been loaded at least once for this workspace. */
  initialized: boolean;
}

/** Root workspace-summaries state, keyed by workspace ID. */
export interface WorkspaceSummariesState {
  byWorkspaceId: Record<string, WorkspaceSummariesWorkspaceState>;
}


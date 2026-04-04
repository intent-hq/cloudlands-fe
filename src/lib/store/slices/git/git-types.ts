/**
 * Git Slice Types
 *
 * Types for the git Redux slice. Safe to import from any process.
 */

import type { GitStatus, CommitInfo, DiffChunk } from "$shared/types";

/**
 * Per-workspace git state.
 *
 * NOTE: GitStatus, CommitInfo, and DiffChunk are serializable plain objects
 * from shared/types — no class instances, Maps, Sets, etc.
 */
export type GitWorkspaceState = {
  status: GitStatus | null;
  commits: CommitInfo[];
  diffs: DiffChunk[];
  loading: boolean;
  error: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
};

export type GitState = {
  byWorkspaceId: Record<string, GitWorkspaceState>;
};


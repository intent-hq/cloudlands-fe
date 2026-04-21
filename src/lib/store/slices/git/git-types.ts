/**
 * Git Slice Types
 *
 * Types for the git Redux slice. Safe to import from any process.
 */

import type { GitStatus, DiffChunk } from "$shared/types";

// ── Git Operation Event Types ──

export type GitOperationType = "commit" | "push" | "create-pr" | "auto-commit";

export type GitOperationResult = {
  commitHash?: string;
  prNumber?: number;
  prUrl?: string;
  noChanges?: boolean;
  reason?: string;
};

export type GitOperationMetadata = {
  message?: string;
  prTitle?: string;
  agentId?: string;
  agentName?: string;
};

export type GitOperationCompletedEvent = {
  operationId: string;
  workspaceId: string;
  operationType: GitOperationType;
  result?: GitOperationResult;
  metadata?: GitOperationMetadata;
};

export type GitOperationFailedEvent = {
  operationId: string;
  workspaceId: string;
  operationType: GitOperationType;
  error: string;
  metadata?: GitOperationMetadata;
};

export type AutoCommitHookFailureEvent = {
  workspaceId: string;
  agentId: string;
  agentName?: string;
  status: "waking-agent" | "retries-exhausted";
  hookOutput: string;
  retryCount: number;
};

// ── Post-merge / sidebar git operation types (moved from transient-ui) ──

export interface PostMergeState {
  aheadOfTrunk: number | null;
  behindTrunk: number;
  hasConflicts: boolean;
  isContentMergedToTrunk: boolean;
  hasRemote: boolean;
  isMergedToTrunk: boolean;
  mergeHeadSha: string | null;
  hasResetToTrunk: boolean;
}

export type GitOperationFlagName =
  | "isPushing"
  | "isPulling"
  | "isForcePushing"
  | "isRebasing"
  | "isRefreshingPR"
  | "isRefreshingGitStatus"
  | "isResettingToTrunk";

export interface GitOperationFlags {
  isPushing: boolean;
  isPulling: boolean;
  isForcePushing: boolean;
  isRebasing: boolean;
  isRefreshingPR: boolean;
  isRefreshingGitStatus: boolean;
  isResettingToTrunk: boolean;
}

/**
 * Per-workspace git state.
 *
 * NOTE: GitStatus, CommitInfo, and DiffChunk are serializable plain objects
 * from shared/types — no class instances, Maps, Sets, etc.
 */
export type GitWorkspaceState = {
  status: GitStatus | null;
  diffs: DiffChunk[];
  loading: boolean;
  error: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  postMergeState: PostMergeState | null;
  gitOperations: GitOperationFlags;
};

export type GitState = {
  byWorkspaceId: Record<string, GitWorkspaceState>;
  lastGitOperation: GitOperationCompletedEvent | null;
  lastGitError: GitOperationFailedEvent | null;
  lastAutoCommitHookFailure: AutoCommitHookFailureEvent | null;
};


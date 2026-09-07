/**
 * Git Slice Types
 *
 * Types for the git Redux slice. Safe to import from any process.
 */

import type { CommitFile } from '$features/file-tracking/types';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import type { CommitInfo, GitStatus, DiffChunk } from '$shared/types';
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

// ── Git Operation Event Types ──

type GitOperationType = 'commit' | 'push' | 'create-pr' | 'auto-commit';

type GitOperationResult = {
  commitHash?: string;
  prNumber?: number;
  prUrl?: string;
  noChanges?: boolean;
  reason?: string;
};

type GitOperationMetadata = {
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

type AutoCommitHookFailureEvent = {
  workspaceId: string;
  agentId: string;
  agentName?: string;
  status: 'waking-agent' | 'retries-exhausted';
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
  | 'isPushing'
  | 'isPulling'
  | 'isForcePushing'
  | 'isRebasing'
  | 'isRefreshingPR'
  | 'isRefreshingGitStatus'
  | 'isResettingToTrunk';

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
  acceptChangesStatus: WorkspaceGitStatus | null;
  acceptChangesStatusLoading: boolean;
  gitOperations: GitOperationFlags;
  secondaryRoots: Record<string, SecondaryRootGitState>;
};

type SecondaryRootGitState = {
  status: GitStatus | null;
  commits: Collection<CommitInfo, 'hash'>;
  nextToken?: string;
  commitFiles: Collection<SecondaryRootCommitFiles, 'commitHash'>;
  loading: boolean;
  error: string | null;
};

type SecondaryRootCommitFiles = {
  commitHash: string;
  files: Collection<CommitFile, 'path'> | null;
};

export type SecondaryRootGitData = {
  status: GitStatus | null;
  commits: CommitInfo[];
  nextToken?: string;
  commitFiles: Record<string, CommitFile[] | null>;
};

export type GitState = {
  byWorkspaceId: Record<string, GitWorkspaceState>;
  lastGitOperation: GitOperationCompletedEvent | null;
  lastGitError: GitOperationFailedEvent | null;
  lastAutoCommitHookFailure: AutoCommitHookFailureEvent | null;
};

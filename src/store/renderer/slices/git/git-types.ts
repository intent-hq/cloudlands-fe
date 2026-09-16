/**
 * Git Slice Types
 *
 * Types for the git Redux slice. Safe to import from any process.
 */

import type { CommitFile } from '$features/file-tracking/types';
import type { CommitInfo, GitStatus, DiffChunk } from '$shared/types';
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { MutationResult } from '$lib/client';
import type {
  AcceptChangesResult,
  PrepareAcceptResponse,
  WorkspaceGitStatus,
} from '$features/accept-changes/types';

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

export type GitStatusReadOperation = {
  requestId: string | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  result: GitStatus | null;
  error: string | null;
};

/**
 * Per-workspace git state.
 *
 * NOTE: GitStatus, CommitInfo, and DiffChunk are serializable plain objects
 * from shared/types — no class instances, Maps, Sets, etc.
 */
export type GitWorkspaceState = {
  status: GitStatus | null;
  statusReadOperation: GitStatusReadOperation;
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
  commitDetails: Collection<GitCommitDetailsEntry, 'key'>;
  diffReads: Collection<GitDiffReadEntry, 'key'>;
  fileReads: Collection<GitFileReadEntry, 'key'>;
  mutationRequests: Collection<GitMutationRequestEntry, 'key'>;
  enrichmentReads: Collection<GitEnrichmentReadEntry, 'key'>;
};

type GitEnrichmentDiffRequest = {
  key: string;
  path: string;
  staged: boolean;
  gitlink?: { oldSha?: string; newSha?: string };
  gitRootId?: string;
  gitRootPath?: string;
};

type GitEnrichmentBranchDiffRequest = {
  key: string;
  path: string;
  baseRef?: string;
  baseCommitSha?: string;
};

type GitEnrichmentNumstatRequest = {
  key: string;
  staged?: boolean;
  baseRef?: string;
  baseCommitSha?: string;
  targetRef?: string;
};

type GitEnrichmentShowFileRequest = {
  key: string;
  path: string;
  ref: string;
  gitRootId?: string;
};

export type GitEnrichmentRequest = {
  diffs: GitEnrichmentDiffRequest[];
  branchDiffs: GitEnrichmentBranchDiffRequest[];
  numstats: GitEnrichmentNumstatRequest[];
  showFiles: GitEnrichmentShowFileRequest[];
};

type GitEnrichmentNumstatEntry = {
  filePath: string;
  additions: number;
  deletions: number;
};

export type GitEnrichmentResult = {
  diffs: Record<string, DiffChunk | null>;
  branchDiffs: Record<string, DiffChunk | null>;
  numstats: Record<string, GitEnrichmentNumstatEntry[]>;
  showFiles: Record<string, { success: boolean; data?: string; error?: string }>;
};

export type GitEnrichmentReadEntry = {
  key: string;
  requestId: string;
  data: GitEnrichmentResult | null;
  loading: boolean;
  error: string | null;
};

export type GitFileReadEntry = {
  key: string;
  path: string;
  ref: string;
  gitRootId?: string;
  data: string | null;
  loading: boolean;
  error: string | null;
};

export type GitMutationRequestEntry = {
  key: string;
  operation: string;
  scope: string;
  data: MutationResult | AcceptChangesResult | PrepareAcceptResponse | WorkspaceGitStatus | null;
  loading: boolean;
  error: string | null;
  version: number;
};

export type GitCommitDetails = {
  commitHash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  files: CommitFile[];
};

export type GitCommitDetailsEntry = {
  key: string;
  commitHash: string;
  gitRootId?: string;
  data: GitCommitDetails | null;
  loading: boolean;
  error: string | null;
};

export type GitDiffReadEntry = {
  key: string;
  path?: string;
  paths?: string[];
  staged?: boolean;
  commitHash?: string;
  gitRootId?: string;
  data: DiffChunk[];
  loading: boolean;
  error: string | null;
};

export type GitBranchesData = {
  branches: string[];
  remoteBranches: string[];
  defaultBranch: string;
  currentBranch: string;
};

export type GitBranchStatusData = {
  ahead: number;
  behind: number;
  hasUncommittedChanges: boolean;
  currentBranch: string;
};

export type GitRepoReadState = {
  branches: GitBranchesData | null;
  branchesLoading: boolean;
  branchesError: string | null;
  branchStatuses: Record<string, GitBranchStatusData | null>;
  branchStatusLoading: Record<string, boolean>;
  branchStatusErrors: Record<string, string | null>;
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
  byRepoPath: Record<string, GitRepoReadState>;
  lastGitOperation: GitOperationCompletedEvent | null;
  lastGitError: GitOperationFailedEvent | null;
  lastAutoCommitHookFailure: AutoCommitHookFailureEvent | null;
};

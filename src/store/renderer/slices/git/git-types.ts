/**
 * Git Slice Types
 *
 * Types for the git Redux slice. Safe to import from any process.
 */

import type { CommitFile } from '$features/file-tracking/types';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import type { CommitInfo, GitStatus, DiffChunk } from '$shared/types';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { CommitDetailsResult, GitDiffsOptions } from '$lib/client/app-client';

export type GitReadRequest =
  | ({ kind: 'diffs' } & GitDiffsOptions)
  | { kind: 'commitDetails'; commitHash: string; gitRootId?: string }
  | { kind: 'showFile'; filePath: string; ref: string; gitRootId?: string }
  | {
      kind: 'numstat';
      staged?: boolean;
      baseRef?: string;
      baseCommitSha?: string;
      targetRef?: string;
      gitRootId?: string;
    }
  | { kind: 'autoCommitStatus'; agentId: string; gitRootId?: undefined }
  | TrackedDiffReadRequest;

export interface TrackedDiffReadRequest {
  kind: 'trackedDiff';
  filePath: string;
  workspacePath: string;
  stage: string;
  commitHash?: string;
  gitRootId?: string;
  gitRootPath?: string;
  gitlink?: { oldSha?: string; newSha?: string };
  baseRef?: string;
  baseCommitSha?: string;
  providedOld?: string;
  providedNew?: string;
  useProvidedContent: boolean;
  forceRefresh: boolean;
  allowHeadReads: boolean;
}

export type AutoCommitReadStatus =
  | { state: 'committing' }
  | { state: 'committed'; hash: string; message: string; fileCount: number }
  | { state: 'hook-failure'; status: 'waking-agent' | 'retries-exhausted'; retryCount: number };

export type GitReadResult =
  | { kind: 'diffs'; chunks: DiffChunk[] }
  | { kind: 'commitDetails'; details: CommitDetailsResult | null }
  | { kind: 'showFile'; content: string }
  | { kind: 'numstat'; entries: { filePath: string; additions: number; deletions: number }[] }
  | { kind: 'autoCommitStatus'; statuses: AutoCommitReadStatus[] }
  | {
      kind: 'trackedDiff';
      oldContent: string;
      newContent: string;
      chunk?: DiffChunk;
      gitlink: boolean;
    };

export type GitReadStoredResult =
  | Exclude<GitReadResult, { kind: 'diffs' | 'commitDetails' | 'numstat' | 'autoCommitStatus' }>
  | { kind: 'diffs'; chunks: Collection<DiffChunk, 'file'> }
  | {
      kind: 'commitDetails';
      details:
        | (Omit<CommitDetailsResult, 'fileDetails'> & {
            fileDetails: Collection<CommitDetailsResult['fileDetails'][number], 'path'>;
          })
        | null;
    }
  | {
      kind: 'numstat';
      entries: Collection<{ filePath: string; additions: number; deletions: number }, 'filePath'>;
    }
  | {
      kind: 'autoCommitStatus';
      statuses: Collection<{ index: string; status: AutoCommitReadStatus }, 'index'>;
    };

interface GitReadConsumer {
  consumerId: string;
  requestId: string;
  readKey: string;
}

interface GitReadEntry {
  readKey: string;
  generation: string;
  request: GitReadRequest;
  loading: boolean;
  error: string | null;
  result: GitReadStoredResult | null;
}

export interface GitReadView {
  requestId: string;
  request: GitReadRequest;
  loading: boolean;
  error: string | null;
  result: GitReadResult | null;
}

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
  readConsumers: Collection<GitReadConsumer, 'consumerId'>;
  reads: Collection<GitReadEntry, 'readKey'>;
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

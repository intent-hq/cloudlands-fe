/**
 * Accept Changes Types
 *
 * Type definitions for the accept changes workflow.
 */

import type { WorkspaceId } from '$shared/types/branded-ids';

/** Actions that can be performed when accepting changes */
export type AcceptAction =
  | 'commit'
  | 'push'
  | 'create-pr'
  | 'merge'
  | 'undo-push'
  | 'undo-commit'
  | 'reset-to-trunk'
  | 'rebase-onto-trunk';

/** Merge strategies when merging into trunk */
export type MergeStrategy = 'merge' | 'squash' | 'rebase';

/** Step status in the accept changes workflow */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Information about the current git state for accepting changes */
export interface WorkspaceGitStatus {
  branch: string;
  trunkBranch: string;
  aheadOfTrunk: number;
  behindTrunk: number;
  hasRemote: boolean;
  isPushed: boolean;
  uncommittedCount: number;
  stagedCount: number;
  localCommits: LocalCommitInfo[];
  existingPR?: {
    number: number;
    url: string;
    htmlUrl: string;
    title: string;
    state: 'open' | 'closed' | 'merged' | 'draft';
  };
  canMergeDirectly: boolean;
  hasConflicts: boolean;
  /** True if local branch has diverged from remote (e.g., after rebase) - needs force push */
  hasDivergedFromRemote: boolean;
  /** True if the branch's tree hash appears in trunk history (indicates squash merge) */
  isContentMergedToTrunk?: boolean;
  remoteUrl?: string;
  owner?: string;
  repo?: string;
  /** Available remote branches for target branch selection */
  availableBranches?: string[];
  /** Default branch of the repository */
  defaultBranch?: string;
}

/** File changed in a commit */
export interface CommitFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Local commit information */
export interface LocalCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  /**
   * Changed-file count. Omitted by `accept-changes.getStatus` (metadata-only
   * commit walk); fetch per-file data on demand via `git.commitDetails`.
   */
  filesChanged?: number;
  isPushed: boolean;
  /** Omitted by `accept-changes.getStatus`; see `filesChanged`. */
  files?: CommitFile[];
  /** Agent ID if this commit was made by an agent (e.g., via auto-commit) */
  agentId?: string;
  /** Linked note ID for the task the agent was working on */
  linkedNoteId?: string;
}

/** Request to get the current accept changes status */
export interface GetAcceptStatusRequest {
  workspaceId: WorkspaceId;
}

/** Request to prepare for accept changes (validation) */
export interface PrepareAcceptRequest {
  workspaceId: WorkspaceId;
  action: AcceptAction;
  files?: string[];
}

/** File info in prepare response */
export interface PrepareAcceptFile {
  path: string;
  additions: number;
  deletions: number;
  staged: boolean;
}

/** Prepare response with validation results */
export interface PrepareAcceptResponse {
  valid: boolean;
  warnings: string[];
  errors: string[];
  suggestedCommitMessage?: string;
  suggestedPRTitle?: string;
  suggestedPRBody?: string;
  filesCount: number;
  additions: number;
  deletions: number;
  files: PrepareAcceptFile[];
}

/** Metadata about commits being undone, used to restore attributions */
export interface UndoCommitMetadata {
  /** Commit hash being undone */
  hash: string;
  /** Agent ID if this commit was made by an agent */
  agentId?: string;
  /** Agent name for display */
  agentName?: string;
  /** Linked note ID for the task */
  linkedNoteId?: string;
  /** Files in this commit */
  files?: string[];
}

/** Request to execute accept changes */
export interface ExecuteAcceptRequest {
  workspaceId: WorkspaceId;
  action: AcceptAction;
  files?: string[];
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
  targetBranch?: string;
  mergeStrategy?: MergeStrategy;
  /** Commit hash to push up to (for partial push) or reset to (for undo-push) */
  upToCommitHash?: string;
  /** Metadata about commits being undone, used to restore attributions */
  undoCommitsMetadata?: UndoCommitMetadata[];
  options?: {
    stageUnstaged?: boolean;
    pushAfterCommit?: boolean;
    createPRAfterPush?: boolean;
    rebaseFirst?: boolean;
    /** When true, merge only updates the local trunk branch ref without pushing to remote */
    localOnly?: boolean;
  };
}

/** Individual step in the workflow */
export interface AcceptChangesStep {
  id: string;
  name: string;
  status: StepStatus;
  message?: string;
  error?: string;
}

/** Result of executing accept changes */
export interface AcceptChangesResult {
  success: boolean;
  steps: AcceptChangesStep[];
  result?: {
    commitHash?: string;
    prNumber?: number;
    prUrl?: string;
    prHtmlUrl?: string;
    mergeCommitHash?: string;
    existingPR?: boolean; // True if we found an existing PR instead of creating a new one
    autoRebased?: boolean; // True if auto-rebase was performed before merging
    newHeadSha?: string; // New HEAD SHA after reset-to-trunk
    newBaseSha?: string; // New base SHA after auto-rebase (trunk tip at rebase time)
  };
  error?: string;
}



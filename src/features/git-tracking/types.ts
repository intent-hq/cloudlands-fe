/**
 * Git Tracking Types
 *
 * Comprehensive type definitions for tracking git state and changes.
 */

import { z } from 'zod';

/**
 * Git file status
 */
export enum GitFileStatus {
  Added = 'added',
  Modified = 'modified',
  Deleted = 'deleted',
  Renamed = 'renamed',
  Copied = 'copied',
  Untracked = 'untracked',
  Ignored = 'ignored',
  Conflicted = 'conflicted',
}

/**
 * Change location in git workflow
 */
export enum ChangeLocation {
  WorkingDirectory = 'working',
  StagingArea = 'staged',
  LocalCommit = 'committed',
  RemoteBranch = 'remote',
  PullRequest = 'pr',
  Merged = 'merged',
}

/**
 * Individual file change
 */
export interface GitFileChange {
  path: string;
  relativePath: string;
  status: GitFileStatus;
  location: ChangeLocation;
  additions?: number;
  deletions?: number;
  oldPath?: string; // For renames
  similarity?: number; // Similarity percentage for renames
  binary?: boolean;
  mode?: string; // File mode (e.g., 100644)
  hash?: string; // Git object hash
}

/**
 * Diff hunk information
 */
/**
 * Diff hunk information
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  content?: string;
  header?: string;
}

/**
 * Complete diff for a file
 */
export interface FileDiff {
  file: GitFileChange;
  hunks: DiffHunk[];
  oldContent?: string;
  newContent?: string;
  patch?: string;
}

/**
 * Git commit information
 */
export interface GitCommit {
  sha: string;
  shortSha: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  committer: {
    name: string;
    email: string;
    date: string;
  };
  message: string;
  subject: string;
  body?: string;
  parents: string[];
  files: GitFileChange[];
  stats: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
}

/**
 * Git branch information
 */
export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  lastCommit?: GitCommit;
  protected?: boolean;
}

/**
 * Pull request information
 */
export interface PullRequest {
  id: string;
  number: number;
  title: string;
  description?: string;
  state: 'open' | 'closed' | 'merged' | 'draft';
  url: string;
  htmlUrl: string;
  sourceBranch: string;
  targetBranch: string;
  author: {
    login: string;
    name?: string;
    avatarUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  closedAt?: string;
  mergeable?: boolean;
  mergeableState?: string;
  reviews: PullRequestReview[];
  checks: PullRequestCheck[];
  labels: string[];
  assignees: string[];
  milestone?: string;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** SHA of the head commit, used for race condition protection */
  headSha?: string;
}

/**
 * Pull request review
 */
export interface PullRequestReview {
  id: string;
  author: string;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'pending';
  submittedAt: string;
  body?: string;
}

/**
 * Pull request check/status
 */
export interface PullRequestCheck {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out';
  url?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * GitHub issue information
 */
export interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  url: string;
  htmlUrl: string;
  author: {
    login: string;
    name?: string;
    avatarUrl?: string;
  };
  labels: string[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  comments: number;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
}

/**
 * Complete git state for a workspace
 */
export interface GitState {
  workspaceId: string;
  branch: GitBranch;
  status: {
    isClean: boolean;
    hasConflicts: boolean;
    workingDirectory: GitFileChange[];
    stagingArea: GitFileChange[];
    ahead: number;
    behind: number;
  };
  commits: GitCommit[];
  branches: GitBranch[];
  remotes: GitRemote[];
  tags: GitTag[];
  stashes: GitStash[];
  pullRequests: PullRequest[];
  lastFetch?: string;
  lastSync?: string;
}

/**
 * Git remote information
 */
export interface GitRemote {
  name: string;
  url: string;
  fetch: string;
  push?: string;
}

/**
 * Git tag information
 */
export interface GitTag {
  name: string;
  sha: string;
  message?: string;
  tagger?: {
    name: string;
    email: string;
    date: string;
  };
}

/**
 * Git stash information
 */
export interface GitStash {
  index: number;
  message: string;
  sha: string;
  branch?: string;
  date: string;
}

/**
 * Git operation result
 */
export interface GitOperationResult {
  success: boolean;
  operation: string;
  message?: string;
  error?: string;
  changes?: GitFileChange[];
  conflicts?: string[];
}

/**
 * Git sync status
 */
export interface GitSyncStatus {
  local: {
    branch: string;
    commit: string;
    uncommittedChanges: number;
  };
  remote: {
    branch: string;
    commit: string;
    ahead: number;
    behind: number;
  };
  pullRequest?: {
    number: number;
    state: string;
    mergeable: boolean;
  };
  lastSync: string;
  syncing: boolean;
}

/**
 * Zod schemas for validation
 */
export const GitFileChangeSchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  status: z.nativeEnum(GitFileStatus),
  location: z.nativeEnum(ChangeLocation),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  oldPath: z.string().optional(),
  similarity: z.number().optional(),
  binary: z.boolean().optional(),
  mode: z.string().optional(),
  hash: z.string().optional(),
});

export const GitCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  author: z.object({
    name: z.string(),
    email: z.string().email(),
    date: z.string(),
  }),
  committer: z.object({
    name: z.string(),
    email: z.string().email(),
    date: z.string(),
  }),
  message: z.string(),
  subject: z.string(),
  body: z.string().optional(),
  parents: z.array(z.string()),
  files: z.array(GitFileChangeSchema),
  stats: z.object({
    additions: z.number(),
    deletions: z.number(),
    filesChanged: z.number(),
  }),
});

export const GitStateSchema = z.object({
  workspaceId: z.string(),
  branch: z.object({
    name: z.string(),
    current: z.boolean(),
    remote: z.string().optional(),
    upstream: z.string().optional(),
    ahead: z.number(),
    behind: z.number(),
    lastCommit: GitCommitSchema.optional(),
    protected: z.boolean().optional(),
  }),
  status: z.object({
    isClean: z.boolean(),
    hasConflicts: z.boolean(),
    workingDirectory: z.array(GitFileChangeSchema),
    stagingArea: z.array(GitFileChangeSchema),
    ahead: z.number(),
    behind: z.number(),
  }),
  commits: z.array(GitCommitSchema),
  branches: z.array(z.any()),
  remotes: z.array(z.any()),
  tags: z.array(z.any()),
  stashes: z.array(z.any()),
  pullRequests: z.array(z.any()),
  lastFetch: z.string().optional(),
  lastSync: z.string().optional(),
});

export type ValidatedGitState = z.infer<typeof GitStateSchema>;

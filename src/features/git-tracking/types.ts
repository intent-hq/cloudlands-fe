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
interface PullRequestReview {
  id: string;
  author: string;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'pending';
  submittedAt: string;
  body?: string;
}

/**
 * Pull request check/status
 */
interface PullRequestCheck {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out';
  url?: string;
  startedAt?: string;
  completedAt?: string;
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

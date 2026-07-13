/**
 * Git Types
 *
 * Type definitions for git operations used by change detection.
 */

export interface GitStatus {
  staged: string[];
  /** Files that are staged as newly added (git status 'A') */
  stagedAdded: string[];
  /** Files that are staged for deletion (git status 'D' in first column) */
  stagedDeleted: string[];
  unstaged: string[];
  untracked: string[];
  /** Files that are deleted but not staged (git status 'D' in second column) */
  deleted: string[];
  renamed: Map<string, string>;
}

export interface GitDiffResult {
  path: string;
  additions: number;
  deletions: number;
  diff: string;
  /** Whether this is a binary file (not diffable) */
  isBinary?: boolean;
  /** Whether this file was too large to diff */
  isTooLarge?: boolean;
}

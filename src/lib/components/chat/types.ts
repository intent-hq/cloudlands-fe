/**
 * Types for chat changes panel components
 */

import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';

/** Diff line from git diff output */
export interface DiffLine {
  type: 'Addition' | 'Deletion' | 'Context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/** Diff hunk from git diff output */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/** Change category for filtering */
export type ChangeCategory = 'unstaged' | 'staged' | 'committed';

/** Extended change type that includes staging status and diff chunks */
export interface LocalFileChange extends ChatFileChange {
  staged?: boolean;
  /** Change category for filtering */
  category?: ChangeCategory;
  /** Commit hash for committed changes */
  commitHash?: string;
  /** Commit message for committed changes */
  commitMessage?: string;
  /** Diff chunks with context lines from git:diff */
  chunks?: DiffHunk[];
  /** Full file content from disk (for agent changes visualization) */
  fullFileContent?: string;
  /** For merged changes: the unstaged part of the change */
  unstagedPart?: LocalFileChange;
  /** For merged changes: the staged part of the change */
  stagedPart?: LocalFileChange;
  /** Whether this is a merged change containing both staged and unstaged parts */
  isMerged?: boolean;
  /** For merged changes: all parts grouped together (staged, unstaged, committed) */
  allParts?: Array<{ change: LocalFileChange; category: ChangeCategory }>;
}

/** Change part for combined diff view */
export interface ChangePart {
  change: LocalFileChange;
  category: ChangeCategory;
}

/**
 * File Tracking System Types
 *
 * Comprehensive type definitions for tracking file changes through git workflow stages
 */

/**
 * Change stages in the git workflow
 */
export enum ChangeStage {
  Unstaged = 'unstaged',
  Staged = 'staged',
  Committed = 'committed',
  Pushed = 'pushed',
  PullRequest = 'pull_request',
  Merged = 'merged',
  Trunk = 'trunk',
}

/**
 * File change statistics
 */
export interface FileStats {
  additions: number;
  deletions: number;
  binary?: boolean;
}

/**
 * Agent attribution information
 */
export interface AgentAttribution {
  agentId: string;
  agentName: string;
  sessionId: string;
  turnNumber: number;
  messageId?: string;
  toolCallId?: string;
  timestamp: number;
}

/**
 * Individual tracked change
 */
/**
 * File change status
 */
export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface TrackedChange {
  id: string;
  file: string;
  relativePath: string;
  stage: ChangeStage;
  stats: FileStats;
  /** File change status: added (new file), modified, deleted, or renamed */
  status?: FileChangeStatus;
  attribution: {
    agent?: AgentAttribution;
    manual?: boolean;
    timestamp: number;
  };
  commitHash?: string;
  prNumber?: number;
  content?: {
    oldContent?: string;
    newContent?: string;
    diff?: string;
    /**
     * Whether the content is full file content (from git:diff) vs snippet content (from tool calls).
     * When true, the diff viewer can safely use git:diff to refresh content on external changes.
     * When false/undefined, the content is a snippet that requires special handling.
     */
    isFullFileContent?: boolean;
  };
  hunks?: DiffHunk[];
}

/**
 * Diff hunk information
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/**
 * Individual diff line
 */
export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  selected?: boolean;
}

/**
 * Stage transition record
 */
export interface StageTransition {
  id: string;
  changeId: string;
  fromStage: ChangeStage;
  toStage: ChangeStage;
  timestamp: number;
  actor: {
    type: 'agent' | 'user';
    id: string;
    name?: string;
  };
  metadata?: {
    commitHash?: string;
    prNumber?: string;
    message?: string;
  };
}

/**
 * Working changes grouped by stage
 */
export interface WorkingChanges {
  unstaged: TrackedChange[];
  staged: TrackedChange[];
}

/**
 * Commit information
 */
export interface CommitFile {
  path: string;
  additions?: number;
  deletions?: number;
  status?: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  authorEmail?: string;
  timestamp: number;
  date?: string;
  files: CommitFile[];
  filesChanged?: number;
  stage: 'local' | 'pushed' | 'pr' | 'merged';
  isPushed?: boolean;
  prNumber?: number;
  prUrl?: string;
  /** Agent ID if this commit was made by an agent (e.g., via auto-commit) */
  agentId?: string;
  /** Linked note ID for the task the agent was working on */
  linkedNoteId?: string;
}

/**
 * Filter options for viewing changes
 */
export interface ChangeFilter {
  stage?: ChangeStage[];
  agentId?: string;
  sessionId?: string;
  turnNumber?: number;
  filePattern?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

/**
 * View mode for file lists
 */
export type FileListViewMode = 'flat' | 'tree';

/**
 * Main panel view type
 */
export type MainPanelViewType =
  | 'agent'
  | 'staged'
  | 'unstaged'
  | 'commit'
  | 'diff'
  | 'activity'
  | 'change-set'
  | 'accept-changes';

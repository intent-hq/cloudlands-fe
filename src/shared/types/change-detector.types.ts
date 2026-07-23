/**
 * Common types for ChangeDetector implementations
 */

import type { Actor } from '$shared/types';

/** Action types for file changes */
export type FileChangeAction = 'Create' | 'Modify' | 'Delete' | 'Rename';

/**
 * Unified file change interface used across the workspace system.
 * This is the primary definition - other modules should import from here.
 */
export interface FileChange {
  path: string;
  action: FileChangeAction;
  stage?: 'staged' | 'unstaged';
  diff?: string;
  content?: string;
  oldContent?: string; // Previous content before the change
  oldContentSha?: string; // SHA hash of previous content
  newContentSha?: string; // SHA hash of new content
  oldPath?: string; // For renames
  additions: number;
  deletions: number;
  timestamp: string;
  /** Actor who made this change (agent, user, or system) */
  actor?: Actor;
}

export interface DiffChunk {
  id: string;
  workspaceId: string;
  provenance: {
    source: 'agent' | 'user' | 'git';
    agentName?: string;
    agentId?: string;
    userId?: string;
    commitSha?: string;
  };
  files: FileChange[];
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  timestamp: string;
  commitSha?: string;
  description?: string;
}

export interface ChangeDetectorOptions {
  workspaceId: string;
  worktreePath?: string;
  workspacePath?: string;
  repositoryPath?: string;
  ignorePatterns?: string[];
  isRemote?: boolean;
}

export interface ChangeDetectorStats {
  isRunning: boolean;
  lastGitPoll: string | null;
  totalChangesDetected: number;
  totalEventsEmitted: number;
  currentActor?: any;
}

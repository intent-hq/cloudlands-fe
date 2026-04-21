/**
 * Changes Redux Slice — Types
 *
 * Consolidated types from file-tracking + line-changes slices.
 * Safe to import from any process (renderer, main, shared, preload).
 * Re-exports domain types from the feature module for convenience.
 */

import type { WorkspaceGitStatus } from "$features/accept-changes/types";
import type {
  TrackedChange,
  StageTransition,
  CommitInfo,
  FileListViewMode,
  MainPanelViewType,
} from "$features/file-tracking/types";

// Re-export domain types for consumer convenience
export type { TrackedChange, StageTransition, CommitInfo, FileListViewMode, MainPanelViewType };

// ---------------------------------------------------------------------------
// Accept changes state (moved from transient-ui slice)
// ---------------------------------------------------------------------------

export type PendingCommitAction = "commit" | "add-to-pr" | "merge" | "squash-merge" | null;
export type BackgroundOperationType = "commit" | "add-to-pr" | "create-pr";
export type BackgroundOperationPhase = "generating" | "executing";

export interface BackgroundOperationState {
  type: BackgroundOperationType;
  startedAt: number;
  phase: BackgroundOperationPhase;
  label?: string;
}

export interface PendingPRContext {
  includeStagedFiles: boolean;
  includeCommitHashes: string[];
  targetBranch: string;
}

export type PendingAutoActionType = "commit" | "create-pr" | "merge" | null;

export interface PendingAutoAction {
  action: "commit" | "create-pr" | "merge";
  workspaceId: string;
  /** For PR auto-create: the target branch from the executor context */
  targetBranch?: string;
}

export interface AcceptChangesState {
  commitMessage: string;
  prTitle: string;
  prDescription: string;
  targetBranch: string;
  pendingCommitAction: PendingCommitAction;
  pendingPRContext: PendingPRContext | null;
  isAutofillAndCommitting: boolean;
  isAutofillAndCreatingPR: boolean;
  backgroundOperation: BackgroundOperationState | null;
  cachedGitStatus: WorkspaceGitStatus | null;
  cachedGitStatusTimestamp: number | null;
  commitWhenReady: boolean;
  createPRWhenReady: boolean;
  mergeWhenReady: boolean;
  pendingAutoAction: PendingAutoAction | null;
}

/**
 * Main panel view state — controls what's displayed in the changes main panel.
 */
export type MainPanelViewState = {
  type: MainPanelViewType | "diff";
  agentId?: string;
  sessionId?: string;
  turnNumber?: number;
  changeId?: string;
  change?: TrackedChange;
  commit?: { hash: string; message: string; author?: string; date?: string };
};

/**
 * Per-workspace file tracking state.
 */
export type FileTrackingWorkspaceState = {
  changes: TrackedChange[];
  transitions: StageTransition[];
  commits: CommitInfo[];
  boundarySha: string | null;
  olderCommits: CommitInfo[];
  loadingOlderCommits: boolean;
  loading: boolean;
  error: string | null;
  changesTruncated: boolean;
  totalChangesCount: number;
  hasLoadedInitialData: boolean;
  acceptChanges: AcceptChangesState;
};

// ---------------------------------------------------------------------------
// Line-change stats types (absorbed from line-changes slice)
// ---------------------------------------------------------------------------

export type LineChangeStats = {
  additions: number;
  deletions: number;
  timestamp: string;
};

export type FileLineChange = {
  path: string;
  additions: number;
  deletions: number;
  action: "create" | "modify" | "delete";
};

/**
 * Root changes state shape (consolidated file-tracking + line-changes).
 */
export type FileTrackingState = {
  byWorkspaceId: Record<string, FileTrackingWorkspaceState>;
  fileListViewMode: FileListViewMode;
  mainPanelView: MainPanelViewState | null;
  /** Agent stats keyed by agent ID (absorbed from line-changes) */
  agentStats: Record<string, LineChangeStats>;
};


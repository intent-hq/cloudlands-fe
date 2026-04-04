/**
 * File Tracking Redux Slice — Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 * Re-exports domain types from the feature module for convenience.
 */

import type {
  TrackedChange,
  StageTransition,
  CommitInfo,
  FileListViewMode,
  MainPanelViewType,
} from "$features/file-tracking/types";

// Re-export domain types for consumer convenience
export type { TrackedChange, StageTransition, CommitInfo, FileListViewMode, MainPanelViewType };

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
};

/**
 * Root file tracking state shape.
 */
export type FileTrackingState = {
  byWorkspaceId: Record<string, FileTrackingWorkspaceState>;
  fileListViewMode: FileListViewMode;
  mainPanelView: MainPanelViewState | null;
};


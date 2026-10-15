import type { NativeReviewOwner } from '$shared/types/native-review-operation';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { SagaGenerator } from 'typed-redux-saga';
import type {
  CommitHistoryPage,
  CommitHistoryPageOptions,
} from '../../../../lib/client/commit-history-types';

/**
 * Changes Redux Slice — Types
 *
 * Consolidated types from file-tracking + line-changes slices.
 * Safe to import from any process (renderer, main, shared, preload).
 * Re-exports domain types from the feature module for convenience.
 */

import type {
  TrackedChange,
  StageTransition,
  CommitInfo,
  FileListViewMode,
  MainPanelViewType,
} from '../../../../features/file-tracking/types';

// Re-export domain types for consumer convenience
export type { TrackedChange, CommitInfo };

// ---------------------------------------------------------------------------
// Accept changes state (moved from transient-ui slice)
// ---------------------------------------------------------------------------

export type PendingCommitAction = 'commit' | 'add-to-pr' | 'merge' | 'squash-merge' | null;

interface PendingPRContext {
  includeStagedFiles: boolean;
  includeCommitHashes: string[];
  targetBranch: string;
}

/** Public intent captured by the explicit sidebar action before native preparation. */
export interface NativeSidebarReviewIntent {
  readonly owner: NativeReviewOwner;
  readonly targetBranch: string;
  readonly commitMessage: string;
  readonly prTitle: string;
  readonly prBody: string;
  readonly contextKey: string;
  readonly destinationKey: string;
}

export type PendingAutoAction =
  | {
      action: 'commit' | 'create-pr' | 'merge';
      workspaceId: string;
      /** For PR auto-create: the target branch from the executor context */
      targetBranch?: string;
    }
  | {
      action: 'native-review';
      workspaceId: string;
      intent: NativeSidebarReviewIntent;
    };

export interface AcceptChangesState {
  commitMessage: string;
  prTitle: string;
  prDescription: string;
  targetBranch: string;
  pendingCommitAction: PendingCommitAction;
  pendingPRContext: PendingPRContext | null;
  isAutofillAndCommitting: boolean;
  isAutofillAndCreatingPR: boolean;
  commitWhenReady: boolean;
  createPRWhenReady: boolean;
  mergeWhenReady: boolean;
  pendingAutoAction: PendingAutoAction | null;
}

export interface ChangesCoordinationState {
  lastSyncTime: number;
  lastUpdatedAt: number;
  syncInProgress: boolean;
  syncDirty: boolean;
  syncDirtyForce: boolean;
  syncThrottleMs: number;
  loadInProgress: boolean;
  loadDirty: boolean;
  refreshInProgress: boolean;
  refreshDirty: boolean;
}

/**
 * Main panel view state — controls what's displayed in the changes main panel.
 */
export type MainPanelViewState = {
  type: MainPanelViewType | 'diff';
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
  commitEntities: Collection<CommitInfo, 'hash'>;
  currentCommitIds: string[];
  boundarySha: string | null;
  olderCommitIds: string[];
  history: CommitHistoryState;
  loading: boolean;
  error: string | null;
  changesTruncated: boolean;
  totalChangesCount: number;
  hasLoadedInitialData: boolean;
  acceptChanges: AcceptChangesState;
  coordination: ChangesCoordinationState;
};

type CommitHistoryList = 'current' | 'older';

export interface CommitHistoryListState {
  nextToken: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  requestId: string | null;
  consumedTokens: (string | null)[];
}

export interface CommitHistoryState {
  context: string | null;
  generation: string | null;
  current: CommitHistoryListState;
  older: CommitHistoryListState;
}

export interface CommitHistoryRequest {
  context: string;
  generation: string;
  requestId: string;
  list: CommitHistoryList;
  pageToken: string | null;
  reset: boolean;
}

export interface CommitHistoryWorkerDependencies {
  /** Defaults to 20; the source timeline retains its existing 50-row first page. */
  pageSize?: number;
  readPage: (
    workspaceId: string,
    options: CommitHistoryPageOptions,
    current: () => boolean,
  ) => Promise<CommitHistoryPage>;
  admittedContext: (workspaceId: string) => SagaGenerator<string | null>;
  /** Synchronous admission check for transports that can defer actual dispatch. */
  readCurrentContext?: (workspaceId: string) => string | null;
}

// ---------------------------------------------------------------------------
// Line-change stats types (absorbed from line-changes slice)
// ---------------------------------------------------------------------------

export type LineChangeStats = {
  additions: number;
  deletions: number;
  timestamp: string;
};

export type AgentLineStatsRequestState = {
  isLoading: boolean;
  error: string | null;
  lastRequestedAt: string | null;
  lastFinishedAt: string | null;
};

export type FileLineChange = {
  path: string;
  additions: number;
  deletions: number;
  action: 'create' | 'modify' | 'delete';
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
  /** Agent stats request lifecycle keyed by agent ID */
  agentLineStatsRequests: Record<string, AgentLineStatsRequestState>;
};

/**
 * Changes Redux Slice — Selectors
 *
 * Consolidated from file-tracking + line-changes selectors.
 */

import { store } from "../../store";
import { emptyAgentLineStatsRequestState, emptyWorkspaceState } from "./changes-slice";
import { ChangeStage } from "$features/file-tracking/types";
import type { StoreState } from "$store/renderer/types";
import type {
  AcceptChangesState,
  ChangesCoordinationState,
  FileTrackingWorkspaceState,
  TrackedChange,
  MainPanelViewState,
  FileListViewMode,
  CommitInfo,
  StageTransition,
  FileLineChange,
  LineChangeStats,
  AgentLineStatsRequestState,
} from "./changes-types";


// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const committedStages = new Set([
  ChangeStage.Committed,
  ChangeStage.Pushed,
  ChangeStage.PullRequest,
  ChangeStage.Merged,
  ChangeStage.Trunk,
]);

function getWs(state: StoreState, wsId: string): FileTrackingWorkspaceState {
  return state.changes.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

// ---------------------------------------------------------------------------
// Global selectors (not workspace-scoped)
// ---------------------------------------------------------------------------

export const selectCurrentWorkspaceId = store.createSelector(
  (state): string | null => state.workspace.activeWorkspaceId
);

export const selectFileListViewMode = store.createSelector(
  (state): FileListViewMode => state.changes.fileListViewMode
);

export const selectMainPanelView = store.createSelector(
  (state): MainPanelViewState | null => state.changes.mainPanelView
);

// ---------------------------------------------------------------------------
// Workspace-scoped selectors
// ---------------------------------------------------------------------------

export const selectFileTrackingLoading = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).loading
);

export const selectFileTrackingError = store.createSelector(
  (state, wsId: string): string | null => getWs(state, wsId).error
);

export const selectFileTrackingIsInitialized = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).hasLoadedInitialData
);

export const selectFileTrackingChanges = store.createSelector(
  (state, wsId: string): TrackedChange[] => getWs(state, wsId).changes
);

export const selectFileTrackingTransitions = store.createSelector(
  (state, wsId: string): StageTransition[] => getWs(state, wsId).transitions
);

export const selectFileTrackingCommits = store.createSelector(
  (state, wsId: string): CommitInfo[] => getWs(state, wsId).commits
);

export const selectFileTrackingBoundarySha = store.createSelector(
  (state, wsId: string): string | null => getWs(state, wsId).boundarySha
);

export const selectFileTrackingOlderCommits = store.createSelector(
  (state, wsId: string): CommitInfo[] => getWs(state, wsId).olderCommits
);

export const selectFileTrackingLoadingOlderCommits = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).loadingOlderCommits
);

export const selectFileTrackingChangesTruncated = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).changesTruncated
);

export const selectFileTrackingTotalChangesCount = store.createSelector(
  (state, wsId: string): number => getWs(state, wsId).totalChangesCount
);

export const selectChangesCoordinationState = store.createSelector(
  (state, wsId: string): ChangesCoordinationState => getWs(state, wsId).coordination
);

export const selectChangesLastSyncTime = store.createSelector(
  (state, wsId: string): number => getWs(state, wsId).coordination.lastSyncTime
);

export const selectChangesLastUpdatedAt = store.createSelector(
  (state, wsId: string): number => getWs(state, wsId).coordination.lastUpdatedAt
);

export const selectChangesSyncInProgress = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).coordination.syncInProgress
);

export const selectChangesSyncDirty = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).coordination.syncDirty
);

export const selectChangesSyncDirtyForce = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).coordination.syncDirtyForce
);

export const selectChangesSyncThrottleMs = store.createSelector(
  (state, wsId: string): number => getWs(state, wsId).coordination.syncThrottleMs
);

export const selectChangesLoadInProgress = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).coordination.loadInProgress
);

export const selectChangesLoadDirty = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).coordination.loadDirty
);

export const selectChangesRefreshInProgress = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).coordination.refreshInProgress
);

export const selectChangesRefreshDirty = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).coordination.refreshDirty
);

// ---------------------------------------------------------------------------
// Derived / computed selectors
// ---------------------------------------------------------------------------

export const selectStagedWorkingChanges = store.createSelector(
  (state, wsId: string): TrackedChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Staged);
  }
);

export const selectUnstagedWorkingChanges = store.createSelector(
  (state, wsId: string): TrackedChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Unstaged);
  }
);

export const selectCommittedChanges = store.createSelector(
  (state, wsId: string): TrackedChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => committedStages.has(c.stage));
  }
);

// ---------------------------------------------------------------------------
// Convenience selectors — auto-resolve currentWorkspaceId
// ---------------------------------------------------------------------------

export const selectCurrentChanges = store.createSelector(
  (state): TrackedChange[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    return getWs(state, wsId).changes;
  }
);

export const selectCurrentStagedWorkingChanges = store.createSelector(
  (state): TrackedChange[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Staged);
  }
);

export const selectCurrentUnstagedWorkingChanges = store.createSelector(
  (state): TrackedChange[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Unstaged);
  }
);

export const selectCurrentCommits = store.createSelector(
  (state): CommitInfo[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    return getWs(state, wsId).commits;
  }
);

export const selectCurrentOlderCommits = store.createSelector(
  (state): CommitInfo[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    return getWs(state, wsId).olderCommits;
  }
);

export const selectCurrentBoundarySha = store.createSelector(
  (state): string | null => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return null;
    return getWs(state, wsId).boundarySha;
  }
);

export const selectCurrentLoading = store.createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).loading;
  }
);

export const selectCurrentLoadingOlderCommits = store.createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).loadingOlderCommits;
  }
);

export const selectCurrentIsInitialized = store.createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).hasLoadedInitialData;
  }
);

export const selectCurrentChangesTruncated = store.createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).changesTruncated;
  }
);

export const selectCurrentTotalChangesCount = store.createSelector(
  (state): number => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return 0;
    return getWs(state, wsId).totalChangesCount;
  }
);

// ---------------------------------------------------------------------------
// Derived line-stats selectors (replaces lineChanges workspace-level state)
// ---------------------------------------------------------------------------

/** Derive workspace-level line stats by summing file-tracking changes[].stats */
export const selectWorkspaceLineStats = store.createSelector(
  (state, wsId: string): { additions: number; deletions: number } => {
    const ws = getWs(state, wsId);
    let additions = 0;
    let deletions = 0;
    for (const change of ws.changes) {
      additions += change.stats.additions;
      deletions += change.stats.deletions;
    }
    return { additions, deletions };
  }
);

/** Derive FileLineChange[] from file-tracking changes[] for a workspace */
export const selectWorkspaceFileChanges = store.createSelector(
  (state, wsId: string): FileLineChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.map((c) => ({
      path: c.relativePath,
      additions: c.stats.additions,
      deletions: c.stats.deletions,
      action: mapStatusToAction(c.status),
    }));
  }
);

function mapStatusToAction(status?: string): "create" | "modify" | "delete" {
  switch (status) {
    case "added": return "create";
    case "deleted": return "delete";
    case "modified":
    case "renamed":
    default:
      return "modify";
  }
}



// ---------------------------------------------------------------------------
// Sidebar-specific selectors (stable references for template props)
// ---------------------------------------------------------------------------

type SidebarCommitFile = { path: string; additions: number; deletions: number };
type SidebarCommit = {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  isPushed: boolean;
  files: SidebarCommitFile[];
};

const EMPTY_SIDEBAR_COMMITS: SidebarCommit[] = [];

/**
 * Returns the commits formatted for the sidebar component.
 * Uses the file-tracking CommitInfo type which has rich CommitFile[] data.
 */
export const selectSidebarCommits = store.createSelector<[wsId: string], SidebarCommit[]>(
  (state, wsId) => {
    const ws = getWs(state, wsId);
    const commits = ws.commits ?? [];
    if (!commits.length) return EMPTY_SIDEBAR_COMMITS;
    return commits.map((c) => ({
      hash: c.hash,
      message: c.message,
      author: c.author || "",
      date: c.date || "",
      filesChanged: c.filesChanged ?? c.files?.length ?? 0,
      isPushed: c.isPushed ?? (c.stage !== "local"),
      files: c.files?.map((f) => ({
        path: f.path,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      })) ?? [],
    }));
  }
);

// ---------------------------------------------------------------------------
// Agent stats selectors (absorbed from line-changes)
// ---------------------------------------------------------------------------

/** Select agent stats by agent ID */
export const selectAgentLineStats = store.createSelector(
  (state, agentId: string): LineChangeStats | undefined =>
    state.changes.agentStats[agentId],
);

/** Select the full agent stats record */
export const selectAllAgentStats = store.createSelector(
  (state): Record<string, LineChangeStats> => state.changes.agentStats,
);

export const selectAgentLineStatsRequest = store.createSelector(
  (state, agentId: string): AgentLineStatsRequestState =>
    state.changes.agentLineStatsRequests[agentId] ?? emptyAgentLineStatsRequestState,
);

export const selectIsAgentLineStatsRequestInFlight = store.createSelector(
  (state, agentId: string): boolean => selectAgentLineStatsRequest.select(state, agentId).isLoading,
);

export const selectAgentLineStatsRequestError = store.createSelector(
  (state, agentId: string): string | null => selectAgentLineStatsRequest.select(state, agentId).error,
);

export const selectShouldRequestAgentLineStats = store.createSelector(
  (state, agentId: string, forceRefresh = false): boolean => {
    const requestState = selectAgentLineStatsRequest.select(state, agentId);
    if (requestState.isLoading) return false;
    if (!forceRefresh && selectAgentLineStats.select(state, agentId)) return false;
    return true;
  },
);

// ---------------------------------------------------------------------------
// Accept changes selectors (moved from transient-ui slice)
// ---------------------------------------------------------------------------

export const selectAcceptChangesState = store.createSelector(
  (state, workspaceId: string): AcceptChangesState => getWs(state, workspaceId).acceptChanges,
);

export const selectSidebarCommitWhenReady = store.createSelector(
  (state, workspaceId: string): boolean => getWs(state, workspaceId).acceptChanges.commitWhenReady,
);

export const selectSidebarCreatePRWhenReady = store.createSelector(
  (state, workspaceId: string): boolean => getWs(state, workspaceId).acceptChanges.createPRWhenReady,
);

export const selectSidebarMergeWhenReady = store.createSelector(
  (state, workspaceId: string): boolean => getWs(state, workspaceId).acceptChanges.mergeWhenReady,
);

export const selectPendingAutoAction = store.createSelector(
  (state, workspaceId: string) => getWs(state, workspaceId).acceptChanges.pendingAutoAction,
);


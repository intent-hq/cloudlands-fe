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
  FileTrackingWorkspaceState,
  TrackedChange,
  MainPanelViewState,
  CommitInfo,
  StageTransition,
  FileLineChange,
  LineChangeStats,
  AgentLineStatsRequestState,
} from "./changes-types";


// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getWs(state: StoreState, wsId: string): FileTrackingWorkspaceState {
  return state.changes.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

// ---------------------------------------------------------------------------
// Global selectors (not workspace-scoped)
// ---------------------------------------------------------------------------

export const selectCurrentWorkspaceId = store.createSelector(
  (state): string | null => state.workspace.activeWorkspaceId
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

export const selectCurrentLoading = store.createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).loading;
  }
);

// ---------------------------------------------------------------------------
// Derived line-stats selectors (replaces lineChanges workspace-level state)
// ---------------------------------------------------------------------------

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

const selectAgentLineStatsRequest = store.createSelector(
  (state, agentId: string): AgentLineStatsRequestState =>
    state.changes.agentLineStatsRequests[agentId] ?? emptyAgentLineStatsRequestState,
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


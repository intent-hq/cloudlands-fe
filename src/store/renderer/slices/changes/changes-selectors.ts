/**
 * Changes Redux Slice — Selectors
 *
 * Consolidated from file-tracking + line-changes selectors.
 */

import { store } from '../../store';
import { emptyAgentLineStatsRequestState, emptyWorkspaceState } from './changes-slice';
import { ChangeStage } from '$features/file-tracking/types';
import type { AppSelector, StoreState } from '$store/renderer/types';
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
} from './changes-types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getWs(state: StoreState, wsId: string): FileTrackingWorkspaceState {
  return state.changes.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

export const selectMainPanelView: AppSelector<MainPanelViewState | null> =
  store.createSelector((state): MainPanelViewState | null => state.changes.mainPanelView);

// ---------------------------------------------------------------------------
// Workspace-scoped selectors
// ---------------------------------------------------------------------------

export const selectFileTrackingLoading: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).loading);

export const selectFileTrackingIsInitialized: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).hasLoadedInitialData);

export const selectFileTrackingChanges: AppSelector<TrackedChange[], [wsId: string]> =
  store.createSelector((state, wsId: string): TrackedChange[] => getWs(state, wsId).changes);

export const selectFileTrackingTransitions: AppSelector<StageTransition[], [wsId: string]> =
  store.createSelector((state, wsId: string): StageTransition[] => getWs(state, wsId).transitions);

export const selectFileTrackingCommits: AppSelector<CommitInfo[], [wsId: string]> =
  store.createSelector((state, wsId: string): CommitInfo[] => getWs(state, wsId).commits);

export const selectFileTrackingBoundarySha: AppSelector<string | null, [wsId: string]> =
  store.createSelector((state, wsId: string): string | null => getWs(state, wsId).boundarySha);

export const selectFileTrackingOlderCommits: AppSelector<CommitInfo[], [wsId: string]> =
  store.createSelector((state, wsId: string): CommitInfo[] => getWs(state, wsId).olderCommits);

export const selectFileTrackingLoadingOlderCommits: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).loadingOlderCommits);

export const selectFileTrackingChangesTruncated: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).changesTruncated);

export const selectFileTrackingTotalChangesCount: AppSelector<number, [wsId: string]> =
  store.createSelector((state, wsId: string): number => getWs(state, wsId).totalChangesCount);

export const selectChangesLastSyncTime: AppSelector<number, [wsId: string]> =
  store.createSelector((state, wsId: string): number => getWs(state, wsId).coordination.lastSyncTime);

export const selectChangesLastUpdatedAt: AppSelector<number, [wsId: string]> =
  store.createSelector((state, wsId: string): number => getWs(state, wsId).coordination.lastUpdatedAt);

export const selectChangesSyncInProgress: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).coordination.syncInProgress);

export const selectChangesSyncDirty: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).coordination.syncDirty);

export const selectChangesSyncDirtyForce: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).coordination.syncDirtyForce);

export const selectChangesSyncThrottleMs: AppSelector<number, [wsId: string]> =
  store.createSelector((state, wsId: string): number => getWs(state, wsId).coordination.syncThrottleMs);

export const selectChangesLoadInProgress: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).coordination.loadInProgress);

export const selectChangesLoadDirty: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).coordination.loadDirty);

export const selectChangesRefreshInProgress: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).coordination.refreshInProgress);

export const selectChangesRefreshDirty: AppSelector<boolean, [wsId: string]> =
  store.createSelector((state, wsId: string): boolean => getWs(state, wsId).coordination.refreshDirty);

// ---------------------------------------------------------------------------
// Derived / computed selectors
// ---------------------------------------------------------------------------

export const selectStagedWorkingChanges: AppSelector<TrackedChange[], [wsId: string]> =
  store.createSelector((state, wsId: string): TrackedChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Staged);
  },
);

export const selectUnstagedWorkingChanges: AppSelector<TrackedChange[], [wsId: string]> =
  store.createSelector((state, wsId: string): TrackedChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Unstaged);
  },
);

// ---------------------------------------------------------------------------
// Convenience selectors — caller supplies the current workspaceId
// ---------------------------------------------------------------------------

export const selectCurrentChanges: AppSelector<
  TrackedChange[],
  [wsId: string | null | undefined]
> = store.createSelector(
  (state, wsId: string | null | undefined): TrackedChange[] => {
    if (!wsId) return [];
    return getWs(state, wsId).changes;
  },
);

export const selectCurrentStagedWorkingChanges: AppSelector<
  TrackedChange[],
  [wsId: string | null | undefined]
> = store.createSelector(
  (state, wsId: string | null | undefined): TrackedChange[] => {
    if (!wsId) return [];
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Staged);
  },
);

export const selectCurrentUnstagedWorkingChanges: AppSelector<
  TrackedChange[],
  [wsId: string | null | undefined]
> = store.createSelector(
  (state, wsId: string | null | undefined): TrackedChange[] => {
    if (!wsId) return [];
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Unstaged);
  },
);

export const selectCurrentCommits: AppSelector<
  CommitInfo[],
  [wsId: string | null | undefined]
> = store.createSelector(
  (state, wsId: string | null | undefined): CommitInfo[] => {
    if (!wsId) return [];
    return getWs(state, wsId).commits;
  },
);

export const selectCurrentLoading: AppSelector<
  boolean,
  [wsId: string | null | undefined]
> = store.createSelector(
  (state, wsId: string | null | undefined): boolean => {
    if (!wsId) return false;
    return getWs(state, wsId).loading;
  },
);

// ---------------------------------------------------------------------------
// Derived line-stats selectors (replaces lineChanges workspace-level state)
// ---------------------------------------------------------------------------

/** Derive FileLineChange[] from file-tracking changes[] for a workspace */
export const selectWorkspaceFileChanges: AppSelector<FileLineChange[], [wsId: string]> =
  store.createSelector((state, wsId: string): FileLineChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.map((c) => ({
      path: c.relativePath,
      additions: c.stats.additions,
      deletions: c.stats.deletions,
      action: mapStatusToAction(c.status),
    }));
  },
);

function mapStatusToAction(status?: string): 'create' | 'modify' | 'delete' {
  switch (status) {
    case 'added':
      return 'create';
    case 'deleted':
      return 'delete';
    case 'modified':
    case 'renamed':
    default:
      return 'modify';
  }
}

// ---------------------------------------------------------------------------
// Agent stats selectors (absorbed from line-changes)
// ---------------------------------------------------------------------------

/** Select agent stats by agent ID */
export const selectAgentLineStats: AppSelector<LineChangeStats | undefined, [agentId: string]> =
  store.createSelector(
    (state, agentId: string): LineChangeStats | undefined => state.changes.agentStats[agentId],
  );

/** Select the full agent stats record */
export const selectAllAgentStats: AppSelector<Record<string, LineChangeStats>> =
  store.createSelector((state): Record<string, LineChangeStats> => state.changes.agentStats);

const selectAgentLineStatsRequest = store.createSelector(
  (state, agentId: string): AgentLineStatsRequestState =>
    state.changes.agentLineStatsRequests[agentId] ?? emptyAgentLineStatsRequestState,
);

export const selectShouldRequestAgentLineStats: AppSelector<
  boolean,
  [agentId: string, forceRefresh?: boolean]
> = store.createSelector(
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

export const selectAcceptChangesState: AppSelector<AcceptChangesState, [workspaceId: string]> =
  store.createSelector(
    (state, workspaceId: string): AcceptChangesState => getWs(state, workspaceId).acceptChanges,
  );

export const selectSidebarCommitWhenReady: AppSelector<boolean, [workspaceId: string]> =
  store.createSelector(
    (state, workspaceId: string): boolean => getWs(state, workspaceId).acceptChanges.commitWhenReady,
  );

export const selectSidebarCreatePRWhenReady: AppSelector<boolean, [workspaceId: string]> =
  store.createSelector(
    (state, workspaceId: string): boolean =>
      getWs(state, workspaceId).acceptChanges.createPRWhenReady,
  );

export const selectSidebarMergeWhenReady: AppSelector<boolean, [workspaceId: string]> =
  store.createSelector(
    (state, workspaceId: string): boolean => getWs(state, workspaceId).acceptChanges.mergeWhenReady,
  );

export const selectPendingAutoAction: AppSelector<
  AcceptChangesState['pendingAutoAction'],
  [workspaceId: string]
> = store.createSelector(
  (state, workspaceId: string) => getWs(state, workspaceId).acceptChanges.pendingAutoAction,
);

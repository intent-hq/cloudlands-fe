/**
 * File Tracking Redux Slice — Selectors
 */

import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceState } from "./file-tracking-slice";
import { ChangeStage } from "$features/file-tracking/types";
import type {
  FileTrackingWorkspaceState,
  TrackedChange,
  MainPanelViewState,
  FileListViewMode,
  CommitInfo,
  StageTransition,
} from "./file-tracking-types";


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

function getWs(state: any, wsId: string): FileTrackingWorkspaceState {
  return state.fileTracking.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

// ---------------------------------------------------------------------------
// Global selectors (not workspace-scoped)
// ---------------------------------------------------------------------------

export const selectCurrentWorkspaceId = createSelector(
  (state): string | null => state.workspace.activeWorkspaceId
);

export const selectFileListViewMode = createSelector(
  (state): FileListViewMode => state.fileTracking.fileListViewMode
);

export const selectMainPanelView = createSelector(
  (state): MainPanelViewState | null => state.fileTracking.mainPanelView
);

// ---------------------------------------------------------------------------
// Workspace-scoped selectors
// ---------------------------------------------------------------------------

export const selectFileTrackingLoading = createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).loading
);

export const selectFileTrackingError = createSelector(
  (state, wsId: string): string | null => getWs(state, wsId).error
);

export const selectFileTrackingIsInitialized = createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).hasLoadedInitialData
);

export const selectFileTrackingChanges = createSelector(
  (state, wsId: string): TrackedChange[] => getWs(state, wsId).changes
);

export const selectFileTrackingTransitions = createSelector(
  (state, wsId: string): StageTransition[] => getWs(state, wsId).transitions
);

export const selectFileTrackingCommits = createSelector(
  (state, wsId: string): CommitInfo[] => getWs(state, wsId).commits
);

export const selectFileTrackingBoundarySha = createSelector(
  (state, wsId: string): string | null => getWs(state, wsId).boundarySha
);

export const selectFileTrackingOlderCommits = createSelector(
  (state, wsId: string): CommitInfo[] => getWs(state, wsId).olderCommits
);

export const selectFileTrackingLoadingOlderCommits = createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).loadingOlderCommits
);

export const selectFileTrackingChangesTruncated = createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).changesTruncated
);

export const selectFileTrackingTotalChangesCount = createSelector(
  (state, wsId: string): number => getWs(state, wsId).totalChangesCount
);

// ---------------------------------------------------------------------------
// Derived / computed selectors
// ---------------------------------------------------------------------------

export const selectStagedWorkingChanges = createSelector(
  (state, wsId: string): TrackedChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Staged);
  }
);

export const selectUnstagedWorkingChanges = createSelector(
  (state, wsId: string): TrackedChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Unstaged);
  }
);

export const selectCommittedChanges = createSelector(
  (state, wsId: string): TrackedChange[] => {
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => committedStages.has(c.stage));
  }
);

// ---------------------------------------------------------------------------
// Convenience selectors — auto-resolve currentWorkspaceId
// Use these when a consumer doesn't have a workspaceId readily available.
// ---------------------------------------------------------------------------

export const selectCurrentChanges = createSelector(
  (state): TrackedChange[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    return getWs(state, wsId).changes;
  }
);



export const selectCurrentStagedWorkingChanges = createSelector(
  (state): TrackedChange[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Staged);
  }
);

export const selectCurrentUnstagedWorkingChanges = createSelector(
  (state): TrackedChange[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    const ws = getWs(state, wsId);
    return ws.changes.filter((c) => c.stage === ChangeStage.Unstaged);
  }
);

export const selectCurrentCommits = createSelector(
  (state): CommitInfo[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    return getWs(state, wsId).commits;
  }
);

export const selectCurrentOlderCommits = createSelector(
  (state): CommitInfo[] => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return [];
    return getWs(state, wsId).olderCommits;
  }
);

export const selectCurrentBoundarySha = createSelector(
  (state): string | null => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return null;
    return getWs(state, wsId).boundarySha;
  }
);

export const selectCurrentLoading = createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).loading;
  }
);

export const selectCurrentLoadingOlderCommits = createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).loadingOlderCommits;
  }
);

export const selectCurrentIsInitialized = createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).hasLoadedInitialData;
  }
);

export const selectCurrentChangesTruncated = createSelector(
  (state): boolean => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return false;
    return getWs(state, wsId).changesTruncated;
  }
);

export const selectCurrentTotalChangesCount = createSelector(
  (state): number => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return 0;
    return getWs(state, wsId).totalChangesCount;
  }
);


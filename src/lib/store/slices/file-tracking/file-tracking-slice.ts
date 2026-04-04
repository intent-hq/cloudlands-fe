/**
 * File Tracking Redux Slice — Actions & Reducer
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import type {
  FileTrackingState,
  FileTrackingWorkspaceState,
  MainPanelViewState,
  TrackedChange,
  StageTransition,
  CommitInfo,
  FileListViewMode,
} from "./file-tracking-types";

// ---------------------------------------------------------------------------
// Empty / Initial State
// ---------------------------------------------------------------------------

export const emptyWorkspaceState: FileTrackingWorkspaceState = {
  changes: [],
  transitions: [],
  commits: [],
  boundarySha: null,
  olderCommits: [],
  loadingOlderCommits: false,
  loading: false,
  error: null,
  changesTruncated: false,
  totalChangesCount: 0,
  hasLoadedInitialData: false,
};

export const initialState: FileTrackingState = {
  byWorkspaceId: {},
  fileListViewMode: "flat",
  mainPanelView: null,
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// Workspace lifecycle
export const clearWorkspace = createAction<[wsId: string]>(
  "fileTracking/clearWorkspace"
);

// Loading / error state
export const setLoading = createAction<[wsId: string, loading: boolean]>(
  "fileTracking/setLoading"
);
export const setError = createAction<[wsId: string, error: string | null]>(
  "fileTracking/setError"
);
export const setHasLoadedInitialData = createAction<[wsId: string, hasLoaded: boolean]>(
  "fileTracking/setHasLoadedInitialData"
);

// Data load results
export const setChangesData = createAction(
  "fileTracking/setChangesData",
  (wsId: string, changes: TrackedChange[], truncated: boolean, totalCount: number) => ({
    wsId,
    changes,
    truncated,
    totalCount,
  })
);
export const setTransitions = createAction<[wsId: string, transitions: StageTransition[]]>(
  "fileTracking/setTransitions"
);
export const setCommitsData = createAction(
  "fileTracking/setCommitsData",
  (wsId: string, commits: CommitInfo[], boundarySha: string | null) => ({
    wsId,
    commits,
    boundarySha,
  })
);

// Older commits
export const appendOlderCommits = createAction<[wsId: string, commits: CommitInfo[]]>(
  "fileTracking/appendOlderCommits"
);
export const clearOlderCommits = createAction<[wsId: string]>(
  "fileTracking/clearOlderCommits"
);
export const setLoadingOlderCommits = createAction<[wsId: string, loading: boolean]>(
  "fileTracking/setLoadingOlderCommits"
);

// Optimistic updates for stage/unstage/revert
export const setChanges = createAction<[wsId: string, changes: TrackedChange[]]>(
  "fileTracking/setChanges"
);
export const clearAllChanges = createAction<[wsId: string]>(
  "fileTracking/clearAllChanges"
);

// UI state
export const setMainPanelView = createAction<[view: MainPanelViewState | null]>(
  "fileTracking/setMainPanelView"
);
export const clearMainPanelView = createAction(
  "fileTracking/clearMainPanelView"
);
export const setFileListViewMode = createAction<[mode: FileListViewMode]>(
  "fileTracking/setFileListViewMode"
);

// Saga triggers (no reducer handler needed — sagas listen for these)
export const initWorkspace = createAction<[wsId: string]>(
  "fileTracking/initWorkspace"
);
// Operation request actions (sagas listen for these)
export const stageChangesRequested = createAction(
  "fileTracking/stageChangesRequested",
  (wsId: string, changeIds: string[], changesFromUI?: TrackedChange[]) => ({
    wsId,
    changeIds,
    changesFromUI,
  })
);
export const unstageChangesRequested = createAction(
  "fileTracking/unstageChangesRequested",
  (wsId: string, changeIds: string[], changesFromUI?: TrackedChange[]) => ({
    wsId,
    changeIds,
    changesFromUI,
  })
);
export const stageByPathRequested = createAction<[wsId: string, filePaths: string[]]>(
  "fileTracking/stageByPathRequested"
);
export const unstageByPathRequested = createAction<[wsId: string, filePaths: string[]]>(
  "fileTracking/unstageByPathRequested"
);
export const revertChangeRequested = createAction<[wsId: string, change: TrackedChange]>(
  "fileTracking/revertChangeRequested"
);
export const revertChangesRequested = createAction<[wsId: string, changes: TrackedChange[]]>(
  "fileTracking/revertChangesRequested"
);
export const revertByPathRequested = createAction<[wsId: string, filePaths: string[]]>(
  "fileTracking/revertByPathRequested"
);
export const refreshRequested = createAction<[wsId: string]>(
  "fileTracking/refreshRequested"
);
export const syncWithGitRequested = createAction<[wsId: string, force?: boolean]>(
  "fileTracking/syncWithGitRequested"
);
export const loadWorkspaceDataRequested = createAction<[wsId: string]>(
  "fileTracking/loadWorkspaceDataRequested"
);
export const trackChangeRequested = createAction<[wsId: string, change: Omit<TrackedChange, "id">]>(
  "fileTracking/trackChangeRequested"
);
export const clearTrackedChangesRequested = createAction<[wsId: string]>(
  "fileTracking/clearTrackedChangesRequested"
);
export const loadOlderCommitsRequested = createAction(
  "fileTracking/loadOlderCommitsRequested",
  (wsId: string, beforeSha: string, limit?: number) => ({
    wsId,
    beforeSha,
    limit,
  })
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const fileTrackingReducer = createReducer<FileTrackingState>(initialState)
  // Workspace lifecycle
  .with(clearWorkspace, (state, { payload: [wsId] }) =>
    clearWorkspaceState(state, wsId)
  )

  // Loading / error
  .with(setLoading, (state, { payload: [wsId, loading] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, loading });
  })
  .with(setError, (state, { payload: [wsId, error] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, error });
  })
  .with(setHasLoadedInitialData, (state, { payload: [wsId, hasLoaded] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, hasLoadedInitialData: hasLoaded });
  })

  // Data load results
  .with(setChangesData, (state, action) => {
    const { wsId, changes, truncated, totalCount } = action.payload;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      changes,
      changesTruncated: truncated,
      totalChangesCount: totalCount,
      error: null,
    });
  })
  .with(setTransitions, (state, { payload: [wsId, transitions] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, transitions });
  })
  .with(setCommitsData, (state, action) => {
    const { wsId, commits, boundarySha } = action.payload;
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      commits,
      boundarySha,
      olderCommits: [], // Clear older commits when main commits change
    });
  })

  // Older commits
  .with(appendOlderCommits, (state, { payload: [wsId, newCommits] }) => {
    const ws = getWorkspaceState(state, wsId);
    // Deduplicate by hash
    const existingHashes = new Set(ws.olderCommits.map((c) => c.hash));
    const unique = newCommits.filter((c) => !existingHashes.has(c.hash));
    if (unique.length === 0) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      olderCommits: [...ws.olderCommits, ...unique],
    });
  })
  .with(clearOlderCommits, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.olderCommits.length === 0) return state;
    return setWorkspaceState(state, wsId, { ...ws, olderCommits: [] });
  })
  .with(setLoadingOlderCommits, (state, { payload: [wsId, loading] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, loadingOlderCommits: loading });
  })

  // Optimistic updates
  .with(setChanges, (state, { payload: [wsId, changes] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, changes });
  })
  .with(clearAllChanges, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      changes: [],
      transitions: [],
    });
  })

  // UI state
  .with(setMainPanelView, (state, { payload: [view] }) => ({
    ...state,
    mainPanelView: view,
  }))
  .with(clearMainPanelView, (state) => ({
    ...state,
    mainPanelView: null,
  }))
  .with(setFileListViewMode, (state, { payload: [mode] }) => ({
    ...state,
    fileListViewMode: mode,
  }));


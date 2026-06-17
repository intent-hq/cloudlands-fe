/**
 * Changes Redux Slice — Actions & Reducer
 *
 * Consolidated from file-tracking + line-changes slices.
 */

import type { WorkspaceGitStatus } from "$features/accept-changes/types";
import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type {
  AcceptChangesState,
  BackgroundOperationPhase,
  BackgroundOperationType,
  FileTrackingState,
  FileTrackingWorkspaceState,
  MainPanelViewState,
  PendingAutoAction,
  PendingCommitAction,
  PendingPRContext,
  TrackedChange,
  StageTransition,
  CommitInfo,
  LineChangeStats,
  AgentLineStatsRequestState,
  ChangesCoordinationState,
} from "./changes-types";

// ---------------------------------------------------------------------------
// Empty / Initial State
// ---------------------------------------------------------------------------

export function createEmptyAcceptChangesState(): AcceptChangesState {
  return {
    commitMessage: "",
    prTitle: "",
    prDescription: "",
    targetBranch: "",
    pendingCommitAction: null,
    pendingPRContext: null,
    isAutofillAndCommitting: false,
    isAutofillAndCreatingPR: false,
    backgroundOperation: null,
    cachedGitStatus: null,
    cachedGitStatusTimestamp: null,
    commitWhenReady: false,
    createPRWhenReady: false,
    mergeWhenReady: false,
    pendingAutoAction: null,
  };
}

export function createEmptyChangesCoordinationState(): ChangesCoordinationState {
  return {
    lastSyncTime: 0,
    lastUpdatedAt: 0,
    syncInProgress: false,
    syncDirty: false,
    syncDirtyForce: false,
    syncThrottleMs: 10000,
    loadInProgress: false,
    loadDirty: false,
    refreshInProgress: false,
    refreshDirty: false,
  };
}

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
  acceptChanges: createEmptyAcceptChangesState(),
  coordination: createEmptyChangesCoordinationState(),
};

export const initialState: FileTrackingState = {
  byWorkspaceId: {},
  fileListViewMode: "flat",
  mainPanelView: null,
  agentStats: {},
  agentLineStatsRequests: {},
};

export const emptyAgentLineStatsRequestState: AgentLineStatsRequestState = {
  isLoading: false,
  error: null,
  lastRequestedAt: null,
  lastFinishedAt: null,
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

function areChangesCoordinationStatesEqual(
  left: ChangesCoordinationState,
  right: ChangesCoordinationState,
): boolean {
  return left.lastSyncTime === right.lastSyncTime
    && left.lastUpdatedAt === right.lastUpdatedAt
    && left.syncInProgress === right.syncInProgress
    && left.syncDirty === right.syncDirty
    && left.syncDirtyForce === right.syncDirtyForce
    && left.syncThrottleMs === right.syncThrottleMs
    && left.loadInProgress === right.loadInProgress
    && left.loadDirty === right.loadDirty
    && left.refreshInProgress === right.refreshInProgress
    && left.refreshDirty === right.refreshDirty;
}

function updateCoordinationState(
  state: FileTrackingState,
  wsId: string,
  update: (coordination: ChangesCoordinationState) => ChangesCoordinationState,
): FileTrackingState {
  const ws = getWorkspaceState(state, wsId);
  const coordination = update(ws.coordination);
  if (areChangesCoordinationStatesEqual(ws.coordination, coordination)) return state;
  return setWorkspaceState(state, wsId, { ...ws, coordination });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// Workspace lifecycle
export const clearWorkspace = createAction<[wsId: string]>(
  "changes/clearWorkspace"
);

// Loading / error state
export const setLoading = createAction<[wsId: string, loading: boolean]>(
  "changes/setLoading"
);
export const setError = createAction<[wsId: string, error: string | null]>(
  "changes/setError"
);
export const setHasLoadedInitialData = createAction<[wsId: string, hasLoaded: boolean]>(
  "changes/setHasLoadedInitialData"
);

// Data load results
export const setChangesData = createAction(
  "changes/setChangesData",
  (wsId: string, changes: TrackedChange[], truncated: boolean, totalCount: number) => ({
    wsId,
    changes,
    truncated,
    totalCount,
  })
);
export const setTransitions = createAction<[wsId: string, transitions: StageTransition[]]>(
  "changes/setTransitions"
);
export const setCommitsData = createAction(
  "changes/setCommitsData",
  (wsId: string, commits: CommitInfo[], boundarySha: string | null) => ({
    wsId,
    commits,
    boundarySha,
  })
);

// Older commits
export const appendOlderCommits = createAction<[wsId: string, commits: CommitInfo[]]>(
  "changes/appendOlderCommits"
);
export const clearOlderCommits = createAction<[wsId: string]>(
  "changes/clearOlderCommits"
);
export const setLoadingOlderCommits = createAction<[wsId: string, loading: boolean]>(
  "changes/setLoadingOlderCommits"
);

// Optimistic updates for stage/unstage/revert
export const setChanges = createAction<[wsId: string, changes: TrackedChange[]]>(
  "changes/setChanges"
);
export const clearAllChanges = createAction<[wsId: string]>(
  "changes/clearAllChanges"
);

// UI state
export const setMainPanelView = createAction<[view: MainPanelViewState | null]>(
  "changes/setMainPanelView"
);
export const clearMainPanelView = createAction(
  "changes/clearMainPanelView"
);
// Saga triggers (no reducer handler needed — sagas listen for these)
export const initWorkspace = createAction<[wsId: string]>(
  "changes/initWorkspace"
);
// Operation request actions (sagas listen for these)
export const stageChangesRequested = createAction(
  "changes/stageChangesRequested",
  (wsId: string, changeIds: string[], changesFromUI?: TrackedChange[]) => ({
    wsId,
    changeIds,
    changesFromUI,
  })
);
export const unstageChangesRequested = createAction(
  "changes/unstageChangesRequested",
  (wsId: string, changeIds: string[], changesFromUI?: TrackedChange[]) => ({
    wsId,
    changeIds,
    changesFromUI,
  })
);
export const stageByPathRequested = createAction<[wsId: string, filePaths: string[]]>(
  "changes/stageByPathRequested"
);
export const unstageByPathRequested = createAction<[wsId: string, filePaths: string[]]>(
  "changes/unstageByPathRequested"
);
export const revertChangeRequested = createAction<[wsId: string, change: TrackedChange]>(
  "changes/revertChangeRequested"
);
export const revertChangesRequested = createAction<[wsId: string, changes: TrackedChange[]]>(
  "changes/revertChangesRequested"
);
export const revertByPathRequested = createAction<[wsId: string, filePaths: string[]]>(
  "changes/revertByPathRequested"
);
export const refreshRequested = createAction<[wsId: string]>(
  "changes/refreshRequested"
);
export const syncWithGitRequested = createAction<[wsId: string, force?: boolean]>(
  "changes/syncWithGitRequested"
);
export const loadWorkspaceDataRequested = createAction<[wsId: string]>(
  "changes/loadWorkspaceDataRequested"
);
export const trackChangeRequested = createAction<[wsId: string, change: Omit<TrackedChange, "id">]>(
  "changes/trackChangeRequested"
);
export const clearTrackedChangesRequested = createAction<[wsId: string]>(
  "changes/clearTrackedChangesRequested"
);
export const loadOlderCommitsRequested = createAction(
  "changes/loadOlderCommitsRequested",
  (wsId: string, beforeSha: string, limit?: number) => ({
    wsId,
    beforeSha,
    limit,
  })
);

// Coordination state actions for changes operation sagas
export const changesSyncStarted = createAction<[wsId: string, lastSyncTime: number]>(
  "changes/changesSyncStarted"
);
export const changesDataUpdated = createAction<[wsId: string, lastUpdatedAt: number]>(
  "changes/changesDataUpdated"
);
export const changesSyncQueued = createAction<[wsId: string, force: boolean]>(
  "changes/changesSyncQueued"
);
export const changesSyncFinished = createAction<[wsId: string]>(
  "changes/changesSyncFinished"
);
export const changesSyncDirtyConsumed = createAction<[wsId: string]>(
  "changes/changesSyncDirtyConsumed"
);
export const changesLoadStarted = createAction<[wsId: string]>(
  "changes/changesLoadStarted"
);
export const changesLoadQueued = createAction<[wsId: string]>(
  "changes/changesLoadQueued"
);
export const changesLoadFinished = createAction<[wsId: string]>(
  "changes/changesLoadFinished"
);
export const changesLoadDirtyConsumed = createAction<[wsId: string]>(
  "changes/changesLoadDirtyConsumed"
);
export const changesRefreshStarted = createAction<[wsId: string]>(
  "changes/changesRefreshStarted"
);
export const changesRefreshQueued = createAction<[wsId: string]>(
  "changes/changesRefreshQueued"
);
export const changesRefreshFinished = createAction<[wsId: string]>(
  "changes/changesRefreshFinished"
);
export const changesRefreshDirtyConsumed = createAction<[wsId: string]>(
  "changes/changesRefreshDirtyConsumed"
);

// ---------------------------------------------------------------------------
// Agent stats actions (absorbed from line-changes slice)
// ---------------------------------------------------------------------------

/** Update agent stats (merge with existing) */
export const updateAgentStats = createAction(
  "changes/updateAgentStats",
  (agentId: string, stats: LineChangeStats) => ({ agentId, stats }),
);

/** Saga trigger: request line-change stats for a single agent */
export const requestAgentLineStats = createAction(
  "changes/requestAgentLineStats",
  (agentId: string, forceRefresh = false) => ({ agentId, forceRefresh }),
);

export const agentLineStatsRequestStarted = createAction(
  "changes/agentLineStatsRequestStarted",
  (agentId: string, requestedAt: string) => ({ agentId, requestedAt }),
);

export const agentLineStatsRequestSucceeded = createAction(
  "changes/agentLineStatsRequestSucceeded",
  (agentId: string, finishedAt: string) => ({ agentId, finishedAt }),
);

export const agentLineStatsRequestFailed = createAction(
  "changes/agentLineStatsRequestFailed",
  (agentId: string, error: string, finishedAt: string) => ({ agentId, error, finishedAt }),
);

/** Clear agent stats */
export const clearAgentStats = createAction<[agentId: string]>(
  "changes/clearAgentStats",
);

// ---------------------------------------------------------------------------
// Accept changes actions (moved from transient-ui slice)
// ---------------------------------------------------------------------------

export const setCommitMessage = createAction<[workspaceId: string, message: string]>(
  "changes/setCommitMessage"
);
export const setPRTitle = createAction<[workspaceId: string, title: string]>(
  "changes/setPRTitle"
);
export const setPRDescription = createAction<[workspaceId: string, description: string]>(
  "changes/setPRDescription"
);
export const setTargetBranch = createAction<[workspaceId: string, branch: string]>(
  "changes/setTargetBranch"
);
export const setPendingCommitAction = createAction<[
  workspaceId: string,
  action: PendingCommitAction,
]>("changes/setPendingCommitAction");
export const setPendingPRContext = createAction<[
  workspaceId: string,
  context: PendingPRContext | null,
]>("changes/setPendingPRContext");
export const setIsAutofillAndCommitting = createAction<[workspaceId: string, value: boolean]>(
  "changes/setIsAutofillAndCommitting"
);
export const setIsAutofillAndCreatingPR = createAction<[workspaceId: string, value: boolean]>(
  "changes/setIsAutofillAndCreatingPR"
);
export const startBackgroundOperation = createAction<[
  workspaceId: string,
  type: BackgroundOperationType,
  startedAt: number,
  label?: string,
]>("changes/startBackgroundOperation");
export const updateBackgroundOperationPhase = createAction<[
  workspaceId: string,
  phase: BackgroundOperationPhase,
]>("changes/updateBackgroundOperationPhase");
export const clearBackgroundOperation = createAction<[workspaceId: string]>(
  "changes/clearBackgroundOperation"
);
export const clearAcceptChangesForm = createAction<[workspaceId: string]>(
  "changes/clearAcceptChangesForm"
);
export const resetAcceptChangesOperations = createAction<[workspaceId: string]>(
  "changes/resetAcceptChangesOperations"
);
export const setCachedGitStatus = createAction<[
  workspaceId: string,
  gitStatus: WorkspaceGitStatus | null,
  cachedGitStatusTimestamp: number | null,
]>("changes/setCachedGitStatus");

/** Saga trigger: fetch AcceptChangesClient.getStatus and update post-merge state */
export const refreshAcceptChangesStatus = createAction<[workspaceId: string]>(
  "changes/refreshAcceptChangesStatus"
);

// ---------------------------------------------------------------------------
// Sidebar auto-action actions (moved from transient-ui slice)
// ---------------------------------------------------------------------------

export const setSidebarCommitWhenReady = createAction<[workspaceId: string, value: boolean]>(
  "changes/setSidebarCommitWhenReady"
);
export const setSidebarCreatePRWhenReady = createAction<[workspaceId: string, value: boolean]>(
  "changes/setSidebarCreatePRWhenReady"
);
export const setSidebarMergeWhenReady = createAction<[workspaceId: string, value: boolean]>(
  "changes/setSidebarMergeWhenReady"
);
export const setPendingAutoAction = createAction<[
  workspaceId: string,
  pendingAutoAction: PendingAutoAction | null,
]>("changes/setPendingAutoAction");

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const fileTrackingReducer = createReducer<FileTrackingState>(initialState)
  // Workspace lifecycle
  .with(clearWorkspace, (state, { payload: [wsId] }) =>
    clearWorkspaceState(state, wsId)
  )
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId))

  // Changes operation coordination state
  .with(changesSyncStarted, (state, { payload: [wsId, lastSyncTime] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      lastSyncTime,
      syncInProgress: true,
    }))
  )
  .with(changesDataUpdated, (state, { payload: [wsId, lastUpdatedAt] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      lastUpdatedAt,
    }))
  )
  .with(changesSyncQueued, (state, { payload: [wsId, force] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      syncDirty: true,
      syncDirtyForce: coordination.syncDirtyForce || force,
    }))
  )
  .with(changesSyncFinished, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      syncInProgress: false,
    }))
  )
  .with(changesSyncDirtyConsumed, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      syncDirty: false,
      syncDirtyForce: false,
    }))
  )
  .with(changesLoadStarted, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      loadInProgress: true,
    }))
  )
  .with(changesLoadQueued, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      loadDirty: true,
    }))
  )
  .with(changesLoadFinished, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      loadInProgress: false,
    }))
  )
  .with(changesLoadDirtyConsumed, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      loadDirty: false,
    }))
  )
  .with(changesRefreshStarted, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      refreshInProgress: true,
    }))
  )
  .with(changesRefreshQueued, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      refreshDirty: true,
    }))
  )
  .with(changesRefreshFinished, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      refreshInProgress: false,
    }))
  )
  .with(changesRefreshDirtyConsumed, (state, { payload: [wsId] }) =>
    updateCoordinationState(state, wsId, (coordination) => ({
      ...coordination,
      refreshDirty: false,
    }))
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

  // Agent stats (absorbed from line-changes)
  .with(updateAgentStats, (state, { payload }) => ({
    ...state,
    agentStats: {
      ...state.agentStats,
      [payload.agentId]: payload.stats,
    },
  }))
  .with(clearAgentStats, (state, { payload: [agentId] }) => {
    if (!state.agentStats[agentId] && !state.agentLineStatsRequests[agentId]) return state;
    const { [agentId]: _as, ...remainingAgentStats } = state.agentStats;
    const { [agentId]: _request, ...remainingRequests } = state.agentLineStatsRequests;
    return {
      ...state,
      agentStats: remainingAgentStats,
      agentLineStatsRequests: remainingRequests,
    };
  })
  .with(agentLineStatsRequestStarted, (state, { payload }) => ({
    ...state,
    agentLineStatsRequests: {
      ...state.agentLineStatsRequests,
      [payload.agentId]: {
        isLoading: true,
        error: null,
        lastRequestedAt: payload.requestedAt,
        lastFinishedAt: state.agentLineStatsRequests[payload.agentId]?.lastFinishedAt ?? null,
      },
    },
  }))
  .with(agentLineStatsRequestSucceeded, (state, { payload }) => ({
    ...state,
    agentLineStatsRequests: {
      ...state.agentLineStatsRequests,
      [payload.agentId]: {
        ...(state.agentLineStatsRequests[payload.agentId] ?? emptyAgentLineStatsRequestState),
        isLoading: false,
        error: null,
        lastFinishedAt: payload.finishedAt,
      },
    },
  }))
  .with(agentLineStatsRequestFailed, (state, { payload }) => ({
    ...state,
    agentLineStatsRequests: {
      ...state.agentLineStatsRequests,
      [payload.agentId]: {
        ...(state.agentLineStatsRequests[payload.agentId] ?? emptyAgentLineStatsRequestState),
        isLoading: false,
        error: payload.error,
        lastFinishedAt: payload.finishedAt,
      },
    },
  }))

  // Accept changes state (moved from transient-ui slice)
  .with(setCommitMessage, (state, { payload: [wsId, message] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, commitMessage: message },
    });
  })
  .with(setPRTitle, (state, { payload: [wsId, title] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, prTitle: title },
    });
  })
  .with(setPRDescription, (state, { payload: [wsId, description] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, prDescription: description },
    });
  })
  .with(setTargetBranch, (state, { payload: [wsId, branch] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, targetBranch: branch },
    });
  })
  .with(setPendingCommitAction, (state, { payload: [wsId, action] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, pendingCommitAction: action },
    });
  })
  .with(setPendingPRContext, (state, { payload: [wsId, context] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, pendingPRContext: context },
    });
  })
  .with(setIsAutofillAndCommitting, (state, { payload: [wsId, value] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, isAutofillAndCommitting: value },
    });
  })
  .with(setIsAutofillAndCreatingPR, (state, { payload: [wsId, value] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, isAutofillAndCreatingPR: value },
    });
  })
  .with(startBackgroundOperation, (state, { payload: [wsId, type, startedAt, label] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: {
        ...ws.acceptChanges,
        backgroundOperation: { type, startedAt, phase: "generating", label },
      },
    });
  })
  .with(updateBackgroundOperationPhase, (state, { payload: [wsId, phase] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (!ws.acceptChanges.backgroundOperation) {
      return state;
    }
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: {
        ...ws.acceptChanges,
        backgroundOperation: { ...ws.acceptChanges.backgroundOperation, phase },
      },
    });
  })
  .with(clearBackgroundOperation, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, backgroundOperation: null },
    });
  })
  .with(clearAcceptChangesForm, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: {
        ...ws.acceptChanges,
        commitMessage: "",
        prTitle: "",
        prDescription: "",
      },
    });
  })
  .with(resetAcceptChangesOperations, (state, { payload: [wsId] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: {
        ...ws.acceptChanges,
        pendingCommitAction: null,
        pendingPRContext: null,
        isAutofillAndCommitting: false,
        isAutofillAndCreatingPR: false,
        backgroundOperation: null,
      },
    });
  })
  .with(setCachedGitStatus, (state, { payload: [wsId, gitStatus, cachedGitStatusTimestamp] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: {
        ...ws.acceptChanges,
        cachedGitStatus: gitStatus,
        cachedGitStatusTimestamp: gitStatus ? cachedGitStatusTimestamp : null,
      },
    });
  })
  // Sidebar auto-action state (moved from transient-ui slice)
  .with(setSidebarCommitWhenReady, (state, { payload: [wsId, value] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, commitWhenReady: value },
    });
  })
  .with(setSidebarCreatePRWhenReady, (state, { payload: [wsId, value] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, createPRWhenReady: value },
    });
  })
  .with(setSidebarMergeWhenReady, (state, { payload: [wsId, value] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, mergeWhenReady: value },
    });
  })
  .with(setPendingAutoAction, (state, { payload: [wsId, pendingAutoAction] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      acceptChanges: { ...ws.acceptChanges, pendingAutoAction },
    });
  });


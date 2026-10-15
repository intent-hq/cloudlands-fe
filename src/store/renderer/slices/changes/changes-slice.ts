import {
  createCollection,
  addItems,
  getItems,
} from '@themislib/themis/utils/collections/collection-utils';
import type { CommitHistoryPage } from '../../../../lib/client/commit-history-types';
/**
 * Changes Redux Slice — Actions & Reducer
 *
 * Consolidated from file-tracking + line-changes slices.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  AcceptChangesState,
  FileTrackingState,
  FileTrackingWorkspaceState,
  MainPanelViewState,
  PendingAutoAction,
  PendingCommitAction,
  TrackedChange,
  CommitInfo,
  LineChangeStats,
  AgentLineStatsRequestState,
  ChangesCoordinationState,
  CommitHistoryState,
  CommitHistoryListState,
  CommitHistoryRequest,
} from './changes-types';

// ---------------------------------------------------------------------------
// Empty / Initial State
// ---------------------------------------------------------------------------

function createEmptyAcceptChangesState(): AcceptChangesState {
  return {
    commitMessage: '',
    prTitle: '',
    prDescription: '',
    targetBranch: '',
    pendingCommitAction: null,
    pendingPRContext: null,
    isAutofillAndCommitting: false,
    isAutofillAndCreatingPR: false,
    commitWhenReady: false,
    createPRWhenReady: false,
    mergeWhenReady: false,
    pendingAutoAction: null,
  };
}

function createEmptyChangesCoordinationState(): ChangesCoordinationState {
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

const emptyCommitHistoryList: CommitHistoryListState = {
  nextToken: null,
  loaded: false,
  loading: false,
  error: null,
  requestId: null,
  consumedTokens: [],
};

const emptyCommitHistory: CommitHistoryState = {
  context: null,
  generation: null,
  current: emptyCommitHistoryList,
  older: emptyCommitHistoryList,
};

export const emptyWorkspaceState: FileTrackingWorkspaceState = {
  changes: [],
  transitions: [],
  commitEntities: createCollection<CommitInfo, 'hash'>('hash'),
  currentCommitIds: [],
  boundarySha: null,
  olderCommitIds: [],
  history: emptyCommitHistory,
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
  fileListViewMode: 'flat',
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

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// Workspace lifecycle
export const clearWorkspace = createAction<[wsId: string]>('changes/clearWorkspace');

// Loading / error state
export const setLoading = createAction<[wsId: string, loading: boolean]>('changes/setLoading');
export const setHasLoadedInitialData = createAction<[wsId: string, hasLoaded: boolean]>(
  'changes/setHasLoadedInitialData',
);

// Data load results
export const setChangesData = createAction(
  'changes/setChangesData',
  (wsId: string, changes: TrackedChange[], truncated: boolean, totalCount: number) => ({
    wsId,
    changes,
    truncated,
    totalCount,
  }),
);
export const setCommitsData = createAction(
  'changes/setCommitsData',
  (wsId: string, commits: CommitInfo[], boundarySha: string | null) => ({
    wsId,
    commits,
    boundarySha,
  }),
);

export const loadMoreCommitsRequested = createAction<[wsId: string]>(
  'changes/loadMoreCommitsRequested',
);
export const commitHistoryStarted = createAction<[wsId: string, request: CommitHistoryRequest]>(
  'changes/commitHistoryStarted',
);
export const commitHistorySucceeded = createAction<
  [wsId: string, request: CommitHistoryRequest, page: CommitHistoryPage]
>('changes/commitHistorySucceeded');
export const commitHistoryFailed = createAction<
  [wsId: string, request: CommitHistoryRequest, error: string | null]
>('changes/commitHistoryFailed');

// Older commits
export const appendOlderCommits = createAction<[wsId: string, commits: CommitInfo[]]>(
  'changes/appendOlderCommits',
);
export const clearOlderCommits = createAction<[wsId: string]>('changes/clearOlderCommits');
export const setLoadingOlderCommits = createAction<[wsId: string, loading: boolean]>(
  'changes/setLoadingOlderCommits',
);

// Optimistic updates for stage/unstage/revert
export const setChanges =
  createAction<[wsId: string, changes: TrackedChange[]]>('changes/setChanges');

// UI state
export const setMainPanelView = createAction<[view: MainPanelViewState | null]>(
  'changes/setMainPanelView',
);
export const clearMainPanelView = createAction('changes/clearMainPanelView');
export const refreshRequested = createAction<[wsId: string, forceSync?: boolean]>(
  'changes/refreshRequested',
);
export const loadWorkspaceDataRequested = createAction<[wsId: string]>(
  'changes/loadWorkspaceDataRequested',
);
export const loadOlderCommitsRequested = createAction(
  'changes/loadOlderCommitsRequested',
  (wsId: string, beforeSha: string, limit?: number) => ({
    wsId,
    beforeSha,
    limit,
  }),
);

// ---------------------------------------------------------------------------
// Agent stats actions (absorbed from line-changes slice)
// ---------------------------------------------------------------------------

/** Update agent stats (merge with existing) */
export const updateAgentStats = createAction(
  'changes/updateAgentStats',
  (agentId: string, stats: LineChangeStats) => ({ agentId, stats }),
);

/** Saga trigger: request line-change stats for a single agent */
export const requestAgentLineStats = createAction(
  'changes/requestAgentLineStats',
  (agentId: string, forceRefresh = false) => ({ agentId, forceRefresh }),
);

export const agentLineStatsRequestStarted = createAction(
  'changes/agentLineStatsRequestStarted',
  (agentId: string, requestedAt: string) => ({ agentId, requestedAt }),
);

export const agentLineStatsRequestSucceeded = createAction(
  'changes/agentLineStatsRequestSucceeded',
  (agentId: string, finishedAt: string) => ({ agentId, finishedAt }),
);

export const agentLineStatsRequestFailed = createAction(
  'changes/agentLineStatsRequestFailed',
  (agentId: string, error: string, finishedAt: string) => ({ agentId, error, finishedAt }),
);

// ---------------------------------------------------------------------------
// Accept changes actions (moved from transient-ui slice)
// ---------------------------------------------------------------------------

export const setCommitMessage = createAction<[workspaceId: string, message: string]>(
  'changes/setCommitMessage',
);
export const setPRContent =
  createAction<[workspaceId: string, title: string, description: string]>('changes/setPRContent');
export const setTargetBranch =
  createAction<[workspaceId: string, branch: string]>('changes/setTargetBranch');
export const setPendingCommitAction = createAction<
  [workspaceId: string, action: PendingCommitAction]
>('changes/setPendingCommitAction');
export const setIsAutofillAndCommitting = createAction<[workspaceId: string, value: boolean]>(
  'changes/setIsAutofillAndCommitting',
);
export const setIsAutofillAndCreatingPR = createAction<[workspaceId: string, value: boolean]>(
  'changes/setIsAutofillAndCreatingPR',
);

/** Saga trigger: fetch AcceptChangesClient.getStatus and update post-merge state */
export const refreshAcceptChangesStatus = createAction<[workspaceId: string]>(
  'changes/refreshAcceptChangesStatus',
);

// ---------------------------------------------------------------------------
// Sidebar auto-action actions (moved from transient-ui slice)
// ---------------------------------------------------------------------------

export const setSidebarCommitWhenReady = createAction<[workspaceId: string, value: boolean]>(
  'changes/setSidebarCommitWhenReady',
);
export const setSidebarCreatePRWhenReady = createAction<[workspaceId: string, value: boolean]>(
  'changes/setSidebarCreatePRWhenReady',
);
export const setSidebarMergeWhenReady = createAction<[workspaceId: string, value: boolean]>(
  'changes/setSidebarMergeWhenReady',
);
export const setPendingAutoAction = createAction<
  [workspaceId: string, pendingAutoAction: PendingAutoAction | null]
>('changes/setPendingAutoAction');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const fileTrackingReducer = createReducer<FileTrackingState>(initialState);
fileTrackingReducer.with(setPRContent, (state, { payload: [wsId, prTitle, prDescription] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.acceptChanges.prTitle === prTitle && ws.acceptChanges.prDescription === prDescription)
    return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, prTitle, prDescription },
  });
});
// Workspace lifecycle
fileTrackingReducer.with(clearWorkspace, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
fileTrackingReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);

// Loading / error
fileTrackingReducer.with(setLoading, (state, { payload: [wsId, loading] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, loading });
});
fileTrackingReducer.with(setHasLoadedInitialData, (state, { payload: [wsId, hasLoaded] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, hasLoadedInitialData: hasLoaded });
});

// Data load results
fileTrackingReducer.with(setChangesData, (state, action) => {
  const { wsId, changes, truncated, totalCount } = action.payload;
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    changes,
    changesTruncated: truncated,
    totalChangesCount: totalCount,
    error: null,
  });
});
fileTrackingReducer.with(setCommitsData, (state, action) => {
  const { wsId, commits, boundarySha } = action.payload;
  const ws = getWorkspaceState(state, wsId);
  const commitEntities = createCollection('hash', commits);
  return setWorkspaceState(state, wsId, {
    ...ws,
    commitEntities,
    currentCommitIds: commitEntities.ids,
    boundarySha,
    olderCommitIds: [],
    history: emptyCommitHistory,
  });
});

// Legacy setters remain for source fixtures and source-only callers. Paged reads
// use correlated outcomes below; remove these setters with those callers.
fileTrackingReducer.with(appendOlderCommits, (state, { payload: [wsId, newCommits] }) => {
  const ws = getWorkspaceState(state, wsId);
  const commitEntities = addItems(ws.commitEntities, newCommits);
  if (commitEntities === ws.commitEntities) return state;
  const current = new Set(ws.currentCommitIds);
  return setWorkspaceState(state, wsId, {
    ...ws,
    commitEntities,
    olderCommitIds: commitEntities.ids.filter((hash) => !current.has(hash)),
  });
});
fileTrackingReducer.with(clearOlderCommits, (state, { payload: [wsId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.olderCommitIds.length === 0 && ws.history.older === emptyCommitHistoryList) return state;
  const current = new Set(ws.currentCommitIds);
  return setWorkspaceState(state, wsId, {
    ...ws,
    commitEntities: createCollection(
      'hash',
      getItems(ws.commitEntities).filter((commit) => current.has(commit.hash)),
    ),
    olderCommitIds: [],
    history: { ...ws.history, older: emptyCommitHistoryList },
  });
});
fileTrackingReducer.with(setLoadingOlderCommits, (state, { payload: [wsId, loading] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.history.older.loading === loading) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    history: { ...ws.history, older: { ...ws.history.older, loading } },
  });
});

fileTrackingReducer.with(commitHistoryStarted, (state, { payload: [wsId, request] }) => {
  const ws = getWorkspaceState(state, wsId);
  const { list, context, generation, requestId, reset } = request;
  if (
    !reset &&
    (ws.history.context !== context ||
      ws.history.generation !== generation ||
      ws.history[list].loading)
  )
    return state;
  const changedContext = ws.history.context !== context;
  const history = reset
    ? { context, generation, current: emptyCommitHistoryList, older: emptyCommitHistoryList }
    : ws.history;
  return setWorkspaceState(state, wsId, {
    ...ws,
    ...(changedContext
      ? {
          commitEntities: createCollection<CommitInfo, 'hash'>('hash'),
          currentCommitIds: [],
          olderCommitIds: [],
          boundarySha: null,
        }
      : {}),
    history: {
      ...history,
      [list]: { ...history[list], loading: true, error: null, requestId },
    },
  });
});
fileTrackingReducer.with(commitHistorySucceeded, (state, { payload: [wsId, request, page] }) => {
  const ws = state.byWorkspaceId[wsId];
  if (
    !ws ||
    ws.history.context !== request.context ||
    ws.history.generation !== request.generation ||
    ws.history[request.list].requestId !== request.requestId
  )
    return state;
  const previous = ws.history[request.list];
  if (previous.consumedTokens.includes(request.pageToken)) return state;
  const existing = request.reset ? createCollection<CommitInfo, 'hash'>('hash') : ws.commitEntities;
  const commitEntities = addItems(existing, page.commits);
  const incoming = page.commits.map((commit) => commit.hash);
  const currentCommitIds =
    request.list === 'current'
      ? [...new Set([...(request.reset ? [] : ws.currentCommitIds), ...incoming])]
      : ws.currentCommitIds;
  const current = new Set(currentCommitIds);
  const olderCommitIds = request.reset
    ? []
    : [...new Set([...ws.olderCommitIds, ...(request.list === 'older' ? incoming : [])])].filter(
        (hash) => !current.has(hash),
      );
  return setWorkspaceState(state, wsId, {
    ...ws,
    commitEntities,
    currentCommitIds,
    olderCommitIds,
    boundarySha: page.boundarySha,
    history: {
      ...ws.history,
      [request.list]: {
        nextToken: page.nextToken,
        loaded: true,
        loading: false,
        error: null,
        requestId: null,
        consumedTokens: [...previous.consumedTokens, request.pageToken],
      },
    },
  });
});
fileTrackingReducer.with(commitHistoryFailed, (state, { payload: [wsId, request, error] }) => {
  const ws = state.byWorkspaceId[wsId];
  if (
    !ws ||
    ws.history.context !== request.context ||
    ws.history.generation !== request.generation ||
    ws.history[request.list].requestId !== request.requestId
  )
    return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    history: {
      ...ws.history,
      [request.list]: { ...ws.history[request.list], loading: false, requestId: null, error },
    },
  });
});

// Optimistic updates
fileTrackingReducer.with(setChanges, (state, { payload: [wsId, changes] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, changes });
});

// UI state
fileTrackingReducer.with(setMainPanelView, (state, { payload: [view] }) => ({
  ...state,
  mainPanelView: view,
}));
fileTrackingReducer.with(clearMainPanelView, (state) => ({
  ...state,
  mainPanelView: null,
}));

// Agent stats (absorbed from line-changes)
fileTrackingReducer.with(updateAgentStats, (state, { payload }) => ({
  ...state,
  agentStats: {
    ...state.agentStats,
    [payload.agentId]: payload.stats,
  },
}));
fileTrackingReducer.with(agentLineStatsRequestStarted, (state, { payload }) => ({
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
}));
fileTrackingReducer.with(agentLineStatsRequestSucceeded, (state, { payload }) => ({
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
}));
fileTrackingReducer.with(agentLineStatsRequestFailed, (state, { payload }) => ({
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
}));

// Accept changes state (moved from transient-ui slice)
fileTrackingReducer.with(setCommitMessage, (state, { payload: [wsId, message] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, commitMessage: message },
  });
});
fileTrackingReducer.with(setTargetBranch, (state, { payload: [wsId, branch] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, targetBranch: branch },
  });
});
fileTrackingReducer.with(setPendingCommitAction, (state, { payload: [wsId, action] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, pendingCommitAction: action },
  });
});
fileTrackingReducer.with(setIsAutofillAndCommitting, (state, { payload: [wsId, value] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, isAutofillAndCommitting: value },
  });
});
fileTrackingReducer.with(setIsAutofillAndCreatingPR, (state, { payload: [wsId, value] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, isAutofillAndCreatingPR: value },
  });
});
// Sidebar auto-action state (moved from transient-ui slice)
fileTrackingReducer.with(setSidebarCommitWhenReady, (state, { payload: [wsId, value] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, commitWhenReady: value },
  });
});
fileTrackingReducer.with(setSidebarCreatePRWhenReady, (state, { payload: [wsId, value] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, createPRWhenReady: value },
  });
});
fileTrackingReducer.with(setSidebarMergeWhenReady, (state, { payload: [wsId, value] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, mergeWhenReady: value },
  });
});
fileTrackingReducer.with(setPendingAutoAction, (state, { payload: [wsId, pendingAutoAction] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    acceptChanges: { ...ws.acceptChanges, pendingAutoAction },
  });
});

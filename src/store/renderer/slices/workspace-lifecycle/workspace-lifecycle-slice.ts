import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  WorkspaceLifecycleState,
  WorkspaceLoadError,
  WorkspaceLoadState,
  WorkspaceSessionPhase,
} from './workspace-lifecycle-types';

export type WorkspaceHydrationBranch =
  | 'tasks'
  | 'events'
  | 'scripts'
  | 'skills'
  | 'prStatus'
  | 'changes'
  | 'agents'
  | 'terminals'
  | 'fileExplorer'
  | 'context'
  | 'taskAgentLinks'
  | 'notes';

export const initialState: WorkspaceLifecycleState = {
  sessionPhaseByWorkspaceId: {},
  loadByWorkspaceId: {},
};

export const workspaceLoadRequested = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceLoadRequested',
);
export const workspaceLoadStarted = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceLoadStarted',
);
export const workspaceLoadCachedReady = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceLoadCachedReady',
);
export const workspaceLoadOptimisticReady = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceLoadOptimisticReady',
);
export const workspaceLoadSucceeded = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceLoadSucceeded',
);
export const workspaceLoadCancelled = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceLoadCancelled',
);
export const workspaceLoadFailed = createAction<[wsId: string, error: WorkspaceLoadError]>(
  'workspace-lifecycle/workspaceLoadFailed',
);

export const workspaceHydrationRequested = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceHydrationRequested',
);
export const workspaceMounted = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceMounted',
);
export const workspaceUnmounted = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceUnmounted',
);
export const workspaceOpenSucceeded = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceOpenSucceeded',
);
export const workspaceOpenFailed = createAction<[wsId: string]>(
  'workspace-lifecycle/workspaceOpenFailed',
);
/**
 * The workspace was permanently deleted upstream (daemon `workspace:deleted`).
 * Unlike `workspaceUnmounted` (session-end cleanup), this purges every trace of
 * the workspace from Redux so a recreated same-slug workspace does not surface
 * ghost agents. `agentIds` is the resolved list of agent IDs known to belong to
 * the deleted workspace at dispatch time — passed in the payload so slices
 * keyed by agentId (chat-state) can purge without cross-slice reads.
 */
export const workspaceDeleted = createAction<[wsId: string, agentIds: string[]]>(
  'workspace-lifecycle/workspaceDeleted',
);
/**
 * The backend transport reconnected (daemon restart or connection recovery).
 * Warm session phases describe sessions opened against the previous daemon
 * process, so every phase is cleared: the next visit of any workspace takes
 * the cold path (hydration + `workspace.open`) instead of the warm skip
 * (monorepo#3788). Load state is kept so mounted workspaces do not flash a
 * loading UI on reconnect.
 */
export const backendReconnected = createAction('workspace-lifecycle/backendReconnected');

export const workspaceHydrationBranchRequested = createAction<
  [workspaceId: string, branch: WorkspaceHydrationBranch, generation: number, force: boolean]
>('workspaceLifecycle/hydrationBranchRequested');

// Match cross-slice invalidation actions by type without importing workspace-slice,
// which already imports workspaceDeleted and would create a runtime cycle.
const workspaceEntityRemoved = createAction<[wsId: string]>('workspace/removeWorkspaceEntity');
const workspaceStateReset = createAction('workspace/resetWorkspaceState');

function setSessionPhase(
  state: WorkspaceLifecycleState,
  wsId: string,
  phase: WorkspaceSessionPhase,
): WorkspaceLifecycleState {
  if (state.sessionPhaseByWorkspaceId[wsId] === phase) return state;
  return {
    ...state,
    sessionPhaseByWorkspaceId: { ...state.sessionPhaseByWorkspaceId, [wsId]: phase },
  };
}

function clearSession(state: WorkspaceLifecycleState, wsId: string): WorkspaceLifecycleState {
  if (!(wsId in state.sessionPhaseByWorkspaceId)) return state;
  const { [wsId]: _removed, ...sessionPhaseByWorkspaceId } = state.sessionPhaseByWorkspaceId;
  return { ...state, sessionPhaseByWorkspaceId };
}

function setLoadState(
  state: WorkspaceLifecycleState,
  wsId: string,
  loadState: WorkspaceLoadState,
): WorkspaceLifecycleState {
  const current = state.loadByWorkspaceId[wsId];
  if (current?.status === loadState.status && current.error === loadState.error) return state;
  return {
    ...state,
    loadByWorkspaceId: { ...state.loadByWorkspaceId, [wsId]: loadState },
  };
}

function clearLoadState(state: WorkspaceLifecycleState, wsId: string): WorkspaceLifecycleState {
  if (!(wsId in state.loadByWorkspaceId)) return state;
  const { [wsId]: _removed, ...loadByWorkspaceId } = state.loadByWorkspaceId;
  return { ...state, loadByWorkspaceId };
}

export const workspaceLifecycleReducer = createReducer<WorkspaceLifecycleState>(initialState);

workspaceLifecycleReducer.with(workspaceLoadStarted, (state, { payload: [wsId] }) =>
  setLoadState(state, wsId, { status: 'loading', error: null }),
);
workspaceLifecycleReducer.with(workspaceLoadCachedReady, (state, { payload: [wsId] }) =>
  setLoadState(state, wsId, { status: 'cached-ready', error: null }),
);
workspaceLifecycleReducer.with(workspaceLoadOptimisticReady, (state, { payload: [wsId] }) =>
  setLoadState(state, wsId, { status: 'optimistic', error: null }),
);
workspaceLifecycleReducer.with(workspaceLoadSucceeded, (state, { payload: [wsId] }) =>
  setLoadState(state, wsId, { status: 'ready', error: null }),
);
workspaceLifecycleReducer.with(workspaceLoadFailed, (state, { payload: [wsId, error] }) =>
  setLoadState(state, wsId, {
    status: error.kind === 'not_found' ? 'not-found' : 'error',
    error,
  }),
);
workspaceLifecycleReducer.with(workspaceLoadCancelled, (state, { payload: [wsId] }) =>
  clearLoadState(state, wsId),
);

workspaceLifecycleReducer.with(workspaceMounted, (state, { payload: [wsId] }) => {
  const current = state.sessionPhaseByWorkspaceId[wsId];
  return setSessionPhase(state, wsId, current === 'opened' ? 'live' : (current ?? 'hydrated'));
});
workspaceLifecycleReducer.with(workspaceOpenSucceeded, (state, { payload: [wsId] }) => {
  const current = state.sessionPhaseByWorkspaceId[wsId];
  return setSessionPhase(state, wsId, current === 'hydrated' ? 'live' : (current ?? 'opened'));
});
workspaceLifecycleReducer.with(workspaceOpenFailed, (state, { payload: [wsId] }) =>
  clearSession(state, wsId),
);
workspaceLifecycleReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearLoadState(clearSession(state, wsId), wsId),
);
workspaceLifecycleReducer.with(workspaceDeleted, (state, { payload: [wsId] }) =>
  clearLoadState(clearSession(state, wsId), wsId),
);
workspaceLifecycleReducer.with(workspaceEntityRemoved, (state, { payload: [wsId] }) =>
  clearLoadState(clearSession(state, wsId), wsId),
);
workspaceLifecycleReducer.with(backendReconnected, (state) => {
  if (Object.keys(state.sessionPhaseByWorkspaceId).length === 0) return state;
  return { ...state, sessionPhaseByWorkspaceId: {} };
});
workspaceLifecycleReducer.with(workspaceStateReset, () => initialState);

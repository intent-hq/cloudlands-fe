import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { WorkspaceLifecycleState, WorkspaceSessionPhase } from './workspace-lifecycle-types';

export const initialState: WorkspaceLifecycleState = {
  sessionPhaseByWorkspaceId: {},
};

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

export const workspaceLifecycleReducer = createReducer<WorkspaceLifecycleState>(initialState);

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
  clearSession(state, wsId),
);
workspaceLifecycleReducer.with(workspaceDeleted, (state, { payload: [wsId] }) =>
  clearSession(state, wsId),
);
workspaceLifecycleReducer.with(workspaceEntityRemoved, (state, { payload: [wsId] }) =>
  clearSession(state, wsId),
);
workspaceLifecycleReducer.with(workspaceStateReset, () => initialState);

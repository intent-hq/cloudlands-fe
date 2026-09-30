import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  PRWorkflowCommand,
  PRWorkflowResult,
  PRWorkflowState,
  PRWorkflowWorkspaceState,
} from './pr-workflow-types';

export const emptyPRWorkflowState: PRWorkflowWorkspaceState = {
  operations: {},
  pendingAuth: null,
  prDrawerOpen: false,
  forcePushDrawerOpen: false,
  connectRemoteDrawerOpen: false,
  commitDrawerOpen: false,
};
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyPRWorkflowState);
export const prWorkflowRequested = createAsyncAction<
  [workspaceId: string, command: PRWorkflowCommand, requestId?: string],
  { workspaceId: string; command: PRWorkflowCommand; requestId: string },
  PRWorkflowResult
>(
  'prWorkflow/requested',
  'prWorkflow/completed',
  (workspaceId, command, requestId = crypto.randomUUID()) => ({ workspaceId, command, requestId }),
);
export const resumePRWorkflowAfterAuth = createAction<[workspaceId: string]>(
  'prWorkflow/resumeAfterAuth',
);
export const prCreatorRequested = createAsyncAction<
  [workspaceId: string, generate: boolean, requestId: string],
  PRWorkflowResult
>('prWorkflow/creatorRequested', 'prWorkflow/creatorCompleted');
export const setPRWorkflowPendingAuth = createAction<
  [workspaceId: string, command: PRWorkflowCommand | null]
>('prWorkflow/setPendingAuth');
export const setPRWorkflowDrawer =
  createAction<
    [
      workspaceId: string,
      drawer:
        'prDrawerOpen' | 'forcePushDrawerOpen' | 'connectRemoteDrawerOpen' | 'commitDrawerOpen',
      open: boolean,
    ]
  >('prWorkflow/setDrawer');

export const prWorkflowReducer = createReducer<PRWorkflowState>({ byWorkspaceId: {} });
prWorkflowReducer.with(prWorkflowRequested, (state, { payload }) => {
  const ws = getWorkspaceState(state, payload.workspaceId);
  if (ws.operations[payload.command.kind]?.requestId === payload.requestId) return state;
  return setWorkspaceState(state, payload.workspaceId, {
    ...ws,
    operations: {
      ...ws.operations,
      [payload.command.kind]: { requestId: payload.requestId, status: 'pending', result: null },
    },
  });
});
prWorkflowReducer.with(prWorkflowRequested.success, (state, { payload: { request, response } }) => {
  const ws = getWorkspaceState(state, request.workspaceId);
  if (ws.operations[request.command.kind]?.requestId !== request.requestId) return state;
  return setWorkspaceState(state, request.workspaceId, {
    ...ws,
    operations: {
      ...ws.operations,
      [request.command.kind]: {
        requestId: request.requestId,
        status: response.needsAuth ? 'auth-required' : response.success ? 'success' : 'error',
        result: response,
      },
    },
  });
});
prWorkflowReducer.with(
  setPRWorkflowPendingAuth,
  (state, { payload: [workspaceId, pendingAuth] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return ws.pendingAuth === pendingAuth
      ? state
      : setWorkspaceState(state, workspaceId, { ...ws, pendingAuth });
  },
);
prWorkflowReducer.with(setPRWorkflowDrawer, (state, { payload: [workspaceId, drawer, open] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  return ws[drawer] === open
    ? state
    : setWorkspaceState(state, workspaceId, { ...ws, [drawer]: open });
});
prWorkflowReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);
prWorkflowReducer.with(backendReconnected, (state) => {
  let next = state;
  for (const [workspaceId, ws] of Object.entries(state.byWorkspaceId)) {
    if (ws.pendingAuth) next = setWorkspaceState(next, workspaceId, { ...ws, pendingAuth: null });
  }
  return next;
});

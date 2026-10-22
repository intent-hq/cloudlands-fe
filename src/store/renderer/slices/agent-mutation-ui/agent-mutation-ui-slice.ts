import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  AgentMutationUiEntry,
  AgentMutationUiOperation,
  AgentMutationUiState,
  AgentMutationUiWorkspaceState,
} from './agent-mutation-ui-types';

export const agentMutationUiRequested = createAction<
  [
    workspaceId: string,
    consumerId: string,
    requestId: string,
    agentId: string,
    operation: AgentMutationUiOperation,
  ]
>('agentMutationUi/requested');

export const agentMutationUiFinished = createAction<
  [
    workspaceId: string,
    consumerId: string,
    requestId: string,
    status: Exclude<AgentMutationUiEntry['status'], 'pending'>,
    error?: string,
  ]
>('agentMutationUi/finished');

export const agentMutationUiConsumed = createAction<
  [workspaceId: string, consumerId: string, requestId: string]
>('agentMutationUi/consumed');

export const agentMutationUiReleased = createAction<[workspaceId: string, consumerId: string]>(
  'agentMutationUi/released',
);

const emptyWorkspace: AgentMutationUiWorkspaceState = {
  consumers: createCollection<AgentMutationUiEntry, 'id'>('id'),
};
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspace);
export const agentMutationUiReducer = createReducer<AgentMutationUiState>({ byWorkspaceId: {} });

agentMutationUiReducer.with(
  agentMutationUiRequested,
  (state, { payload: [workspaceId, id, requestId, agentId, operation] }) => {
    const current = getWorkspaceState(state, workspaceId);
    if (getItem(current.consumers, id)?.requestId === requestId) return state;
    return setWorkspaceState(state, workspaceId, {
      consumers: upsertItem(removeItem(current.consumers, id), {
        id,
        requestId,
        agentId,
        operation,
        status: 'pending',
      }),
    });
  },
);
agentMutationUiReducer.with(
  agentMutationUiFinished,
  (state, { payload: [workspaceId, id, requestId, status, error] }) => {
    const current = getWorkspaceState(state, workspaceId);
    const entry = getItem(current.consumers, id);
    if (entry?.requestId !== requestId || entry.status !== 'pending') return state;
    return setWorkspaceState(state, workspaceId, {
      consumers: upsertItem(current.consumers, { ...entry, status, ...(error ? { error } : {}) }),
    });
  },
);
agentMutationUiReducer.with(
  agentMutationUiConsumed,
  (state, { payload: [workspaceId, id, requestId] }) => {
    const current = getWorkspaceState(state, workspaceId);
    const entry = getItem(current.consumers, id);
    if (entry?.requestId !== requestId || entry.status === 'pending' || entry.consumed)
      return state;
    return setWorkspaceState(state, workspaceId, {
      // Retain the request identity until release so replay cannot repeat I/O.
      consumers: upsertItem(current.consumers, { ...entry, consumed: true }),
    });
  },
);
agentMutationUiReducer.with(agentMutationUiReleased, (state, { payload: [workspaceId, id] }) => {
  const current = getWorkspaceState(state, workspaceId);
  if (!getItem(current.consumers, id)) return state;
  return setWorkspaceState(state, workspaceId, { consumers: removeItem(current.consumers, id) });
});
agentMutationUiReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);

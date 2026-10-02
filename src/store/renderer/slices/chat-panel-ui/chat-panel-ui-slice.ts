import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type { UserMessageIndexResult } from '$lib/client/app-client';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  ChatPanelUiState,
  ChatPanelUiStatus,
  ChatPanelUiWorkspaceState,
} from './chat-panel-ui-types';

export const userMessageIndexRequested = createAction<
  [workspaceId: string, consumerId: string, requestId: string, agentId: string, epoch: number]
>('chatPanelUi/userMessageIndexRequested');

export const userMessageIndexFinished = createAction<
  [
    workspaceId: string,
    consumerId: string,
    requestId: string,
    status: Exclude<ChatPanelUiStatus, 'pending'>,
    result?: UserMessageIndexResult,
    error?: string,
  ]
>('chatPanelUi/userMessageIndexFinished');

export const chatPanelRetryAgentRequested = createAction<
  [workspaceId: string, consumerId: string, requestId: string, agentId: string]
>('chatPanelUi/retryAgentRequested');

export const chatPanelRetryAgentFinished = createAction<
  [
    workspaceId: string,
    consumerId: string,
    requestId: string,
    status: Exclude<ChatPanelUiStatus, 'pending'>,
    error?: string,
  ]
>('chatPanelUi/retryAgentFinished');

export const chatPanelUiReleased =
  createAction<[workspaceId: string, consumerId: string]>('chatPanelUi/released');

const emptyWorkspace: ChatPanelUiWorkspaceState = {
  userMessageIndexes: createCollection('id'),
  retryAgents: createCollection('id'),
};
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspace);

export const chatPanelUiReducer = createReducer<ChatPanelUiState>({ byWorkspaceId: {} });

chatPanelUiReducer.with(
  userMessageIndexRequested,
  (state, { payload: [workspaceId, id, requestId, agentId, epoch] }) => {
    const workspace = getWorkspaceState(state, workspaceId);
    const previous = getItem(workspace.userMessageIndexes, id);
    return setWorkspaceState(state, workspaceId, {
      ...workspace,
      userMessageIndexes: upsertItem(workspace.userMessageIndexes, {
        id,
        requestId,
        agentId,
        epoch,
        status: 'pending',
        ...(previous?.agentId === agentId && previous.result ? { result: previous.result } : {}),
      }),
    });
  },
);

chatPanelUiReducer.with(
  userMessageIndexFinished,
  (state, { payload: [workspaceId, id, requestId, status, result, error] }) => {
    const workspace = getWorkspaceState(state, workspaceId);
    const entry = getItem(workspace.userMessageIndexes, id);
    if (entry?.requestId !== requestId || entry.status !== 'pending') return state;
    return setWorkspaceState(state, workspaceId, {
      ...workspace,
      userMessageIndexes: upsertItem(workspace.userMessageIndexes, {
        ...entry,
        status,
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
      }),
    });
  },
);

chatPanelUiReducer.with(
  chatPanelRetryAgentRequested,
  (state, { payload: [workspaceId, id, requestId, agentId] }) => {
    const workspace = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...workspace,
      retryAgents: upsertItem(workspace.retryAgents, {
        id,
        requestId,
        agentId,
        status: 'pending',
      }),
    });
  },
);

chatPanelUiReducer.with(
  chatPanelRetryAgentFinished,
  (state, { payload: [workspaceId, id, requestId, status, error] }) => {
    const workspace = getWorkspaceState(state, workspaceId);
    const entry = getItem(workspace.retryAgents, id);
    if (entry?.requestId !== requestId || entry.status !== 'pending') return state;
    return setWorkspaceState(state, workspaceId, {
      ...workspace,
      retryAgents: upsertItem(workspace.retryAgents, {
        ...entry,
        status,
        ...(error ? { error } : {}),
      }),
    });
  },
);

chatPanelUiReducer.with(chatPanelUiReleased, (state, { payload: [workspaceId, id] }) => {
  const workspace = getWorkspaceState(state, workspaceId);
  if (!getItem(workspace.userMessageIndexes, id) && !getItem(workspace.retryAgents, id))
    return state;
  return setWorkspaceState(state, workspaceId, {
    userMessageIndexes: removeItem(workspace.userMessageIndexes, id),
    retryAgents: removeItem(workspace.retryAgents, id),
  });
});

chatPanelUiReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);

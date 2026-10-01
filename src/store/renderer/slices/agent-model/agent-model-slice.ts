import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  removeItem,
  updateItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  AgentModelMutation,
  AgentModelOutcome,
  AgentModelRequest,
  AgentModelState,
  AgentModelWriteOptions,
} from './agent-model-types';

export const agentModelMutationRequested = createAsyncAction<
  [request: AgentModelRequest, options?: AgentModelWriteOptions],
  AgentModelOutcome
>('agentModel/mutationRequested', 'agentModel/mutation');
export const agentModelMutationConsumed = createAction<[requestId: string, consumerId: string]>(
  'agentModel/mutationConsumed',
);
export const agentEffortIntentMarked = createAction<
  [agentId: string, workspaceId: string, intent: number]
>('agentModel/effortIntentMarked');
export const agentEffortIntentReleased = createAction<
  [agentId: string, workspaceId: string, intent: number]
>('agentModel/effortIntentReleased');

const initialState: AgentModelState = {
  mutations: createCollection<AgentModelMutation, 'requestId'>('requestId'),
};
export const agentModelReducer = createReducer<AgentModelState>(initialState);
function matches(current: AgentModelMutation | undefined, request: AgentModelRequest) {
  return (
    current?.status === 'pending' &&
    current.consumerId === request.consumerId &&
    current.agentId === request.agentId &&
    current.workspaceId === request.workspaceId &&
    current.connection === request.connection
  );
}
agentModelReducer.with(agentModelMutationRequested, (state, { payload: [request] }) => {
  const { operation: _operation, ...identity } = request;
  return { ...state, mutations: upsertItem(state.mutations, { ...identity, status: 'pending' }) };
});
agentModelReducer.with(
  agentModelMutationRequested.success,
  (
    state,
    {
      payload: {
        request: [request],
        response,
      },
    },
  ) => {
    const current = getItem(state.mutations, request.requestId);
    if (!matches(current, request)) return state;
    return {
      ...state,
      mutations: updateItem(state.mutations, {
        requestId: request.requestId,
        status: response.status,
        ...(response.modelAccepted === undefined ? {} : { modelAccepted: response.modelAccepted }),
        ...(response.error ? { error: response.error } : {}),
      }),
    };
  },
);
agentModelReducer.with(
  agentModelMutationRequested.failure,
  (
    state,
    {
      payload: {
        request: [request],
        error,
      },
    },
  ) => {
    if (!matches(getItem(state.mutations, request.requestId), request)) return state;
    return {
      ...state,
      mutations: updateItem(state.mutations, {
        requestId: request.requestId,
        status: 'failure',
        error: error.message,
      }),
    };
  },
);
agentModelReducer.with(
  agentModelMutationConsumed,
  (state, { payload: [requestId, consumerId] }) => {
    if (getItem(state.mutations, requestId)?.consumerId !== consumerId) return state;
    return { ...state, mutations: removeItem(state.mutations, requestId) };
  },
);

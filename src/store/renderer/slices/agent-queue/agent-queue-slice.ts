import type { QueuedMessage } from "$shared/types";
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import { createCollection } from "ag-redux-toolkit/utils/collections/collection-utils";
import type { AgentQueueEntryState, AgentQueueState } from "./agent-queue-types";

const createEmptyAgentQueueEntry = (): AgentQueueEntryState => ({
  messages: createCollection<QueuedMessage, "id">("id"),
  isHydrating: false,
  error: null,
});

export const initialState: AgentQueueState = {
  byAgentId: {},
};

export const hydrateAgentQueueRequested = createAction<[agentId: string]>(
  "agentQueue/hydrateRequested",
);

export const replaceAgentQueue = createAction<[agentId: string, messages: QueuedMessage[]]>(
  "agentQueue/replaceQueue",
);

export const clearAgentQueue = createAction<[agentId: string]>("agentQueue/clearQueue");

export const setAgentQueueHydrating = createAction<[agentId: string, isHydrating: boolean]>(
  "agentQueue/setHydrating",
);

export const setAgentQueueError = createAction<[agentId: string, error: string | null]>(
  "agentQueue/setError",
);

function setAgentQueueEntry(
  state: AgentQueueState,
  agentId: string,
  entry: AgentQueueEntryState,
): AgentQueueState {
  return {
    ...state,
    byAgentId: {
      ...state.byAgentId,
      [agentId]: entry,
    },
  };
}

export const agentQueueReducer = createReducer<AgentQueueState>(initialState)
  .with(hydrateAgentQueueRequested, (state, { payload: [agentId] }) => {
    const current = state.byAgentId[agentId] ?? createEmptyAgentQueueEntry();
    return setAgentQueueEntry(state, agentId, {
      ...current,
      isHydrating: true,
      error: null,
    });
  })
  .with(replaceAgentQueue, (state, { payload: [agentId, messages] }) => {
    const current = state.byAgentId[agentId] ?? createEmptyAgentQueueEntry();
    return setAgentQueueEntry(state, agentId, {
      ...current,
      messages: createCollection<QueuedMessage, "id">("id", messages),
      isHydrating: false,
      error: null,
    });
  })
  .with(clearAgentQueue, (state, { payload: [agentId] }) => {
    if (!state.byAgentId[agentId]) return state;
    const remaining = { ...state.byAgentId };
    delete remaining[agentId];
    return { ...state, byAgentId: remaining };
  })
  .with(setAgentQueueHydrating, (state, { payload: [agentId, isHydrating] }) => {
    const current = state.byAgentId[agentId];
    if (!current && !isHydrating) return state;
    return setAgentQueueEntry(state, agentId, {
      ...(current ?? createEmptyAgentQueueEntry()),
      isHydrating,
      error: isHydrating ? null : (current?.error ?? null),
    });
  })
  .with(setAgentQueueError, (state, { payload: [agentId, error] }) => {
    const current = state.byAgentId[agentId];
    if (!current && error === null) return state;
    return setAgentQueueEntry(state, agentId, {
      ...(current ?? createEmptyAgentQueueEntry()),
      isHydrating: false,
      error,
    });
  });

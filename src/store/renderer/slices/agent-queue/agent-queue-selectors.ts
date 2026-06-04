import { store } from "../../store";
import type { QueuedMessage } from "$shared/types";
import type { StoreState } from "../../types";
import {
  createCollection,
  getItem,
  getItems,
} from "ag-redux-toolkit/utils/collections/collection-utils";
import type { AgentQueueEntryState } from "./agent-queue-types";

const emptyAgentQueueEntry: AgentQueueEntryState = {
  messages: createCollection<QueuedMessage, "id">("id"),
  recentlyRemovedMessageIds: [],
  isHydrating: false,
  error: null,
};

export const selectAgentQueueState = store.createSelector<[agentId: string], AgentQueueEntryState>(
  (state: StoreState, agentId: string): AgentQueueEntryState =>
    state.agentQueue?.byAgentId[agentId] ?? emptyAgentQueueEntry,
);

export const selectAgentQueueMessages = store.createSelector<[agentId: string], QueuedMessage[]>(
  (state: StoreState, agentId: string): QueuedMessage[] =>
    getItems(selectAgentQueueState.select(state, agentId).messages),
);

export const selectAgentQueueOrderedMessages = selectAgentQueueMessages;

export const selectAgentQueueMessageById = store.createSelector<
  [agentId: string, messageId: string],
  QueuedMessage | undefined
>((state: StoreState, agentId: string, messageId: string): QueuedMessage | undefined =>
  getItem(selectAgentQueueState.select(state, agentId).messages, messageId),
);

export const selectAgentQueueCount = store.createSelector<[agentId: string], number>(
  (state: StoreState, agentId: string): number =>
    selectAgentQueueState.select(state, agentId).messages.ids.length,
);

export const selectAgentQueueHasQueued = store.createSelector<[agentId: string], boolean>(
  (state: StoreState, agentId: string): boolean => selectAgentQueueCount.select(state, agentId) > 0,
);

export const selectAgentQueueHasQueuedMessages = selectAgentQueueHasQueued;

export const selectAgentQueueIsHydrating = store.createSelector<[agentId: string], boolean>(
  (state: StoreState, agentId: string): boolean => selectAgentQueueState.select(state, agentId).isHydrating,
);

export const selectAgentQueueError = store.createSelector<[agentId: string], string | null>(
  (state: StoreState, agentId: string): string | null => selectAgentQueueState.select(state, agentId).error,
);

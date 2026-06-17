import { store } from "../../store";
import type { QueuedMessage } from "$shared/types";
import type { StoreState } from "../../types";
import {
  createCollection,
  getItems,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import type { AgentQueueEntryState } from "./agent-queue-types";

const emptyAgentQueueEntry: AgentQueueEntryState = {
  messages: createCollection<QueuedMessage, "id">("id"),
  recentlyRemovedMessageIds: [],
  isHydrating: false,
  error: null,
};

const selectAgentQueueState = store.createSelector<[agentId: string], AgentQueueEntryState>(
  (state: StoreState, agentId: string): AgentQueueEntryState =>
    state.agentQueue?.byAgentId[agentId] ?? emptyAgentQueueEntry,
);

export const selectAgentQueueMessages = store.createSelector<[agentId: string], QueuedMessage[]>(
  (state: StoreState, agentId: string): QueuedMessage[] =>
    getItems(selectAgentQueueState.select(state, agentId).messages),
);

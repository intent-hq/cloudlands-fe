import { store } from '../../store';
import type { QueuedMessage } from '$shared/types';
import type { StoreState } from '../../types';
import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { AgentQueueEntryState } from './agent-queue-types';

const emptyAgentQueueEntry: AgentQueueEntryState = {
  messages: createCollection<QueuedMessage, 'id'>('id'),
  recentlyRemovedMessageIds: [],
  isHydrating: false,
  error: null,
};

const selectAgentQueueState = store.createSelector<[agentId: string], AgentQueueEntryState>(
  (state: StoreState, agentId: string): AgentQueueEntryState =>
    state.agentQueue?.byAgentId[agentId] ?? emptyAgentQueueEntry,
);

export const selectAgentQueueMessages = store.createSelector<
  [agentId: string, workspaceId?: string],
  QueuedMessage[]
>((state: StoreState, agentId: string, workspaceId?: string): QueuedMessage[] => {
  const entry = selectAgentQueueState.select(state, agentId);
  if (
    workspaceId !== undefined &&
    entry.workspaceId !== undefined &&
    entry.workspaceId !== workspaceId
  )
    return [];
  return getItems(entry.messages);
});

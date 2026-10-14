import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { QueuedMessage } from '$shared/types';
import type { AgentQueueState, AgentQueueEntryState } from './agent-queue-types';
const emptyAgentQueueEntry: AgentQueueEntryState = {
  messages: createCollection<QueuedMessage, 'id'>('id'),
  recentlyRemovedMessageIds: [],
  isHydrating: false,
  error: null,
};

export const getAgentQueueMessages = (
  state: { agentQueue: AgentQueueState },
  agentId: string,
  workspaceId?: string,
): QueuedMessage[] => {
  const entry = state.agentQueue?.byAgentId[agentId] ?? emptyAgentQueueEntry;
  if (
    workspaceId !== undefined &&
    entry.workspaceId !== undefined &&
    entry.workspaceId !== workspaceId
  )
    return [];
  return getItems(entry.messages);
};

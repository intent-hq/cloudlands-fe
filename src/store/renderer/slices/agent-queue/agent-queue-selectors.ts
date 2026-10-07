import { store } from '../../store';
import type { QueuedMessage } from '$shared/types';
import type { StoreState } from '../../types';
import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type {
  AgentQueueEntryState,
  AgentQueueState,
  QueuedMessageMutation,
} from './agent-queue-types';

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

const EMPTY_MUTATIONS: QueuedMessageMutation[] = [];
const mutationsByScope = new WeakMap<
  AgentQueueState['mutations'],
  Map<string, QueuedMessageMutation[]>
>();

/**
 * Queued edit/remove/send-now requests for one agent in one workspace, across every
 * consumer (panel), in request order. Stable until the mutation collection changes.
 */
export const selectQueuedMessageMutations = store.createSelector<
  [agentId: string, workspaceId: string],
  QueuedMessageMutation[]
>((state: StoreState, agentId: string, workspaceId: string): QueuedMessageMutation[] => {
  const collection = state.agentQueue?.mutations;
  if (!collection || collection.ids.length === 0) return EMPTY_MUTATIONS;
  let byScope = mutationsByScope.get(collection);
  if (!byScope) {
    byScope = new Map();
    mutationsByScope.set(collection, byScope);
  }
  const key = `${workspaceId}\u0000${agentId}`;
  let scoped = byScope.get(key);
  if (!scoped) {
    const matches = getItems(collection).filter(
      (entry) => entry.agentId === agentId && entry.workspaceId === workspaceId,
    );
    scoped = matches.length === 0 ? EMPTY_MUTATIONS : matches;
    byScope.set(key, scoped);
  }
  return scoped;
});

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

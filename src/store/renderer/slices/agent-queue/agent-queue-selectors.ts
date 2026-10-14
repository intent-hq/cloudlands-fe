import { getAgentQueueMessages } from './agent-queue-projections';
import { store } from '../../store';
import type { StoreState } from '../../types';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { AgentQueueState, QueuedMessageMutation } from './agent-queue-types';

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

export const selectAgentQueueMessages = store.createSelector(getAgentQueueMessages);

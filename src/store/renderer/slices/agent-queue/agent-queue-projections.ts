import {
  createCollection,
  getItem,
  getItems,
} from '@themislib/themis/utils/collections/collection-utils';
import type { QueuedMessage } from '$shared/types';
import type {
  AgentQueueState,
  AgentQueueEntryState,
  QueuedMessageMutationRequest,
  QueuedMessageMutation,
} from './agent-queue-types';
const emptyAgentQueueEntry: AgentQueueEntryState = {
  messages: createCollection<QueuedMessage, 'id'>('id'),
  recentlyRemovedMessageIds: [],
  isHydrating: false,
  error: null,
};

/** Missing state stays missing; callers can distinguish an unread queue from an empty one. */
export const getAgentQueueEntry = (
  state: { agentQueue: AgentQueueState },
  agentId: string,
  workspaceId?: string,
): AgentQueueEntryState | undefined => {
  const entry = state.agentQueue?.byAgentId[agentId];
  if (
    workspaceId !== undefined &&
    entry?.workspaceId !== undefined &&
    entry.workspaceId !== workspaceId
  )
    return undefined;
  return entry;
};

export const getAgentQueueMessages = (
  state: { agentQueue: AgentQueueState },
  agentId: string,
  workspaceId?: string,
): QueuedMessage[] =>
  getItems((getAgentQueueEntry(state, agentId, workspaceId) ?? emptyAgentQueueEntry).messages);

export const getQueuedMessageMutation = (
  state: { agentQueue: AgentQueueState },
  requestId: string,
) => getItem(state.agentQueue.mutations, requestId);

/** A lost receipt must never become an automatic second removal after re-entry. */
export const getQueueRemovalUncertain = (
  state: { agentQueue: AgentQueueState },
  request: QueuedMessageMutationRequest,
): boolean =>
  getItems(state.agentQueue.mutations).some(
    (entry) =>
      entry.requestId !== request.requestId &&
      entry.agentId === request.agentId &&
      entry.workspaceId === request.workspaceId &&
      entry.messageId === request.messageId &&
      entry.removalBackendId === request.removalBackendId &&
      entry.removalScope?.principalId === request.removalScope?.principalId &&
      entry.removalDispatched === true &&
      (entry.status === 'pending' || entry.removalOutcome === 'unknown'),
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
export const getQueuedMessageMutations = (
  state: { agentQueue: AgentQueueState },
  agentId: string,
  workspaceId: string,
): QueuedMessageMutation[] => {
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
};

import {
  getAgentQueueMessages,
  getQueuedMessageMutations,
  getQueuedMessageMutation,
  getQueueRemovalUncertain,
} from './agent-queue-projections';
import { store } from '../../store';

export const selectQueuedMessageMutations = store.createSelector(getQueuedMessageMutations);

export const selectAgentQueueMessages = store.createSelector(getAgentQueueMessages);

export const selectQueuedMessageMutation = store.createSelector(getQueuedMessageMutation);
export const selectQueueRemovalUncertain = store.createSelector(getQueueRemovalUncertain);

import { store } from '@/store';
import { getAgentQueueEntry, getAgentQueueMessages, getQueuedMessageMutations, getQueuedMessageMutation, getQueueRemovalUncertain } from '../../../../../src/store/renderer/slices/agent-queue/agent-queue-projections';
export const selectAgentQueueEntry = store.createSelector(getAgentQueueEntry);
export const selectAgentQueueMessages = store.createSelector(getAgentQueueMessages);
export const selectQueuedMessageMutations = store.createSelector(getQueuedMessageMutations);
export const selectQueuedMessageMutation = store.createSelector(getQueuedMessageMutation);
export const selectQueueRemovalUncertain = store.createSelector(getQueueRemovalUncertain);

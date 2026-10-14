import { store } from '@/store';
import { getAgentQueueMessages } from '../../../../../src/store/renderer/slices/agent-queue/agent-queue-projections';
export const selectAgentQueueMessages = store.createSelector(getAgentQueueMessages);

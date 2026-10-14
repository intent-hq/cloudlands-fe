import { store } from '@/store';
import {
  getAgentChatState,
  getHydratedBlock,
} from '../../../../../src/store/renderer/slices/chat-state/chat-state-projections';

export const selectChatAgentState = store.createSelector(getAgentChatState);
export const selectHydratedBlock = store.createSelector(getHydratedBlock);

export const selectTranscriptHydration = store.createSelector(
  (state, agentId: string) => getAgentChatState(state, agentId).transcriptHydration,
);

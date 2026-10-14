import { store } from '@/store';
import { getAgentChatState } from '../../../../../src/store/renderer/slices/chat-state/chat-state-projections';

export const selectChatAgentState = store.createSelector(getAgentChatState);

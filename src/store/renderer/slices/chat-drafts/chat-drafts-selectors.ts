import { store } from '../../store';
import { getChatDraftOwnerView } from './chat-drafts-projections';
export const selectChatDraftOwnerView = store.createSelector(getChatDraftOwnerView);

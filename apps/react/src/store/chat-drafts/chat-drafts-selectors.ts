import { store } from '@/store';
import { getChatDraftOwnerView } from '../../../../../src/store/renderer/slices/chat-drafts/chat-drafts-projections';
export const selectChatDraftOwnerView = store.createSelector(getChatDraftOwnerView);

import { getChatDraft } from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-projections';
export const selectChatDraft = store.createSelector(getChatDraft);

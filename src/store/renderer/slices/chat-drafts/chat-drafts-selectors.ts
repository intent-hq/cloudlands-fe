import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { ChatDraftOwnerView } from './chat-drafts-types';

export const selectChatDraftOwner = store.createSelector((state, ownerId: string) =>
  getItem(state.chatDrafts.owners, ownerId),
);

/** Restore outcome plus every save outcome the owner has not acknowledged yet. */
export const selectChatDraftOwnerView = store.createSelector(
  (state, ownerId: string): ChatDraftOwnerView | undefined => {
    const owner = getItem(state.chatDrafts.owners, ownerId);
    return owner ? { restore: owner.restore, saves: getItems(owner.saves) } : undefined;
  },
);

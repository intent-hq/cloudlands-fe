import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { ChatDraftOwnerView, ChatDraftsState } from './chat-drafts-types';
export function getChatDraftOwnerView(
  state: { chatDrafts: ChatDraftsState },
  ownerId: string,
): ChatDraftOwnerView | undefined {
  const owner = getItem(state.chatDrafts.owners, ownerId);
  return owner ? { restore: owner.restore, saves: getItems(owner.saves) } : undefined;
}

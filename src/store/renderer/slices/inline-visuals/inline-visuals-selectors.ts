import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectInlineVisual = store.createSelector((state, key: string) =>
  getItem(state.inlineVisuals.entries, key),
);
export const selectInlineVisualDrafts = store.createSelector((state, ownerId: string) =>
  getItems(state.inlineVisuals.drafts).filter((draft) => draft.ownerId === ownerId),
);

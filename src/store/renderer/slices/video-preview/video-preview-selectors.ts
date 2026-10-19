import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectVideoPreview = store.createSelector((state, viewId: string) =>
  getItem(state.videoPreview.previews, viewId),
);

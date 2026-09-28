import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectPdfPreview = store.createSelector((state, viewId: string) =>
  getItem(state.pdfPreview.previews, viewId),
);

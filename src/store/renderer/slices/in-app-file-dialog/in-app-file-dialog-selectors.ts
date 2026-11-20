import { getItems } from '@themislib/themis/utils/collections/collection-utils';

import type { InAppFileDialogRequest } from '$shared/in-app-file-dialog';

import { store } from '../../store';

/** The request the host shows: the oldest open one, or `null`. */
export const selectCurrentInAppFileDialog = store.createSelector(
  (state): InAppFileDialogRequest | null =>
    (state.inAppFileDialog ? getItems(state.inAppFileDialog.requests)[0] : undefined) ?? null,
);

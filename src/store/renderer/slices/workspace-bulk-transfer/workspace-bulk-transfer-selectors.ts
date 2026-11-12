import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectBulkTransferState = store.createSelector((state) => state.workspaceBulkTransfer);

export const selectBulkTransferCurrentId = store.createSelector(
  (state) => state.workspaceBulkTransfer.currentId,
);

export const selectBulkTransferCancelling = store.createSelector(
  (state) => state.workspaceBulkTransfer.cancelling,
);

/** Selected workspaces in transfer order. */
export const selectBulkTransferItemList = store.createSelector((state) =>
  getItems(state.workspaceBulkTransfer.items),
);

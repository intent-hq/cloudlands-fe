import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { ProviderSwitchDialogView } from './provider-switch-dialog-types';

export const selectProviderSwitchDialog = store.createSelector(
  (state): ProviderSwitchDialogView => ({
    ...state.providerSwitchDialog,
    rows: getItems(state.providerSwitchDialog.rows),
  }),
);

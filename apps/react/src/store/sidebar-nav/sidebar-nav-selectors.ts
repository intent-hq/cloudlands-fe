import { store } from '@/store';
import { getMultiSelectSidebarSelectedTabIds } from '../../../../../src/store/renderer/slices/sidebar-nav/sidebar-nav-projections';

export const selectMultiSelectSidebarSelectedTabIds = store.createSelector(
  getMultiSelectSidebarSelectedTabIds,
);

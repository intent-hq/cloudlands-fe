import { store } from '@/store';
import {
  getMultiSelectSidebarSelectedTabIds,
  getPinnedWorkspaceIds,
  getChiefActiveAgentId,
  getWorkspaceNoteOrder,
  getWorkspaceCollapsedNoteIds,
} from '../../../../../src/store/renderer/slices/sidebar-nav/sidebar-nav-projections';

export const selectMultiSelectSidebarSelectedTabIds = store.createSelector(
  getMultiSelectSidebarSelectedTabIds,
);

export const selectChiefActiveAgentId = store.createSelector(getChiefActiveAgentId);
export const selectPinnedWorkspaceIds = store.createSelector(getPinnedWorkspaceIds);
export const selectWorkspaceCollapsedNoteIds = store.createSelector(getWorkspaceCollapsedNoteIds);
export const selectWorkspaceNoteOrder = store.createSelector(getWorkspaceNoteOrder);

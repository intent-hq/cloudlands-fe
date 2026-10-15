import {
  selectChiefActiveAgentId,
  selectMultiSelectSidebarSelectedTabIds,
  selectPinnedWorkspaceIds,
  selectWorkspaceCollapsedNoteIds,
  selectWorkspaceNoteOrder,
} from '../sidebar-nav-selectors';
import { createSidebarNavSaga } from './sidebar-nav-saga-factory';

// Preserve the Svelte startup import until renderer cutover; persistence has one owner.
export const sidebarNavSaga = createSidebarNavSaga({
  selectChiefActiveAgentId,
  selectMultiSelectSidebarSelectedTabIds,
  selectPinnedWorkspaceIds,
  selectWorkspaceCollapsedNoteIds,
  selectWorkspaceNoteOrder,
});

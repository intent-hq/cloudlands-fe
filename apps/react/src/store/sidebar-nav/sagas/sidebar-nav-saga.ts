import {
  selectChiefActiveAgentId,
  selectMultiSelectSidebarSelectedTabIds,
  selectPinnedWorkspaceIds,
  selectWorkspaceCollapsedNoteIds,
  selectWorkspaceNoteOrder,
} from '../sidebar-nav-selectors';
import { createSidebarNavSaga } from '../../../../../../src/store/renderer/slices/sidebar-nav/sagas/sidebar-nav-saga-factory';

/** Root-owned persistence binding; constructing it does not start the saga. */
export const sidebarNavSaga = createSidebarNavSaga({
  selectChiefActiveAgentId,
  selectMultiSelectSidebarSelectedTabIds,
  selectPinnedWorkspaceIds,
  selectWorkspaceCollapsedNoteIds,
  selectWorkspaceNoteOrder,
});

import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '@/store';
import {
  getPanelLayoutWorkspace,
  getRecentlyClosed,
  getLastPanelClose,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-projections';
import { getAllNotes } from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-projections';

export const selectDesktopLayout = store.createSelector(getPanelLayoutWorkspace);
export const selectDesktopNotes = store.createSelector(getAllNotes);
export const selectDesktopWorkspaces = store.createSelector((state) =>
  getItems(state.workspace.workspaces),
);

export const selectDesktopRecentlyClosed = store.createSelector(getRecentlyClosed);
export const selectDesktopLastPanelClose = store.createSelector(getLastPanelClose);

export const selectDesktopDaemonStatus = store.createSelector((state) => state.daemonHealth);

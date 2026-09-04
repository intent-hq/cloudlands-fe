import { getItems, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { OpenPrWarningItem } from './workspace-operations-types';
import { selectWorkspaceById } from '../workspace/workspace-selectors';

export const selectShowDeleteWarning = store.createSelector((state) => {
  return state.workspaceOperations.showDeleteWarning;
});

export const selectPendingDeleteWorkspaceId = store.createSelector((state) => {
  return state.workspaceOperations.pendingDeleteWorkspaceId;
});

export const selectRunningAgentNamesForDelete = store.createSelector((state) => {
  return state.workspaceOperations.runningAgentNamesForDelete;
});

export const selectActiveHookNamesForDelete = store.createSelector((state) => {
  return state.workspaceOperations.activeHookNamesForDelete;
});

export const selectOpenPrsForDelete = store.createSelector((state): OpenPrWarningItem[] => {
  return getItems<OpenPrWarningItem, 'number'>(
    state.workspaceOperations.openPrsForDelete as Collection<OpenPrWarningItem, 'number'>,
  );
});

export const selectLocalChangesForDelete = store.createSelector((state) => {
  return state.workspaceOperations.localChangesForDelete;
});

export const selectShowArchiveWarning = store.createSelector((state) => {
  return state.workspaceOperations.showArchiveWarning;
});

export const selectRunningAgentNamesForArchive = store.createSelector((state) => {
  return state.workspaceOperations.runningAgentNamesForArchive;
});

export const selectPendingArchiveWorkspaceId = store.createSelector((state) => {
  return state.workspaceOperations.pendingArchiveWorkspaceId;
});

export const selectActiveHookNamesForArchive = store.createSelector((state) => {
  return state.workspaceOperations.activeHookNamesForArchive;
});

export const selectOpenPrsForArchive = store.createSelector((state): OpenPrWarningItem[] => {
  return getItems<OpenPrWarningItem, 'number'>(
    state.workspaceOperations.openPrsForArchive as Collection<OpenPrWarningItem, 'number'>,
  );
});

export const selectLocalChangesForArchive = store.createSelector((state) => {
  return state.workspaceOperations.localChangesForArchive;
});

export const selectShowBulkArchiveConfirm = store.createSelector((state) => {
  return state.workspaceOperations.showBulkArchiveConfirm;
});

export const selectShowBulkDeleteConfirm = store.createSelector((state) => {
  return state.workspaceOperations.showBulkDeleteConfirm;
});

export const selectPendingBulkWorkspaceIds = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkWorkspaceIds;
});

export const selectPendingBulkWorkspaces = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkWorkspaceIds.flatMap((id) => {
    const workspace = selectWorkspaceById.select(state, id);
    return workspace ? [workspace] : [];
  });
});

export const selectPendingBulkGroupLabel = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkGroupLabel;
});

export const selectBulkActiveAgentCount = store.createSelector((state) => {
  return state.workspaceOperations.bulkActiveAgentCount;
});

export const selectBulkActiveHookCount = store.createSelector((state) => {
  return state.workspaceOperations.bulkActiveHookCount;
});

export const selectBulkComputeToken = store.createSelector((state) => {
  return state.workspaceOperations.bulkComputeToken;
});

export const selectPendingRemoveRepoPath = store.createSelector((state) => {
  return state.workspaceOperations.pendingRemoveRepoPath;
});

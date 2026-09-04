import { getItems, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { OpenPrWarningItem } from './workspace-operations-types';

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

export const selectPendingBulkRepoKey = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkRepoKey;
});

export const selectBulkArchiveComputeToken = store.createSelector((state) => {
  return state.workspaceOperations.bulkArchiveComputeToken;
});

export const selectPendingBulkDeleteRepoKey = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkDeleteRepoKey;
});

export const selectPendingRemoveRepoPath = store.createSelector((state) => {
  return state.workspaceOperations.pendingRemoveRepoPath;
});

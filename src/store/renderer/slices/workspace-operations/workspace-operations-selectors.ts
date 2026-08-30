import { store } from '../../store';

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

export const selectOpenPrsForDelete = store.createSelector((state) => {
  return state.workspaceOperations.openPrsForDelete;
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

export const selectOpenPrsForArchive = store.createSelector((state) => {
  return state.workspaceOperations.openPrsForArchive;
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

import { store } from "../../store";

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

export const selectShowArchiveWarning = store.createSelector((state) => {
  return state.workspaceOperations.showArchiveWarning;
});

export const selectRunningAgentNamesForArchive = store.createSelector((state) => {
  return state.workspaceOperations.runningAgentNamesForArchive;
});

export const selectActiveHookNamesForArchive = store.createSelector((state) => {
  return state.workspaceOperations.activeHookNamesForArchive;
});

export const selectShowBulkArchiveConfirm = store.createSelector((state) => {
  return state.workspaceOperations.showBulkArchiveConfirm;
});

export const selectShowBulkDeleteArchivedConfirm = store.createSelector((state) => {
  return state.workspaceOperations.showBulkDeleteArchivedConfirm;
});

export const selectPendingBulkRepoKey = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkRepoKey;
});

export const selectPendingBulkDeleteRepoKey = store.createSelector((state) => {
  return state.workspaceOperations.pendingBulkDeleteRepoKey;
});

export const selectShowBulkDeleteWarningConfirm = store.createSelector((state) => {
  return state.workspaceOperations.showBulkDeleteWarningConfirm;
});

export const selectBulkDeleteWorkspaceCount = store.createSelector((state) => {
  return state.workspaceOperations.bulkDeleteWorkspaceCount;
});

export const selectShowRemoveRepoConfirm = store.createSelector((state) => {
  return state.workspaceOperations.showRemoveRepoConfirm;
});

export const selectPendingRemoveRepoPath = store.createSelector((state) => {
  return state.workspaceOperations.pendingRemoveRepoPath;
});
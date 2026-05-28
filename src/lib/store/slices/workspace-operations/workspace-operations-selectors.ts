import { createSelector } from "../../utils/create-selector";

export const selectShowDeleteWarning = createSelector((state) => {
  return state.workspaceOperations.showDeleteWarning;
});

export const selectPendingDeleteWorkspaceId = createSelector((state) => {
  return state.workspaceOperations.pendingDeleteWorkspaceId;
});

export const selectRunningAgentNamesForDelete = createSelector((state) => {
  return state.workspaceOperations.runningAgentNamesForDelete;
});

export const selectShowBulkArchiveConfirm = createSelector((state) => {
  return state.workspaceOperations.showBulkArchiveConfirm;
});

export const selectShowBulkDeleteArchivedConfirm = createSelector((state) => {
  return state.workspaceOperations.showBulkDeleteArchivedConfirm;
});

export const selectPendingBulkRepoKey = createSelector((state) => {
  return state.workspaceOperations.pendingBulkRepoKey;
});

export const selectPendingBulkDeleteRepoKey = createSelector((state) => {
  return state.workspaceOperations.pendingBulkDeleteRepoKey;
});

export const selectShowBulkDeleteWarningConfirm = createSelector((state) => {
  return state.workspaceOperations.showBulkDeleteWarningConfirm;
});

export const selectBulkDeleteWorkspaceCount = createSelector((state) => {
  return state.workspaceOperations.bulkDeleteWorkspaceCount;
});

export const selectShowRemoveRepoConfirm = createSelector((state) => {
  return state.workspaceOperations.showRemoveRepoConfirm;
});

export const selectPendingRemoveRepoPath = createSelector((state) => {
  return state.workspaceOperations.pendingRemoveRepoPath;
});
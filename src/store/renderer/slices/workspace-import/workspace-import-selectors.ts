/**
 * Workspace Import Selectors
 */

import { store } from '../../store';

export const selectImportModalOpen = store.createSelector((state) => state.workspaceImport.open);

export const selectImportStep = store.createSelector((state) => state.workspaceImport.step);

export const selectImportRunStatus = store.createSelector(
  (state) => state.workspaceImport.runStatus,
);

export const selectImportProgress = store.createSelector((state) => state.workspaceImport.progress);

export const selectImportRunError = store.createSelector((state) => state.workspaceImport.runError);

export const selectImportWorkspaceId = store.createSelector(
  (state) => state.workspaceImport.workspaceId,
);

export const selectImportWorkspaceTitle = store.createSelector(
  (state) => state.workspaceImport.workspaceTitle,
);

export const selectImportInterruptedAgents = store.createSelector(
  (state) => state.workspaceImport.interruptedAgents,
);

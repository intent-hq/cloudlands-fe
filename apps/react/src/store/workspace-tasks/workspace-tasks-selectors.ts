import { store } from '../index';
import {
  getDemandedTaskWorkspaceIds,
  getWorkspaceTasksShouldLoad,
  getWorkspaceTasksInitialized,
  getWorkspaceTaskProgress,
} from '../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-projections';

export const selectDemandedTaskWorkspaceIds = store.createSelector(getDemandedTaskWorkspaceIds);
export const selectWorkspaceTasksShouldLoad = store.createSelector(getWorkspaceTasksShouldLoad);
export const selectWorkspaceTasksInitialized = store.createSelector(getWorkspaceTasksInitialized);
export const selectWorkspaceTaskProgress = store.createSelector(getWorkspaceTaskProgress);

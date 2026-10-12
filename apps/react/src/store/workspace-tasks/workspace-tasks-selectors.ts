import { store } from '../index';
import {
  getDemandedTaskWorkspaceIds,
  getWorkspaceTasksShouldLoad,
} from '../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-projections';

export const selectDemandedTaskWorkspaceIds = store.createSelector(getDemandedTaskWorkspaceIds);
export const selectWorkspaceTasksShouldLoad = store.createSelector(getWorkspaceTasksShouldLoad);

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

import { selectAdmittedWorkspaceReadContext } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import { selectWorkspaceById } from '../workspace/workspace-selectors';

export const selectTaskReadContext = store.createSelector((state, workspaceId: string) => {
  const demands = state.workspaceTasks.byWorkspaceId[workspaceId]?.demandIds;
  const admitted = selectAdmittedWorkspaceReadContext.select(state, workspaceId);
  const workspace = selectWorkspaceById.select(state, workspaceId);
  return demands?.length && admitted && workspace
    ? JSON.stringify([
        admitted,
        state.daemonHealth.connectionGeneration,
        workspace.worktreePath || workspace.repositoryPath,
        [...demands].sort(),
      ])
    : null;
});

export const selectTaskReadScopes = store.createSelector((state) =>
  Object.fromEntries(
    selectDemandedTaskWorkspaceIds
      .select(state)
      .map((id) => [id, selectTaskReadContext.select(state, id)]),
  ),
);

export const selectWorkspaceTaskReadState = store.createSelector((state, workspaceId: string) => {
  const tasks = state.workspaceTasks.byWorkspaceId[workspaceId];
  return {
    loading: tasks?.loading ?? false,
    stale: tasks?.stale ?? true,
    error: tasks?.error ?? null,
  };
});

import type { WorkspaceTasksState } from './workspace-tasks-types';

type WorkspaceTasksProjectionState = { workspaceTasks: WorkspaceTasksState };

export const getDemandedTaskWorkspaceIds = (state: WorkspaceTasksProjectionState): string[] =>
  Object.entries(state.workspaceTasks.byWorkspaceId)
    .filter(([, workspace]) => workspace.demandIds.length > 0)
    .map(([workspaceId]) => workspaceId);

export const getWorkspaceTasksShouldLoad = (
  state: WorkspaceTasksProjectionState,
  workspaceId: string,
): boolean => {
  const ws = state.workspaceTasks.byWorkspaceId[workspaceId];
  return !!ws?.demandIds.length && !ws.loading && (!ws.initialized || ws.stale);
};

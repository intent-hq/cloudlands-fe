import type { WorkspaceTaskProgress, WorkspaceTasksState } from './workspace-tasks-types';
import { emptyWorkspaceTaskStats } from './workspace-tasks-slice';

type WorkspaceTasksProjectionState = { workspaceTasks: WorkspaceTasksState };

export const getWorkspaceTasksInitialized = (
  state: WorkspaceTasksProjectionState,
  workspaceId: string,
): boolean => state.workspaceTasks.byWorkspaceId[workspaceId]?.initialized ?? false;

export const getWorkspaceTaskProgress = (
  state: WorkspaceTasksProjectionState,
  workspaceId: string,
): WorkspaceTaskProgress =>
  state.workspaceTasks.byWorkspaceId[workspaceId]?.stats ?? emptyWorkspaceTaskStats;

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

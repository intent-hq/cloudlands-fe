import type { WorkspaceNotesState } from '../workspace-notes/workspace-notes-types';
import { getNoteById } from '../workspace-notes/workspace-notes-projections';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { ExplicitTaskStatusIdentity } from './workspace-tasks-types';
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

export const getExplicitTaskStatusView = (state: WorkspaceTasksProjectionState, viewId: string) =>
  getItem(state.workspaceTasks.explicitStatusViews, viewId);
export const getExplicitTaskStatusOperations = (
  state: WorkspaceTasksProjectionState,
  workspaceId: string,
  noteId: string,
  authority?: string,
) =>
  getItems(state.workspaceTasks.explicitStatusOperations).filter(
    (operation) =>
      operation.workspaceId === workspaceId &&
      operation.noteId === noteId &&
      (authority === undefined || operation.authority === authority),
  );
export const getExplicitTaskStatusCurrent = (
  state: WorkspaceTasksProjectionState,
  identity: ExplicitTaskStatusIdentity,
) => {
  const view = getExplicitTaskStatusView(state, identity.viewId);
  return (
    !!view &&
    !state.workspaceTasks.revokedStatusViews[identity.viewId] &&
    view.workspaceId === identity.workspaceId &&
    view.noteId === identity.noteId &&
    view.consumerId === identity.consumerId &&
    view.authority === identity.authority &&
    view.context === identity.context
  );
};

/** The daemon may echo the pre-write rev; canonical reads must advance before another write. */
export const getExplicitTaskStatusRefreshing = (
  state: WorkspaceTasksProjectionState & { workspaceNotes: WorkspaceNotesState },
  workspaceId: string,
  noteId: string,
) => {
  const rev = getNoteById(state, workspaceId, noteId)?.rev;
  return getExplicitTaskStatusOperations(state, workspaceId, noteId).some(
    (operation) =>
      (operation.status === 'conflict' &&
        (rev === undefined ||
          rev <= operation.expectedVersion ||
          (operation.echoedRev !== undefined && rev < operation.echoedRev))) ||
      (operation.status === 'confirmed' &&
        operation.echoedRev !== undefined &&
        operation.echoedRev <= operation.expectedVersion &&
        (rev === undefined || rev <= operation.expectedVersion)),
  );
};
export const getExplicitTaskStatusBlocked = (
  state: WorkspaceTasksProjectionState & { workspaceNotes: WorkspaceNotesState },
  workspaceId: string,
  noteId: string,
) =>
  getExplicitTaskStatusRefreshing(state, workspaceId, noteId) ||
  getExplicitTaskStatusOperations(state, workspaceId, noteId).some((operation) =>
    ['queued', 'running', 'unknown'].includes(operation.status),
  );

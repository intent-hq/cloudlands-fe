import type { TaskStatus, Workspace, WorkspaceTask, WorkspaceTaskStats } from '$shared/types';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  updateItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import {
  removeWorkspaceEntity,
  replaceWorkspaceList,
  setWorkspaceEntity,
} from '../workspace/workspace-slice';
import type { WorkspaceTasksState, WorkspaceTasksWorkspaceState } from './workspace-tasks-types';

export type { WorkspaceTasksState, WorkspaceTasksWorkspaceState };

/** Empty `WorkspaceTaskStats` used until the BE rollup arrives from `task.list`. */
export const emptyWorkspaceTaskStats: WorkspaceTaskStats = {
  total: 0,
  completed: 0,
  inProgress: 0,
};

export const emptyWorkspaceTasksState: WorkspaceTasksWorkspaceState = {
  tasks: createCollection<WorkspaceTask, 'id'>('id'),
  stats: emptyWorkspaceTaskStats,
  loading: false,
  error: null,
  initialized: false,
};

export const initialState: WorkspaceTasksState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceTasksState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Saga trigger: fetch the canonical task list for a workspace. */
export const loadWorkspaceTasksRequested = createAction<[workspaceId: string]>(
  'workspaceTasks/loadWorkspaceTasksRequested',
);

/**
 * Saga trigger (no reducer case): request tasks only when the workspace is
 * neither initialized nor loading. Safe to dispatch repeatedly from list
 * rows/hover surfaces; 'workspace:tasks-changed' keeps loaded state fresh.
 */
export const ensureWorkspaceTasksLoaded = createAction<[workspaceId: string]>(
  'workspaceTasks/ensureWorkspaceTasksLoaded',
);

/**
 * Saga/middleware success action — applies the `task.list` payload to the
 * slice. The BE-owned `stats` rollup is stored alongside `tasks`; selectors
 * serve it verbatim per the AUDIT-P1-2 thin-presenter rule.
 */
export const loadWorkspaceTasksSucceeded = createAction<
  [workspaceId: string, tasks: WorkspaceTask[], stats: WorkspaceTaskStats]
>('workspaceTasks/loadWorkspaceTasksSucceeded');

export const loadWorkspaceTasksFailed = createAction<[workspaceId: string, error: string]>(
  'workspaceTasks/loadWorkspaceTasksFailed',
);

/** Optimistically apply a task status change ahead of the tasks-changed refresh. */
export const applyTaskStatusChanged = createAction<
  [workspaceId: string, taskId: string, newStatus: TaskStatus]
>('workspaceTasks/applyTaskStatusChanged');

/** Clear all task state for a workspace. */
export const clearWorkspaceTasks = createAction<[workspaceId: string]>(
  'workspaceTasks/clearWorkspaceTasks',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceTasksReducer = createReducer<WorkspaceTasksState>(initialState);
workspaceTasksReducer.with(loadWorkspaceTasksRequested, (state, { payload: [workspaceId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (ws.loading && ws.error === null) return state;
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    loading: true,
    error: null,
  });
});
workspaceTasksReducer.with(
  loadWorkspaceTasksSucceeded,
  (state, { payload: [workspaceId, tasks, stats] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      tasks: createCollection<WorkspaceTask, 'id'>('id', tasks),
      stats,
      loading: false,
      error: null,
      initialized: true,
    });
  },
);
workspaceTasksReducer.with(loadWorkspaceTasksFailed, (state, { payload: [workspaceId, error] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (!ws.loading && ws.error === error) return state;
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    loading: false,
    error,
  });
});
workspaceTasksReducer.with(
  applyTaskStatusChanged,
  (state, { payload: [workspaceId, taskId, newStatus] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    if (!ws?.initialized) return state;

    const task = getItem(ws.tasks, taskId as WorkspaceTask['id']);
    if (!task || task.status === newStatus) return state;

    return setWorkspaceState(state, workspaceId, {
      ...ws,
      tasks: updateItem(ws.tasks, { id: task.id, status: newStatus }),
    });
  },
);
workspaceTasksReducer.with(clearWorkspaceTasks, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);
workspaceTasksReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);

/**
 * Seed `stats` from a workspace list row's `taskStats` rollup (PROTOCOL §5.1)
 * so sidebar progress renders before any per-workspace `task.list` load.
 * `task.list` stays authoritative: a seed never touches an `initialized`
 * workspace and never marks one `initialized`.
 */
function seedStatsFromListRow(
  state: WorkspaceTasksState,
  workspace: Workspace,
): WorkspaceTasksState {
  const stats = workspace.taskStats;
  if (!stats) return state;

  const ws = getWorkspaceState(state, workspace.id);
  if (ws.initialized) return state;
  // Shallow-compare every field present on the incoming rollup so the no-op
  // check stays correct if the wire shape grows beyond the current trio.
  const keys = Object.keys(stats) as (keyof WorkspaceTaskStats)[];
  if (keys.every((key) => ws.stats[key] === stats[key])) return state;

  return setWorkspaceState(state, workspace.id, {
    ...ws,
    stats,
  });
}

workspaceTasksReducer.with(replaceWorkspaceList, (state, { payload: [workspaces] }) =>
  workspaces.reduce(seedStatsFromListRow, state),
);
workspaceTasksReducer.with(setWorkspaceEntity, (state, { payload: [workspace] }) =>
  seedStatsFromListRow(state, workspace),
);

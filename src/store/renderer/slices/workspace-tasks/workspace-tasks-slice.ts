import type { TaskStatus, Workspace, WorkspaceTask, WorkspaceTaskStats } from '$shared/types';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  updateItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import {
  removeWorkspaceEntity,
  replaceWorkspaceList,
  setWorkspaceEntity,
} from '../workspace/workspace-slice';
import type { WorkspaceTasksState, WorkspaceTasksWorkspaceState } from './workspace-tasks-types';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';

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
  demandIds: [],
  stale: true,
  revision: 0,
  readRevision: 0,
};

export const initialState: WorkspaceTasksState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceTasksState);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Invalidate and request a refresh, admitted only while visible demand exists. */
export const loadWorkspaceTasksRequested = createAction<[workspaceId: string]>(
  'workspaceTasks/loadWorkspaceTasksRequested',
);

/** Record actual read admission, including the first ensure-only load. */
export const workspaceTasksReadStarted = createAction<[workspaceId: string]>(
  'workspaceTasks/workspaceTasksReadStarted',
);

/** Check missing/stale data for existing demand; this does not acquire demand. */
export const ensureWorkspaceTasksLoaded = createAction<[workspaceId: string]>(
  'workspaceTasks/ensureWorkspaceTasksLoaded',
);

/**
 * A visible chat dispatches acquire with a unique ID for each visibility lifetime,
 * then releases that same ID on hide, workspace switch, or destroy. Do not acquire
 * from hidden mounted components. Multiple consumers share one canonical read.
 */
export const acquireWorkspaceTasksDemand = createAction<[workspaceId: string, demandId: string]>(
  'workspaceTasks/acquireWorkspaceTasksDemand',
);
export const releaseWorkspaceTasksDemand = createAction<[workspaceId: string, demandId: string]>(
  'workspaceTasks/releaseWorkspaceTasksDemand',
);
/** Mark stale immediately; event bridges schedule a coalesced ensure separately. */
export const invalidateWorkspaceTasks = createAction<[workspaceId: string]>(
  'workspaceTasks/invalidateWorkspaceTasks',
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
function invalidate(state: WorkspaceTasksState, workspaceId: string): WorkspaceTasksState {
  const ws = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, { ...ws, stale: true, revision: ws.revision + 1 });
}
workspaceTasksReducer.with(invalidateWorkspaceTasks, (state, { payload: [id] }) =>
  invalidate(state, id),
);
// Events may have been missed while disconnected. Retain rows and demand,
// but invalidate every cache; the read owner refreshes displayed consumers only.
workspaceTasksReducer.with(backendReconnected, (state) =>
  Object.keys(state.byWorkspaceId).reduce(invalidate, state),
);
workspaceTasksReducer.with(loadWorkspaceTasksRequested, (state, { payload: [id] }) =>
  invalidate(state, id),
);
workspaceTasksReducer.with(acquireWorkspaceTasksDemand, (state, { payload: [id, demandId] }) => {
  const ws = getWorkspaceState(state, id);
  if (ws.demandIds.includes(demandId)) return state;
  return setWorkspaceState(state, id, { ...ws, demandIds: [...ws.demandIds, demandId] });
});
workspaceTasksReducer.with(releaseWorkspaceTasksDemand, (state, { payload: [id, demandId] }) => {
  const ws = state.byWorkspaceId[id];
  if (!ws?.demandIds.includes(demandId)) return state;
  return setWorkspaceState(state, id, {
    ...ws,
    demandIds: ws.demandIds.filter((value) => value !== demandId),
  });
});
workspaceTasksReducer.with(workspaceTasksReadStarted, (state, { payload: [workspaceId] }) => {
  const ws = getWorkspaceState(state, workspaceId);
  if (ws.loading && ws.error === null) return state;
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    loading: true,
    error: null,
    readRevision: ws.revision,
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
      stale: ws.revision !== ws.readRevision,
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
    stale: true,
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
// Unmount cancels the owning saga read; release its loading state for future demand.
workspaceTasksReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) => {
  const ws = state.byWorkspaceId[workspaceId];
  return ws
    ? setWorkspaceState(state, workspaceId, {
        ...ws,
        loading: false,
        demandIds: [],
        stale: ws.stale || ws.loading,
      })
    : state;
});
workspaceTasksReducer.with(clearWorkspaceTasks, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);
workspaceTasksReducer.with(removeWorkspaceEntity, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);

/**
 * Seed `stats` from a workspace list row's `taskStats` rollup (PROTOCOL §5.1)
 * so sidebar progress renders before any per-workspace `task.list` load.
 * A clean task list stays authoritative. Once invalidated, accept fresher
 * daemon summaries without treating stale individual rows as initialized anew.
 */
function seedStatsFromListRow(
  state: WorkspaceTasksState,
  workspace: Workspace,
): WorkspaceTasksState {
  const stats = workspace.taskStats;
  if (!stats) return state;

  const ws = getWorkspaceState(state, workspace.id);
  if (ws.initialized && !ws.stale) return state;
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

import type { TaskStatus, WorkspaceTask, WorkspaceTaskStats } from "$shared/types";
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import {
  createCollection,
  getItem,
  updateItem,
} from "$lib/store-shim/utils/collections/collection-utils";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { removeWorkspaceEntity } from "../workspace/workspace-slice";
import type { WorkspaceTasksState, WorkspaceTasksWorkspaceState } from "./workspace-tasks-types";

export type { WorkspaceTasksState, WorkspaceTasksWorkspaceState };

/** Empty `WorkspaceTaskStats` used until the BE rollup arrives from `task.list`. */
export const emptyWorkspaceTaskStats: WorkspaceTaskStats = {
  total: 0,
  completed: 0,
  inProgress: 0,
};

export const emptyWorkspaceTasksState: WorkspaceTasksWorkspaceState = {
  tasks: createCollection<WorkspaceTask, "id">("id"),
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
  "workspaceTasks/loadWorkspaceTasksRequested"
);

/**
 * Saga trigger (no reducer case): request tasks only when the workspace is
 * neither initialized nor loading. Safe to dispatch repeatedly from list
 * rows/hover surfaces; 'workspace:tasks-changed' keeps loaded state fresh.
 */
export const ensureWorkspaceTasksLoaded = createAction<[workspaceId: string]>(
  "workspaceTasks/ensureWorkspaceTasksLoaded"
);

/**
 * Saga/middleware success action — applies the `task.list` payload to the
 * slice. The BE-owned `stats` rollup is stored alongside `tasks`; selectors
 * serve it verbatim per the AUDIT-P1-2 thin-presenter rule.
 */
export const loadWorkspaceTasksSucceeded = createAction<
  [workspaceId: string, tasks: WorkspaceTask[], stats: WorkspaceTaskStats]
>("workspaceTasks/loadWorkspaceTasksSucceeded");

export const loadWorkspaceTasksFailed = createAction<[workspaceId: string, error: string]>(
  "workspaceTasks/loadWorkspaceTasksFailed"
);

/** Optimistically apply a task status change ahead of the tasks-changed refresh. */
export const applyTaskStatusChanged = createAction<
  [workspaceId: string, taskId: string, newStatus: TaskStatus]
>("workspaceTasks/applyTaskStatusChanged");

/** Clear all task state for a workspace. */
export const clearWorkspaceTasks = createAction<[workspaceId: string]>(
  "workspaceTasks/clearWorkspaceTasks"
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceTasksReducer = createReducer<WorkspaceTasksState>(initialState)
  .with(loadWorkspaceTasksRequested, (state, { payload: [workspaceId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.loading && ws.error === null) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      loading: true,
      error: null,
    });
  })
  .with(loadWorkspaceTasksSucceeded, (state, { payload: [workspaceId, tasks, stats] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      tasks: createCollection<WorkspaceTask, "id">("id", tasks),
      stats,
      loading: false,
      error: null,
      initialized: true,
    });
  })
  .with(loadWorkspaceTasksFailed, (state, { payload: [workspaceId, error] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (!ws.loading && ws.error === error) return state;
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      loading: false,
      error,
    });
  })
  .with(applyTaskStatusChanged, (state, { payload: [workspaceId, taskId, newStatus] }) => {
    const ws = state.byWorkspaceId[workspaceId];
    if (!ws?.initialized) return state;

    const task = getItem(ws.tasks, taskId as WorkspaceTask["id"]);
    if (!task || task.status === newStatus) return state;

    return setWorkspaceState(state, workspaceId, {
      ...ws,
      tasks: updateItem(ws.tasks, { id: task.id, status: newStatus }),
    });
  })
  .with(clearWorkspaceTasks, (state, { payload: [workspaceId] }) =>
    clearWorkspaceState(state, workspaceId)
  )
  .with(removeWorkspaceEntity, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));


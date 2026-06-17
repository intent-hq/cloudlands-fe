import type { TaskStatus, WorkspaceTask } from "$shared/types";
import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import {
  createCollection,
  getItem,
  updateItem,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceEntity } from "../workspace/workspace-slice";
import type { WorkspaceTasksState, WorkspaceTasksWorkspaceState } from "./workspace-tasks-types";

export type { WorkspaceTasksState, WorkspaceTasksWorkspaceState };

export const emptyWorkspaceTasksState: WorkspaceTasksWorkspaceState = {
  tasks: createCollection<WorkspaceTask, "id">("id"),
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

export const loadWorkspaceTasksSucceeded = createAction<
  [workspaceId: string, tasks: WorkspaceTask[]]
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
  .with(loadWorkspaceTasksSucceeded, (state, { payload: [workspaceId, tasks] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      tasks: createCollection<WorkspaceTask, "id">("id", tasks),
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
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId))
  .with(removeWorkspaceEntity, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));


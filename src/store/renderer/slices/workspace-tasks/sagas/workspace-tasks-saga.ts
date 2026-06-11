/**
 * Workspace Tasks Saga
 *
 * Fetches canonical workspace tasks through the on-demand
 * WORKSPACE_CHANNELS.GET_TASKS endpoint and refreshes them when the main
 * process emits 'workspace:tasks-changed'. Task status changes are applied
 * optimistically from 'task:status-changed' while the debounced refresh is
 * in flight.
 */

import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import {
  takeEveryFromElectronChannel,
  takeEveryFromListenSync,
} from "$store/renderer/utils/ipc-channel";
import { WorkspaceId } from "$shared/types/branded-ids";
import type { TaskStatus, WorkspaceTasksChangedEvent } from "$shared/types";
import type { TaskStatusChangedPayload } from "$features/events/types";
import {
  call,
  fork,
  put,
  takeEvery,
} from "typed-redux-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  applyTaskStatusChanged,
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksFailed,
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
} from "../workspace-tasks-slice";
import {
  selectWorkspaceTasksInitialized,
  selectWorkspaceTasksLoading,
} from "../workspace-tasks-selectors";

const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "not_started",
  "waiting",
  "discussion_needed",
  "in_progress",
  "review_required",
  "complete",
  "cancelled",
]);

function asTaskStatus(value: unknown): TaskStatus | undefined {
  return typeof value === "string" && TASK_STATUSES.has(value as TaskStatus)
    ? (value as TaskStatus)
    : undefined;
}

export function* handleLoadWorkspaceTasksRequested(
  action: ReturnType<typeof loadWorkspaceTasksRequested>
) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  try {
    const result = yield* call(
      [workspaceClient, workspaceClient.getTasks],
      WorkspaceId(workspaceId)
    );

    if (result.ok) {
      yield* put(loadWorkspaceTasksSucceeded(workspaceId, result.data ?? []));
      return;
    }

    yield* put(loadWorkspaceTasksFailed(workspaceId, result.error));
  } catch (error) {
    yield* put(
      loadWorkspaceTasksFailed(
        workspaceId,
        error instanceof Error ? error.message : "Unknown error"
      )
    );
  }
}

export function* handleEnsureWorkspaceTasksLoaded(
  action: ReturnType<typeof ensureWorkspaceTasksLoaded>
) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;

  const initialized = yield* selectWorkspaceTasksInitialized.effect(workspaceId);
  const loading = yield* selectWorkspaceTasksLoading.effect(workspaceId);
  if (initialized || loading) return;

  yield* put(loadWorkspaceTasksRequested(workspaceId));
}

export function* handleWorkspaceMounted(action: ReturnType<typeof workspaceMounted>) {
  const [wsId] = action.payload;
  yield* put(loadWorkspaceTasksRequested(wsId));
}

export function* watchLoadWorkspaceTasksRequestedSaga() {
  yield* takeEvery(loadWorkspaceTasksRequested, handleLoadWorkspaceTasksRequested);
}

export function* watchEnsureWorkspaceTasksLoadedSaga() {
  yield* takeEvery(ensureWorkspaceTasksLoaded, handleEnsureWorkspaceTasksLoaded);
}

export function* watchWorkspaceMountedSaga() {
  yield* takeEvery(workspaceMounted, handleWorkspaceMounted);
}

export function* watchWorkspaceTasksChangedSaga() {
  yield* takeEveryFromElectronChannel<WorkspaceTasksChangedEvent>(
    "workspace:tasks-changed",
    function* (data) {
      const workspaceId = data?.workspaceId as string | undefined;
      if (!workspaceId) return;

      // Only refresh workspaces whose task state is in use (loaded or loading).
      const initialized = yield* selectWorkspaceTasksInitialized.effect(workspaceId);
      const loading = yield* selectWorkspaceTasksLoading.effect(workspaceId);
      if (!initialized && !loading) return;

      yield* put(loadWorkspaceTasksRequested(workspaceId));
    }
  );
}

export function* watchTaskStatusChangedSaga() {
  yield* takeEveryFromListenSync<TaskStatusChangedPayload>(
    "task:status-changed",
    function* (data) {
      const workspaceId = typeof data?.workspaceId === "string" ? data.workspaceId : undefined;
      const taskId = typeof data?.noteId === "string" ? data.noteId : undefined;
      const newStatus = asTaskStatus(data?.newStatus);
      if (!workspaceId || !taskId || !newStatus) return;

      yield* put(applyTaskStatusChanged(workspaceId, taskId, newStatus));
    }
  );
}

export function* workspaceTasksSaga() {
  yield* fork(watchLoadWorkspaceTasksRequestedSaga);
  yield* fork(watchEnsureWorkspaceTasksLoadedSaga);
  yield* fork(watchWorkspaceMountedSaga);
  yield* fork(watchWorkspaceTasksChangedSaga);
  yield* fork(watchTaskStatusChangedSaga);
}


import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$store/renderer/utils/safe-local-storage-saga";
import {
  call,
  cancelled,
  delay,
  fork,
  put,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  cleanupRecency,
  loadRecencyData,
  loadWorkspacesRequested,
  recordWorkspaceView,
  replaceWorkspaceList,
  setWorkspaceError,
  setWorkspaceHasLoaded,
  setWorkspaceLoading,
  type WorkspaceRecencyState,
} from "../workspace-slice";
import {
  selectWorkspaceIsCreating,
  selectWorkspaceRecency,
} from "../workspace-selectors";
import { workspaceCrudSaga } from "./workspace-crud-saga";
import { workspaceIpcSaga } from "./workspace-ipc-saga";

export const WORKSPACE_RECENCY_STORAGE_KEY = "workspace-recency";
export const WORKSPACE_LOAD_MAX_RETRIES = 2;
export const WORKSPACE_LOAD_RETRY_DELAY_MS = 1000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isWorkspaceRecencyState(value: unknown): value is WorkspaceRecencyState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const lastViewedAt = (value as { lastViewedAt?: unknown }).lastViewedAt;
  if (!lastViewedAt || typeof lastViewedAt !== "object" || Array.isArray(lastViewedAt)) {
    return false;
  }

  return Object.values(lastViewedAt).every((timestamp) => {
    return typeof timestamp === "number" && Number.isFinite(timestamp);
  });
}

export function* initializeWorkspaceRecencySaga() {
  const recency = yield* call(
    getLocalStorageJSON<WorkspaceRecencyState>,
    WORKSPACE_RECENCY_STORAGE_KEY
  );

  if (!isWorkspaceRecencyState(recency)) {
    return;
  }

  yield* put(loadRecencyData(recency));
}

export function* persistWorkspaceRecency() {
  const recency = yield* selectWorkspaceRecency.effect();
  yield* call(setLocalStorageJSON, WORKSPACE_RECENCY_STORAGE_KEY, recency);
}

export function* watchWorkspaceRecencyPersistenceSaga() {
  yield* takeEvery([recordWorkspaceView, cleanupRecency], persistWorkspaceRecency);
}

export function* performLoadWorkspaces(retryCount = 0): SagaGenerator<void> {
  yield* put(setWorkspaceLoading(true));
  if (retryCount === 0) {
    yield* put(setWorkspaceError(null));
  }

  try {
    const result = yield* call([workspaceClient, workspaceClient.list], { lite: true });

    if (result.ok) {
      yield* put(replaceWorkspaceList(result.data));
      yield* put(setWorkspaceHasLoaded(true));
      yield* put(setWorkspaceError(null));
      return;
    }

    if (retryCount < WORKSPACE_LOAD_MAX_RETRIES) {
      yield* delay(WORKSPACE_LOAD_RETRY_DELAY_MS);
      yield* call(performLoadWorkspaces, retryCount + 1);
      return;
    }

    yield* put(setWorkspaceError(result.error));
  } catch (error) {
    if (retryCount < WORKSPACE_LOAD_MAX_RETRIES) {
      yield* delay(WORKSPACE_LOAD_RETRY_DELAY_MS);
      yield* call(performLoadWorkspaces, retryCount + 1);
      return;
    }

    yield* put(setWorkspaceError(getErrorMessage(error)));
  } finally {
    if (!(yield* cancelled())) {
      yield* put(setWorkspaceLoading(false));
    }
  }
}

export function* handleLoadWorkspaces(action: ReturnType<typeof loadWorkspacesRequested>) {
  const [retryCount = 0] = action.payload;
  const isCreating = yield* selectWorkspaceIsCreating.effect();
  if (isCreating) {
    return;
  }

  yield* call(performLoadWorkspaces, retryCount);
}

export function* watchWorkspaceLoadRequestsSaga() {
  yield* takeLatest(loadWorkspacesRequested, handleLoadWorkspaces);
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* workspaceSaga() {
  yield* fork(workspaceIpcSaga);
  yield* fork(workspaceCrudSaga);
  yield* fork(watchWorkspaceLoadRequestsSaga);
  yield* fork(initializeWorkspaceRecencySaga);
  yield* fork(watchWorkspaceRecencyPersistenceSaga);
}

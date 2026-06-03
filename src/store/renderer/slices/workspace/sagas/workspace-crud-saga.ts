import { removeWorkspaceAgentState } from "../../workspace-agents/workspace-agents-slice";
import { cleanupPRStatusWorkspace } from "$store/renderer/slices/pr-status/pr-status-slice";
import { clearWorkspaceTransientUi } from "$store/renderer/slices/transient-ui/transient-ui-slice";
import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import { workspaceStorageManager } from "$store/renderer/slices/workspace/utils/workspace-storage-manager";
import { track } from "$lib/services/analytics";
import { invalidateAgentCache } from "$lib/utils/agent-loader";
import type { CreateWorkspaceRequest } from "$shared/types";

import { WorkspaceId } from "$shared/types/branded-ids";
import {
  call,
  delay,
  fork,
  put,
  takeEvery,
} from "typed-redux-saga";
import { workspaceUnmounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  clearPendingCreation,
  clearWorkspacePendingDeletion,
  createWorkspaceRequested,
  deleteWorkspaceRequested,
  duplicateWorkspaceRequested,
  loadWorkspacesRequested,
  markWorkspacePendingDeletion,
  openWorkspaceRequested,
  removeWorkspaceEntity,
  setActiveWorkspaceId,
  setPendingCreation,
  setWorkspaceCreating,
  setWorkspaceEntity,
  setWorkspaceError,
  setWorkspaceLoading,
  updateWorkspaceRequested,
} from "../workspace-slice";
import { selectWorkspaceById as selectWorkspaceEntityById } from "../workspace-selectors";

export const WORKSPACE_REFRESH_DELAY_MS = 500;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getWorkspaceWorkMode(request: CreateWorkspaceRequest) {
  const workMode = request.initialAgent?.metadata?.workMode;
  return workMode === "team" || workMode === "single" ? workMode : undefined;
}

function* scheduleWorkspaceRefresh() {
  yield* delay(WORKSPACE_REFRESH_DELAY_MS);
  yield* put(loadWorkspacesRequested());
}

export function* handleCreateWorkspace(action: ReturnType<typeof createWorkspaceRequested>) {
  const [request] = action.payload;

  yield* put(setWorkspaceLoading(true));
  yield* put(setWorkspaceError(null));
  yield* put(setWorkspaceCreating(true));

  let succeeded = false;
  try {
    const result = yield* call([workspaceClient, workspaceClient.create], request);
    if (!result.ok) {
      yield* put(setWorkspaceError(result.error));
      return;
    }

    yield* put(setPendingCreation(result.data));
    yield* put(setWorkspaceEntity(result.data));
    yield* put(setActiveWorkspaceId(result.data.id));
    yield* call(() =>
      track("Created Workspace", {
        workspace_id: result.data.id,
        workspace_title: result.data.title,
        is_remote: request.environmentConfig?.type === "remote" || false,
        from_template: false,
        work_mode: getWorkspaceWorkMode(request),
        has_initial_prompt: !!request.initialAgent?.prompt
      })
    );
    succeeded = true;
  } catch (error) {
    yield* put(setWorkspaceError(getErrorMessage(error)));
  } finally {
    yield* put(setWorkspaceLoading(false));
    yield* put(setWorkspaceCreating(false));
    if (succeeded) {
      yield* fork(scheduleWorkspaceRefresh);
    }
  }
}

export function* handleOpenWorkspace(action: ReturnType<typeof openWorkspaceRequested>) {
  const [wsId] = action.payload;

  yield* put(setWorkspaceLoading(true));
  yield* put(setWorkspaceError(null));

  try {
    const result = yield* call([workspaceClient, workspaceClient.open], WorkspaceId(wsId));
    if (!result.ok) {
      yield* put(setWorkspaceError(result.error));
      return;
    }

    yield* put(setWorkspaceEntity(result.data));
    yield* put(setActiveWorkspaceId(result.data.id));
  } catch (error) {
    yield* put(setWorkspaceError(getErrorMessage(error)));
  } finally {
    yield* put(setWorkspaceLoading(false));
  }
}

export function* handleUpdateWorkspace(action: ReturnType<typeof updateWorkspaceRequested>) {
  const [wsId, changes] = action.payload;
  const existing = yield* selectWorkspaceEntityById.effect(wsId);

  const result = yield* call([workspaceClient, workspaceClient.update], {
    id: WorkspaceId(wsId),
    ...changes,
  });
  if (!result.ok) {
    return;
  }

  yield* put(setWorkspaceEntity(result.data));

  if (
    existing &&
    "title" in changes &&
    changes.title !== undefined &&
    changes.title !== existing.title
  ) {
    yield* call(() => track("Renamed Workspace", { workspace_id: wsId }));
  }
}

export function* handleDuplicateWorkspace(action: ReturnType<typeof duplicateWorkspaceRequested>) {
  const [wsId, newTitle] = action.payload;

  yield* put(setWorkspaceCreating(true));

  let succeeded = false;
  try {
    const result = yield* call(
      [workspaceClient, workspaceClient.duplicate],
      WorkspaceId(wsId),
      newTitle
    );
    if (!result.ok) {
      yield* put(setWorkspaceError(result.error));
      return;
    }

    yield* put(setPendingCreation(result.data));
    yield* put(setWorkspaceEntity(result.data));
    succeeded = true;
  } finally {
    yield* put(setWorkspaceCreating(false));
    if (succeeded) {
      yield* fork(scheduleWorkspaceRefresh);
    }
  }
}

export function* handleDeleteWorkspace(action: ReturnType<typeof deleteWorkspaceRequested>) {
  const [wsId] = action.payload;
  const existing = yield* selectWorkspaceEntityById.effect(wsId);

  yield* put(markWorkspacePendingDeletion(wsId));

  try {
    const result = yield* call([workspaceClient, workspaceClient.delete], WorkspaceId(wsId));
    if (!result.ok) {
      return;
    }

    yield* put(cleanupPRStatusWorkspace(wsId));
    yield* call(invalidateAgentCache, wsId);
    yield* put(removeWorkspaceAgentState(wsId));
    yield* put(workspaceUnmounted(wsId));

    try {
      yield* put(clearWorkspaceTransientUi(wsId));

      yield* call([workspaceStorageManager, workspaceStorageManager.clearState], wsId);
    } catch {
      // Best effort only — do not fail deletion after backend success.
    }

    yield* put(removeWorkspaceEntity(wsId));
    yield* put(clearPendingCreation(wsId));
    yield* call(() =>
      track("Deleted Workspace", {
        workspace_id: wsId,
        workspace_title: existing?.title ?? "Unknown",
      })
    );
  } finally {
    yield* put(clearWorkspacePendingDeletion(wsId));
  }
}

export function* watchWorkspaceRequestSaga() {
  yield* takeEvery(createWorkspaceRequested, handleCreateWorkspace);
  yield* takeEvery(openWorkspaceRequested, handleOpenWorkspace);
  yield* takeEvery(updateWorkspaceRequested, handleUpdateWorkspace);
  yield* takeEvery(duplicateWorkspaceRequested, handleDuplicateWorkspace);
  yield* takeEvery(deleteWorkspaceRequested, handleDeleteWorkspace);
}

export function* workspaceCrudSaga() {
  yield* fork(watchWorkspaceRequestSaga);
}
import { workspaceClient } from "$lib/store/slices/workspace/utils/workspace.client";
import { getReduxStore } from "$lib/store/redux-dispatch-bridge";
import {
  takeEveryFromElectronChannel,
  takeEveryFromListenSync,
} from "$lib/store/utils/ipc-channel";
import { WorkspaceId } from "$shared/types/branded-ids";
import { call, delay, fork, put } from "typed-redux-saga";
import type {
  OptimisticTaskStatusPayload,
  WorkspaceBackgroundEnrichmentEvent,
  WorkspaceUpdatedEvent,
} from "../workspace-slice";
import { applyOptimisticTaskStatusUpdate, updateWorkspaceEntity } from "../workspace-slice";
import { selectWorkspacePendingDeletions } from "../workspace-selectors";

export const WORKSPACE_BEFORE_UNLOAD_POLL_MS = 60_000;

function registerBeforeUnloadFlush(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("beforeunload", handler);
  return () => {
    window.removeEventListener("beforeunload", handler);
  };
}

function flushPendingWorkspaceDeletions(): void {
  const pendingDeletions = selectWorkspacePendingDeletions.select(getReduxStore().getState());
  for (const wsId of Object.keys(pendingDeletions)) {
    void workspaceClient.delete(WorkspaceId(wsId));
  }
}

export function* watchWorkspaceUpdatedSaga() {
  yield* takeEveryFromListenSync<WorkspaceUpdatedEvent>("workspace:updated", function* (data) {
    yield* put(updateWorkspaceEntity(data.workspaceId, data.changes));
  });
}

export function* watchWorkspaceBackgroundEnrichmentSaga() {
  yield* takeEveryFromElectronChannel<WorkspaceBackgroundEnrichmentEvent>(
    "workspace:background-enrichment-complete",
    function* (data) {
      if (!data.workspaceId || !data.updates) {
        return;
      }

      yield* put(updateWorkspaceEntity(data.workspaceId, data.updates));
    }
  );
}

export function* watchTaskStatusChangedSaga() {
  yield* takeEveryFromListenSync<OptimisticTaskStatusPayload>("task:status-changed", function* (data) {
    yield* put(applyOptimisticTaskStatusUpdate(data));
  });
}

export function* watchWorkspaceBeforeUnloadSaga() {
  const removeListener: () => void = yield* call(registerBeforeUnloadFlush, () => {
    flushPendingWorkspaceDeletions();
  });

  try {
    while (true) {
      yield* delay(WORKSPACE_BEFORE_UNLOAD_POLL_MS);
    }
  } finally {
    yield* call(removeListener);
  }
}

export function* workspaceIpcSaga() {
  yield* fork(watchWorkspaceUpdatedSaga);
  yield* fork(watchWorkspaceBackgroundEnrichmentSaga);
  yield* fork(watchTaskStatusChangedSaga);
  yield* fork(watchWorkspaceBeforeUnloadSaga);
}
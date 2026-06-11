import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import {
  takeEveryFromElectronChannel,
  takeEveryFromListenSync,
} from "$store/renderer/utils/ipc-channel";
import { takeLatestFromSelector } from "ag-redux-toolkit/utils/sagas/selector-channel-effects";
import { WorkspaceId } from "$shared/types/branded-ids";
import type { Workspace } from "$shared/types";
import { WorkspaceStatusEnum } from "$shared/types";
import {
  call,
  delay,
  fork,
  put,
  takeEvery,
} from "typed-redux-saga";
import { selectAllRetainedAgentSessions } from "../../agent-session/agent-session-selectors";
import { selectWorkspaceHasActiveSubscriptions } from "../../agent-subscription-ui/agent-subscription-ui-selectors";
import { selectIsWorkspaceTabOpen } from "../../tab-state/tab-state-selectors";
import type {
  WorkspaceArchivedEvent,
  WorkspaceBackgroundEnrichmentEvent,
  WorkspaceCreatedEvent,
  WorkspaceDeletedEvent,
  WorkspaceUpdatedEvent,
} from "../workspace-slice";
import {
  clearPendingCreation,
  removeWorkspaceEntity,
  setPendingCreation,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from "../workspace-slice";
import {
  selectActiveWorkspaceId,
  selectWorkspacePendingDeletions,
} from "../workspace-selectors";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";

export const WORKSPACE_BEFORE_UNLOAD_POLL_MS = 60_000;

const coalescedInactiveWorkspaceUpdates = new Map<string, Partial<Workspace>>();
const mountedWorkspaceIds = new Set<string>();

function coalesceInactiveWorkspaceUpdate(wsId: string, changes: Partial<Workspace>): void {
  const existing = coalescedInactiveWorkspaceUpdates.get(wsId) ?? {};
  coalescedInactiveWorkspaceUpdates.set(wsId, { ...existing, ...changes });
}

function* isWorkspaceOfInterest(wsId: string) {
  const activeWorkspaceId = yield* selectActiveWorkspaceId.effect();
  if (activeWorkspaceId === wsId || mountedWorkspaceIds.has(wsId)) {
    return true;
  }

  if (yield* selectIsWorkspaceTabOpen.effect(wsId)) {
    return true;
  }

  if (yield* selectWorkspaceHasActiveSubscriptions.effect(wsId)) {
    return true;
  }

  const retainedAgents = yield* selectAllRetainedAgentSessions.effect();
  return retainedAgents.some((agent) => String(agent.workspaceId) === wsId);
}

export function __resetWorkspaceIpcCoalescingForTesting(): void {
  coalescedInactiveWorkspaceUpdates.clear();
  mountedWorkspaceIds.clear();
}

/** @internal Exported for focused saga tests. */
export function* flushCoalescedWorkspaceUpdateOnMountSaga(
  action: ReturnType<typeof workspaceMounted>,
) {
  const [wsId] = action.payload;
  mountedWorkspaceIds.add(wsId);
  const changes = coalescedInactiveWorkspaceUpdates.get(wsId);
  if (!changes) {
    return;
  }

  coalescedInactiveWorkspaceUpdates.delete(wsId);
  yield* put(updateWorkspaceEntity(wsId, changes));
}

export function* clearMountedWorkspaceInterestOnUnmountSaga(
  action: ReturnType<typeof workspaceUnmounted>,
) {
  const [wsId] = action.payload;
  mountedWorkspaceIds.delete(wsId);
}

function registerBeforeUnloadFlush(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("beforeunload", handler);
  return () => {
    window.removeEventListener("beforeunload", handler);
  };
}

export function* watchWorkspaceUpdatedSaga() {
  yield* takeEveryFromListenSync<WorkspaceUpdatedEvent>("workspace:updated", function* (data) {
    if (!data.workspaceId) {
      return;
    }

    if (!(yield* isWorkspaceOfInterest(data.workspaceId))) {
      coalesceInactiveWorkspaceUpdate(data.workspaceId, data.changes);
      return;
    }

    yield* put(updateWorkspaceEntity(data.workspaceId, data.changes));
  });
}

export function* watchWorkspaceCreatedSaga() {
  yield* takeEveryFromListenSync<WorkspaceCreatedEvent>("workspace:created", function* (data) {
    if (!data.workspaceId || !data.workspace) {
      return;
    }

    // Mirror workspace-crud-saga: the pendingCreations entry protects the new
    // entity from stale replaceWorkspaceList payloads and is cleared once a
    // fetched list contains the workspace. Both actions are idempotent for the
    // originating window, which already dispatched them.
    yield* put(setPendingCreation(data.workspace));
    yield* put(setWorkspaceEntity(data.workspace));
  });
}

export function* watchWorkspaceDeletedSaga() {
  yield* takeEveryFromListenSync<WorkspaceDeletedEvent>("workspace:deleted", function* (data) {
    if (!data.workspaceId) {
      return;
    }

    yield* put(removeWorkspaceEntity(data.workspaceId));
    yield* put(clearPendingCreation(data.workspaceId));
  });
}

export function* watchWorkspaceArchivedSaga() {
  yield* takeEveryFromListenSync<WorkspaceArchivedEvent>("workspace:archived", function* (data) {
    if (!data.workspaceId) {
      return;
    }

    // Mark instead of remove, matching replaceWorkspaceList's pendingArchives
    // handling; archived-aware views filter on status.
    yield* put(
      updateWorkspaceEntity(data.workspaceId, {
        status: WorkspaceStatusEnum.Archived,
        archived: true,
      }),
    );
  });
}

export function* watchWorkspaceBackgroundEnrichmentSaga() {
  yield* takeEveryFromElectronChannel<WorkspaceBackgroundEnrichmentEvent>(
    "workspace:background-enrichment-complete",
    function* (data) {
      if (!data.workspaceId || !data.updates) {
        return;
      }

      if (!(yield* isWorkspaceOfInterest(data.workspaceId))) {
        coalesceInactiveWorkspaceUpdate(data.workspaceId, data.updates);
        return;
      }

      yield* put(updateWorkspaceEntity(data.workspaceId, data.updates));
    }
  );
}

export function* watchCoalescedWorkspaceUpdatesOnMountSaga() {
  yield* takeEvery(workspaceMounted, flushCoalescedWorkspaceUpdateOnMountSaga);
}

export function* watchMountedWorkspaceInterestCleanupSaga() {
  yield* takeEvery(workspaceUnmounted, clearMountedWorkspaceInterestOnUnmountSaga);
}

export function* watchWorkspaceBeforeUnloadSaga() {
  // Capture the latest pending deletions in a closure so the beforeunload
  // handler (a non-saga callback) can read them without calling .select().
  // Initial snapshot, then keep updated via selector channel.
  let latestPendingDeletions = yield* selectWorkspacePendingDeletions.effect();

  yield* takeLatestFromSelector<Record<string, boolean>>(selectWorkspacePendingDeletions, function* ({ payload }) {
    latestPendingDeletions = payload;
  });

  const removeListener: () => void = yield* call(registerBeforeUnloadFlush, () => {
    for (const wsId of Object.keys(latestPendingDeletions)) {
      void workspaceClient.delete(WorkspaceId(wsId));
    }
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
  yield* fork(watchWorkspaceCreatedSaga);
  yield* fork(watchWorkspaceDeletedSaga);
  yield* fork(watchWorkspaceArchivedSaga);
  yield* fork(watchWorkspaceBackgroundEnrichmentSaga);
  yield* fork(watchCoalescedWorkspaceUpdatesOnMountSaga);
  yield* fork(watchMountedWorkspaceInterestCleanupSaga);
  yield* fork(watchWorkspaceBeforeUnloadSaga);
}

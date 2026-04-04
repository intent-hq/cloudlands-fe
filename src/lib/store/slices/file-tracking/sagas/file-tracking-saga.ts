/**
 * File Tracking Saga
 *
 * Handles:
 * - IPC event listeners (file-tracking:changes-updated, workspace-changes, etc.)
 * - Workspace initialization flow
 */

import { call, put, takeLatest, delay, fork, take, cancel, cancelled, type SagaGenerator } from "typed-redux-saga";
import type { Task } from "redux-saga";
import { invokeWithTimeout, IpcTimeoutError } from "$lib/electron-bridge";
import { Logger } from "$lib/utils/logger";
import { TRACKING_CONFIG } from "$features/file-tracking/tracking.config";
import {
  initWorkspace,
  setLoading,
  setError,
  setHasLoadedInitialData,
} from "../file-tracking-slice";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import { createElectronChannel } from "$lib/store/utils/ipc-channel";
import {
  doSyncWithGit,
  doLoadWorkspaceData,
  resetTrackingState,
  fileTrackingOperationsSaga,
} from "./file-tracking-operations-saga";

const logger = new Logger({ category: "FileTrackingSaga" });

const IPC_INIT_TIMEOUT_MS = 10000;
const config = TRACKING_CONFIG.fileTracking;

// ---------------------------------------------------------------------------
// IPC Listener Sagas
// ---------------------------------------------------------------------------

type FileTrackingEvent = {
  workspaceId: string;
  changeCount?: number;
  source?: string;
  filePath?: string;
};

function* watchChangesUpdated(wsId: string): SagaGenerator<void> {
  const channel = createElectronChannel<FileTrackingEvent>("file-tracking:changes-updated");
  try {
    while (true) {
      const data = yield* take(channel);
      if (data.workspaceId !== wsId) continue;
      yield* delay(config.updateDebounce);
      yield* call(doLoadWorkspaceData, wsId);
    }
  } finally {
    if (yield* cancelled()) channel.close();
  }
}

function* watchAgentFileChanged(wsId: string): SagaGenerator<void> {
  const channel = createElectronChannel<FileTrackingEvent>("file-tracking:agent-file-changed");
  try {
    while (true) {
      const data = yield* take(channel);
      if (data.workspaceId !== wsId) continue;
      yield* delay(50);
      yield* call(doSyncWithGit, wsId, true);
      yield* call(doLoadWorkspaceData, wsId);
    }
  } finally {
    if (yield* cancelled()) channel.close();
  }
}

function* watchWorkspaceChanges(wsId: string): SagaGenerator<void> {
  const channel = createElectronChannel<{ workspaceId?: string }>("workspace-changes");
  try {
    while (true) {
      const data = yield* take(channel);
      if (data.workspaceId !== wsId) continue;
      yield* delay(config.updateDebounce);
      yield* call(doLoadWorkspaceData, wsId);
    }
  } finally {
    if (yield* cancelled()) channel.close();
  }
}

function* watchGitStatusChanged(wsId: string): SagaGenerator<void> {
  const channel = createElectronChannel<{ workspaceId?: string }>("git:status-changed");
  try {
    while (true) {
      const data = yield* take(channel);
      if (data.workspaceId !== wsId) continue;
      yield* delay(config.updateDebounce);
      yield* call(doLoadWorkspaceData, wsId);
    }
  } finally {
    if (yield* cancelled()) channel.close();
  }
}

// ---------------------------------------------------------------------------
// Workspace initialization
// ---------------------------------------------------------------------------

function* handleInitWorkspace(action: ReturnType<typeof initWorkspace>): SagaGenerator<void> {
  const wsId = action.payload[0];
  logger.info("[FileTrackingSaga] initWorkspace", { wsId });

  yield* put(setLoading(wsId, true));
  yield* put(setError(wsId, null));

  // Reset module-level tracking state
  yield* call(resetTrackingState);

  try {
    // Initialize file tracking backend
    try {
      const result = (yield* call(
        invokeWithTimeout,
        "file-tracking:init",
        { workspaceId: wsId },
        IPC_INIT_TIMEOUT_MS
      )) as { success?: boolean; error?: string } | null;
      if (result && !result.success) {
        logger.warn("File tracking backend init failed", { wsId, error: result.error });
      }
    } catch (error) {
      if (error instanceof IpcTimeoutError) {
        logger.warn("File tracking init timed out, continuing...", { wsId });
      } else {
        logger.error("Failed to init file tracking backend", error as Error, { wsId });
      }
    }

    // Check workspace hasn't changed
    const currentWsId = yield* selectActiveWorkspaceId.effect();
    if (currentWsId !== wsId) return;

    yield* call(doSyncWithGit, wsId, false);
    const currentWsId2 = yield* selectActiveWorkspaceId.effect();
    if (currentWsId2 !== wsId) return;

    yield* call(doLoadWorkspaceData, wsId);
    const currentWsId3 = yield* selectActiveWorkspaceId.effect();
    if (currentWsId3 !== wsId) return;

    yield* put(setHasLoadedInitialData(wsId, true));
    yield* put(setLoading(wsId, false));
  } catch (error) {
    logger.error("[FileTrackingSaga] Unexpected init error", error as Error, { wsId });
    const currentWsId = yield* selectActiveWorkspaceId.effect();
    if (currentWsId === wsId) {
      yield* put(setHasLoadedInitialData(wsId, true));
      yield* put(setLoading(wsId, false));
      yield* put(setError(wsId, error instanceof Error ? error.message : "Failed to initialize"));
    }
  }
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* fileTrackingSaga(): SagaGenerator<void> {
  // Fork the operations saga to handle all operation request actions
  yield* fork(fileTrackingOperationsSaga);

  // Watch for workspace init and set up listeners
  let listenerTask: Task | null = null;

  yield* takeLatest(initWorkspace, function* (action) {
    // Cancel previous listeners
    if (listenerTask) {
      yield* cancel(listenerTask);
    }

    // Run initialization
    yield* call(handleInitWorkspace, action);

    const wsId = action.payload[0];
    const currentWsId = yield* selectActiveWorkspaceId.effect();
    if (currentWsId !== wsId) return;

    // Fork IPC listeners for this workspace
    listenerTask = (yield* fork(function* () {
      yield* fork(watchChangesUpdated, wsId);
      yield* fork(watchAgentFileChanged, wsId);
      yield* fork(watchWorkspaceChanges, wsId);
      yield* fork(watchGitStatusChanged, wsId);
    })) as unknown as Task;
  });
}


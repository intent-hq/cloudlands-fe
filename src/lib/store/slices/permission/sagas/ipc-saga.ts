import { call, put, take } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { createLogger } from "$lib/utils/client-logger";
import {
  permissionRequestReceived,
  setPendingRequests,
  type PermissionRequest,
} from "../permission-slice";

const logger = createLogger("PermissionSaga");

/**
 * Fetch pending permission requests from main process on startup.
 * Handles page refresh recovery.
 */
export function* fetchPendingRequestsSaga() {
  try {
    const result: { success: boolean; requests: PermissionRequest[] } = yield* call(
      invoke<{ success: boolean; requests: PermissionRequest[] }>,
      IPC_CHANNELS.PERMISSION.GET_PENDING,
    );
    if (result.success && result.requests && result.requests.length > 0) {
      logger.info("Recovered pending permission requests after page refresh", {
        count: result.requests.length,
      });
      yield* put(setPendingRequests(result.requests));
    }
  } catch (error) {
    logger.error("Failed to fetch pending permission requests", { error });
  }
}

/**
 * IPC listener saga: listen for incoming permission requests via eventChannel.
 * Uses createListenSyncChannel to bridge IPC events into the saga world.
 */
export function* watchPermissionEventsSaga() {
  if (typeof window === "undefined") return;

  const channel = createListenSyncChannel<PermissionRequest>(
    IPC_CHANNELS.PERMISSION.EVENT,
  );

  try {
    while (true) {
      const request: PermissionRequest = yield* take(channel);
      logger.info("Received permission request", {
        requestId: request.requestId,
        sessionId: request.sessionId,
        title: request.title,
      });
      yield* put(permissionRequestReceived(request));
    }
  } finally {
    channel.close();
  }
}

/**
 * Root IPC saga: fetches pending requests on startup, then watches for new ones.
 */
export function* ipcPermissionSaga() {
  yield* call(fetchPendingRequestsSaga);
  yield* call(watchPermissionEventsSaga);
}


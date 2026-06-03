import {
  call,
  put,
} from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { takeEveryFromListenSync } from "$store/renderer/utils/ipc-channel";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import {
  permissionRequestReceived,
  setPendingRequests,
  type PermissionRequest,
} from "../permission-slice";

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
      yield* put(setPendingRequests(result.requests));
    }
  } catch {
  }
}

/**
 * IPC listener saga: listen for incoming permission requests via eventChannel.
 * Uses createListenSyncChannel to bridge IPC events into the saga world.
 */
export function* watchPermissionEventsSaga() {
  if (typeof window === "undefined") return;

  yield* takeEveryFromListenSync<PermissionRequest>(IPC_CHANNELS.PERMISSION.EVENT, function* (request) {
      yield* put(permissionRequestReceived(request));
    });
}

/**
 * Root IPC saga: fetches pending requests on startup, then watches for new ones.
 */
export function* ipcPermissionSaga() {
  yield* call(fetchPendingRequestsSaga);
  yield* call(watchPermissionEventsSaga);
}


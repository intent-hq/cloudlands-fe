import { call, fork } from "typed-redux-saga";
import { initZoomSaga } from "./init-saga";
import { ipcZoomSaga } from "./ipc-saga";
import { resizeZoomSaga } from "./resize-saga";

/**
 * Root saga for zoom state management.
 * Initializes zoom factor, then forks IPC and resize listeners.
 */
export function* zoomSaga() {
  // Fetch initial zoom factor
  yield* call(initZoomSaga);

  // Fork long-running listeners
  yield* fork(ipcZoomSaga);
  yield* fork(resizeZoomSaga);
}


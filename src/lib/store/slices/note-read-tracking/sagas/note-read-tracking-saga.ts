import { fork } from "typed-redux-saga";
import { ipcSaga } from "./ipc-saga";
import { refreshSaga } from "./refresh-saga";

/**
 * Root saga for note read tracking.
 * Forks IPC and debounced refresh sagas.
 */
export function* noteReadTrackingSaga() {
  yield* fork(ipcSaga);
  yield* fork(refreshSaga);
}


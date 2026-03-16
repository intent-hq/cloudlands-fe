import { fork } from "typed-redux-saga";
import { ipcPermissionSaga } from "./ipc-saga";
import { respondPermissionSaga } from "./respond-saga";

/**
 * Root saga for permission slice.
 * Forks IPC listener and respond handler sagas.
 */
export function* permissionSaga() {
  yield* fork(ipcPermissionSaga);
  yield* fork(respondPermissionSaga);
}


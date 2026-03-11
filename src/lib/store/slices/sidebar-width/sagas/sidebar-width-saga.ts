import { call, fork } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";
import { eventSaga } from "./event-saga";

/**
 * Root saga for sidebar width management.
 * Forks initialization, persistence, and event sagas.
 */
export function* sidebarWidthSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
  yield* fork(eventSaga);
}


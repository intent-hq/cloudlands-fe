import { call, fork } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for tab scroll position management.
 * Forks initialization and persistence sagas.
 */
export function* tabScrollSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
}


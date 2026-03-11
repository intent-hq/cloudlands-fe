import { call, fork } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for open action management.
 * Forks initialization and persistence sagas.
 */
export function* openActionSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
}


import { call, fork } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for note font settings management.
 * Forks initialization and persistence sagas.
 */
export function* noteFontSettingsSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
}


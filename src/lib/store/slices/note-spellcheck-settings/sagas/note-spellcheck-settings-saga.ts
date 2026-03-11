import { call, fork } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for note spellcheck settings management.
 * Forks initialization and persistence sagas.
 */
export function* noteSpellcheckSettingsSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
}


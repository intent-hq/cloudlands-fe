import { call, fork } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for editor settings management.
 * Forks initialization and persistence sagas.
 */
export function* editorSettingsSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
}


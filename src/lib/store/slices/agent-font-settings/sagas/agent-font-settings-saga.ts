import { call, fork } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for agent font settings management.
 * Forks initialization and persistence sagas.
 */
export function* agentFontSettingsSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
}


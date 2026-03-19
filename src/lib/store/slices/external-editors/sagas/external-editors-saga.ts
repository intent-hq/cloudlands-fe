import { call, fork } from "typed-redux-saga";
import { fetchEditorsSaga } from "./fetch-editors-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for external editor management.
 * Initializes the selected action, persists updates, and manages editor detection.
 */
export function* externalEditorsSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
  yield* fork(fetchEditorsSaga);
}
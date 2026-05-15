import {
  fork,
  join,
} from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";
import { syncSaga } from "./sync-saga";

/**
 * Root saga for workspace settings management.
 * Forks initialization, persistence, and sync sagas.
 */
export function* workspaceSettingsSaga() {
  const initTask = yield* fork(initSaga);
  yield* fork(persistenceSaga);
  yield* fork(syncSaga, initTask);
  yield* join(initTask);
}


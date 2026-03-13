import { fork, join } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for notification settings management.
 * Forks initialization and persistence sagas.
 */
export function* notificationSettingsSaga() {
  const initTask = yield* fork(initSaga);
  yield* fork(persistenceSaga);
  yield* join(initTask);
}


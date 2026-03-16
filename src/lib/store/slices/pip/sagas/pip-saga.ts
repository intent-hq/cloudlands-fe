import { fork } from "typed-redux-saga";
import { watchPipOpenedSaga, watchPipClosedSaga } from "./ipc-saga";
import { pipActionsSaga } from "./pip-actions-saga";

/**
 * Root saga for pip slice.
 * Forks IPC listeners and action handler sagas.
 */
export function* pipSaga() {
  yield* fork(watchPipOpenedSaga);
  yield* fork(watchPipClosedSaga);
  yield* fork(pipActionsSaga);
}


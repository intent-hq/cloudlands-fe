import { fork } from "typed-redux-saga";
import { featureCodesFetchSaga } from "./fetch-saga";

/**
 * Root saga for feature-codes slice.
 * Forks the fetch saga which handles init, refresh, and deactivate via IPC.
 */
export function* featureCodesSaga() {
  yield* fork(featureCodesFetchSaga);
}


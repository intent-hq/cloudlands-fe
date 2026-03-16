import { fork } from "typed-redux-saga";
import { fetchEditorsSaga } from "./fetch-editors-saga";

/**
 * Root saga for installed-editors slice.
 * Forks the fetch editors saga which handles IPC + localStorage caching.
 */
export function* installedEditorsSaga() {
  yield* fork(fetchEditorsSaga);
}


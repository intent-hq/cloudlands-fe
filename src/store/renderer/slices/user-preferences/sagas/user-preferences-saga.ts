import {
  call,
  fork,
} from "typed-redux-saga";
import { initUserPreferencesSaga } from "./init-saga";
import { ipcZoomSaga } from "./ipc-saga";
import { persistenceUserPreferencesSaga } from "./persistence-saga";
import { resizeZoomSaga } from "./resize-saga";

export function* userPreferencesSaga() {
  yield* call(initUserPreferencesSaga);
  yield* fork(persistenceUserPreferencesSaga);
  yield* fork(ipcZoomSaga);
  yield* fork(resizeZoomSaga);
}
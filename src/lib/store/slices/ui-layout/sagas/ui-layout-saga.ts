import { call, fork } from "typed-redux-saga";
import { eventSaga } from "./event-saga";
import { initSaga } from "./init-saga";
import { panelVisibilitySaga } from "./panel-visibility-saga";
import { persistenceSaga } from "./persistence-saga";

export function* uiLayoutSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
  yield* fork(eventSaga);
  yield* fork(panelVisibilitySaga);
}
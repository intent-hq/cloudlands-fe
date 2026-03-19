import { call, fork } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

export function* tabStateSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
}
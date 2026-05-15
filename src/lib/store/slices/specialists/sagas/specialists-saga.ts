import {
  call,
  fork,
} from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";
import { fileSpecialistsSaga } from "./file-specialists-saga";
import { providerSwitchSaga } from "./provider-switch-saga";

export function* specialistsSaga() {
  yield* call(initSaga);
  yield* fork(persistenceSaga);
  yield* fork(fileSpecialistsSaga);
  yield* fork(providerSwitchSaga);
}


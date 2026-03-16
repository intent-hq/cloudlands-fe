import { fork } from "typed-redux-saga";
import { loadModelsSaga } from "./load-models-saga";
import { selectModelSaga } from "./select-model-saga";
import { persistenceSaga } from "./persistence-saga";

/**
 * Root saga for model slice.
 * Forks all sub-sagas for model loading, selection, and persistence.
 */
export function* modelSaga() {
  yield* fork(persistenceSaga);
  yield* fork(loadModelsSaga);
  yield* fork(selectModelSaga);
}


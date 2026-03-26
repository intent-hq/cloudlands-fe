import { getLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { call, put, type SagaGenerator } from "typed-redux-saga";
import { loadScrollPositions } from "../tab-state-slice";

const STORAGE_KEY = "tab-scroll-positions";

function* loadFromLocalStorage(): SagaGenerator<Record<string, number>> {
  return (yield* call(getLocalStorageJSON<Record<string, number>>, STORAGE_KEY)) ?? {};
}

export function* initSaga() {
  const positions = yield* call(loadFromLocalStorage);
  yield* put(loadScrollPositions(positions));
}
import { getLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, put, type SagaGenerator } from "typed-redux-saga";
import { loadScrollPositions } from "../tab-state-slice";

const STORAGE_KEY = "tab-scroll-positions";

function* loadFromLocalStorage(): SagaGenerator<Record<string, number>> {
  try {
    const stored = yield* call(getLocalStorageItem, STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }

  return {};
}

export function* initSaga() {
  const positions = yield* call(loadFromLocalStorage);
  yield* put(loadScrollPositions(positions));
}
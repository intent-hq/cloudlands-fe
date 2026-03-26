import { getLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, put, type SagaGenerator } from "typed-redux-saga";
import { setOpenAction } from "../external-editors-slice";

const STORAGE_KEY = "open-combo-button-last-action";
const DEFAULT_ACTION = "vscode";

function* loadFromLocalStorage(): SagaGenerator<string> {
  const stored = yield* call(getLocalStorageItem, STORAGE_KEY);
  if (stored) {
    return stored;
  }
  return DEFAULT_ACTION;
}

/**
 * Loads open action from localStorage on startup.
 */
export function* initSaga() {
  const action = yield* call(loadFromLocalStorage);
  yield* put(setOpenAction(action));
}
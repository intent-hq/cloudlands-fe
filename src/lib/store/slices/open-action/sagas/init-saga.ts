import { call, put } from "typed-redux-saga";
import { loadOpenAction } from "../open-action-slice";

const STORAGE_KEY = "open-combo-button-last-action";
const DEFAULT_ACTION = "vscode";

function loadFromLocalStorage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return stored;
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_ACTION;
}

/**
 * Loads open action from localStorage on startup.
 */
export function* initSaga() {
  const action = yield* call(loadFromLocalStorage);
  yield* put(loadOpenAction(action));
}


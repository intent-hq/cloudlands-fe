import { call, put } from "typed-redux-saga";
import { loadScrollPositions } from "../tab-scroll-slice";

const STORAGE_KEY = "tab-scroll-positions";

function loadFromLocalStorage(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

/**
 * Loads scroll positions from localStorage on startup.
 */
export function* initSaga() {
  const positions = yield* call(loadFromLocalStorage);
  yield* put(loadScrollPositions(positions));
}


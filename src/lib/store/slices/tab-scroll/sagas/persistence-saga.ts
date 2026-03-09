import { call, takeEvery } from "typed-redux-saga";
import {
  saveScrollPosition,
  removeScrollPosition,
  clearForWorkspace,
} from "../tab-scroll-slice";
import { selectAllScrollPositions } from "../tab-scroll-selectors";

const STORAGE_KEY = "tab-scroll-positions";

function persistPositions(positions: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Watches for scroll position changes and persists to localStorage.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    [saveScrollPosition.type, removeScrollPosition.type, clearForWorkspace.type],
    function* () {
      const positions = yield* selectAllScrollPositions.effect();
      yield* call(persistPositions, positions);
    }
  );
}


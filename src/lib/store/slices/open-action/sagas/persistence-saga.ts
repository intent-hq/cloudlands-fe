import { call, takeEvery } from "typed-redux-saga";
import { setOpenAction } from "../open-action-slice";
import { selectOpenAction } from "../open-action-selectors";

const STORAGE_KEY = "open-combo-button-last-action";

function persistAction(action: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, action);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Watches for open action changes and persists to localStorage.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    [setOpenAction.type],
    function* () {
      const action = yield* selectOpenAction.effect();
      yield* call(persistAction, action);
    }
  );
}


import { call, takeEvery } from "typed-redux-saga";
import { setCodeFontFamily } from "../code-font-settings-slice";
import { selectCodeFontFamily } from "../code-font-settings-selectors";

const STORAGE_KEY = "code-font-settings";

function persistFontFamily(fontFamily: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontFamily }));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Watches for font family changes and persists to localStorage.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    setCodeFontFamily.type,
    function* () {
      const fontFamily = yield* selectCodeFontFamily.effect();
      yield* call(persistFontFamily, fontFamily);
    }
  );
}


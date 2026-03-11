import { call, takeEvery } from "typed-redux-saga";
import { setNoteFontStyle, cycleNoteFontStyle } from "../note-font-settings-slice";
import { selectNoteFontStyle } from "../note-font-settings-selectors";

const STORAGE_KEY = "note-font-settings";

function persistFontStyle(fontStyle: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontStyle }));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Watches for font style changes and persists to localStorage.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    [setNoteFontStyle.type, cycleNoteFontStyle.type],
    function* () {
      const fontStyle = yield* selectNoteFontStyle.effect();
      yield* call(persistFontStyle, fontStyle);
    }
  );
}


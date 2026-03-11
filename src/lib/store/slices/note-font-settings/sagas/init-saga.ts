import { call, put } from "typed-redux-saga";
import { setNoteFontStyle, type NoteFontStyle } from "../note-font-settings-slice";

const STORAGE_KEY = "note-font-settings";
const DEFAULT_FONT_STYLE: NoteFontStyle = "sans";

function loadFromLocalStorage(): NoteFontStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.fontStyle === 'sans' || parsed?.fontStyle === 'monospace') {
        return parsed.fontStyle;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_FONT_STYLE;
}

/**
 * Loads note font settings from localStorage on startup.
 */
export function* initSaga() {
  const fontStyle = yield* call(loadFromLocalStorage);
  yield* put(setNoteFontStyle(fontStyle));
}


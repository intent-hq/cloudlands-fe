import { call, put } from "typed-redux-saga";
import { setSpellcheckEnabled } from "../note-spellcheck-settings-slice";

const STORAGE_KEY = "note-spellcheck-settings";

function loadFromLocalStorage(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed?.enabled === 'boolean') {
        return parsed.enabled;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return false;
}

/**
 * Loads note spellcheck settings from localStorage on startup.
 */
export function* initSaga() {
  const enabled = yield* call(loadFromLocalStorage);
  yield* put(setSpellcheckEnabled(enabled));
}


import { call, takeEvery } from "typed-redux-saga";
import { setSpellcheckEnabled, toggleSpellcheck } from "../note-spellcheck-settings-slice";
import { selectSpellcheckEnabled } from "../note-spellcheck-settings-selectors";

const STORAGE_KEY = "note-spellcheck-settings";

function persistSettings(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled }));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Watches for spellcheck setting changes and persists to localStorage.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    [setSpellcheckEnabled.type, toggleSpellcheck.type],
    function* () {
      const enabled = yield* selectSpellcheckEnabled.effect();
      yield* call(persistSettings, enabled);
    }
  );
}


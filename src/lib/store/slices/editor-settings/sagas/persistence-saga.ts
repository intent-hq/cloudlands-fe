import { call, takeEvery } from "typed-redux-saga";
import {
  setLineWrapping,
  setFoldUnchanged,
  setDiffSideBySide,
  setDiffIndicators,
  toggleLineWrapping,
  toggleFoldUnchanged,
  toggleDiffSideBySide,
  toggleDiffIndicators,
} from "../editor-settings-slice";
import {
  selectLineWrapping,
  selectFoldUnchanged,
  selectDiffSideBySide,
  selectDiffIndicators,
} from "../editor-settings-selectors";

const STORAGE_KEY = "editor-settings";

function persistSettings(settings: {
  lineWrapping: boolean;
  foldUnchanged: boolean;
  diffSideBySide: boolean;
  diffIndicators: boolean;
}): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Watches for any editor setting change and persists the entire settings object to localStorage.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    [
      setLineWrapping.type,
      setFoldUnchanged.type,
      setDiffSideBySide.type,
      setDiffIndicators.type,
      toggleLineWrapping.type,
      toggleFoldUnchanged.type,
      toggleDiffSideBySide.type,
      toggleDiffIndicators.type,
    ],
    function* () {
      const lineWrapping = yield* selectLineWrapping.effect();
      const foldUnchanged = yield* selectFoldUnchanged.effect();
      const diffSideBySide = yield* selectDiffSideBySide.effect();
      const diffIndicators = yield* selectDiffIndicators.effect();
      yield* call(persistSettings, {
        lineWrapping,
        foldUnchanged,
        diffSideBySide,
        diffIndicators,
      });
    }
  );
}


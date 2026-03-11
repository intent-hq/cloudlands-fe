import { call, put } from "typed-redux-saga";
import { loadEditorSettings, type EditorSettingsState } from "../editor-settings-slice";

const STORAGE_KEY = "editor-settings";

const defaultSettings: EditorSettingsState = {
  lineWrapping: true,
  foldUnchanged: true,
  diffSideBySide: true,
  diffIndicators: true,
};

function loadFromLocalStorage(): EditorSettingsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return defaultSettings;
}

/**
 * Loads editor settings from localStorage on startup.
 */
export function* initSaga() {
  const settings = yield* call(loadFromLocalStorage);
  yield* put(loadEditorSettings(settings));
}


import {
  getLocalStorageItem,
  getLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import { call, put, type SagaGenerator } from "typed-redux-saga";
import {
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  loadEditorSettings,
  loadSidebarState,
  type UiLayoutState,
} from "../ui-layout-slice";

const EDITOR_SETTINGS_STORAGE_KEY = "editor-settings";
const SIDEBAR_WIDTH_STORAGE_KEY = "workspace-left-panel-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "workspace-left-panel-collapsed";

const defaultEditorSettings: Pick<
  UiLayoutState,
  "lineWrapping" | "foldUnchanged" | "diffSideBySide" | "diffIndicators"
> = {
  lineWrapping: true,
  foldUnchanged: true,
  diffSideBySide: true,
  diffIndicators: true,
};

function percentToPixels(percent: number): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  return (percent / 100) * window.innerWidth;
}

function* loadEditorSettingsFromLocalStorage(): SagaGenerator<typeof defaultEditorSettings> {
  const stored = yield* call(
    getLocalStorageJSON<Partial<typeof defaultEditorSettings>>,
    EDITOR_SETTINGS_STORAGE_KEY
  );
  return stored ? { ...defaultEditorSettings, ...stored } : defaultEditorSettings;
}

function* loadSidebarWidth(): SagaGenerator<number> {
  if (typeof window === "undefined") return DEFAULT_WIDTH;

  const stored = yield* call(getLocalStorageItem, SIDEBAR_WIDTH_STORAGE_KEY);
  if (stored) {
    const value = parseFloat(stored);
    if (!isNaN(value) && value > 0) {
      const pixels = percentToPixels(value);
      if (pixels >= MIN_WIDTH && pixels <= MAX_WIDTH) {
        return Math.round(pixels);
      }
    }
  }

  return DEFAULT_WIDTH;
}

function* loadSidebarCollapsed(): SagaGenerator<boolean> {
  if (typeof window === "undefined") return false;

  const stored = yield* call(getLocalStorageItem, SIDEBAR_COLLAPSED_STORAGE_KEY);
  return stored === "true";
}

export function* initSaga() {
  const editorSettings = yield* call(loadEditorSettingsFromLocalStorage);
  yield* put(loadEditorSettings(editorSettings));

  const sidebarWidth = yield* call(loadSidebarWidth);
  const sidebarCollapsed = yield* call(loadSidebarCollapsed);
  yield* put(loadSidebarState(sidebarWidth, sidebarCollapsed));
}
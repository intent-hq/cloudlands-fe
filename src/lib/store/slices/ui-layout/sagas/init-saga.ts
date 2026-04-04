import {
  getLocalStorageItem,
  getLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import { call, put, type SagaGenerator } from "typed-redux-saga";
import {
  DEFAULT_DOCK_HEIGHT,
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  SPACES_SIDEBAR_DEFAULT_WIDTH,
  loadBottomDockState,
  loadEditorSettings,
  loadLayoutSettings,
  loadSidebarState,
  type BottomDockState,
  type SidebarSide,
  type UiLayoutState,
} from "../ui-layout-slice";

const EDITOR_SETTINGS_STORAGE_KEY = "editor-settings";
const SIDEBAR_WIDTH_STORAGE_KEY = "workspace-left-panel-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "workspace-left-panel-collapsed";
const BOTTOM_DOCK_STORAGE_KEY = "bottom-dock-state";
const LAYOUT_SETTINGS_STORAGE_KEY = "layout-settings";

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

const defaultLayoutSettings = {
  spacesSidebarWidth: SPACES_SIDEBAR_DEFAULT_WIDTH,
  spacesSidebarCollapsed: false,
  tabbedSidebarPinned: true,
  sidebarSide: 'left' as SidebarSide,
};

function* loadLayoutSettingsFromLocalStorage(): SagaGenerator<typeof defaultLayoutSettings> {
  const stored = yield* call(
    getLocalStorageJSON<Partial<typeof defaultLayoutSettings>>,
    LAYOUT_SETTINGS_STORAGE_KEY
  );
  return stored ? { ...defaultLayoutSettings, ...stored } : defaultLayoutSettings;
}

export function* initSaga() {
  const editorSettings = yield* call(loadEditorSettingsFromLocalStorage);
  yield* put(loadEditorSettings(editorSettings));

  const sidebarWidth = yield* call(loadSidebarWidth);
  const sidebarCollapsed = yield* call(loadSidebarCollapsed);
  yield* put(loadSidebarState(sidebarWidth, sidebarCollapsed));

  const layoutSettingsValues = yield* call(loadLayoutSettingsFromLocalStorage);
  yield* put(loadLayoutSettings(layoutSettingsValues));

  const bottomDockState = yield* call(loadBottomDockFromLocalStorage);
  yield* put(loadBottomDockState(bottomDockState));
}

function* loadBottomDockFromLocalStorage(): SagaGenerator<Omit<BottomDockState, 'isExpanded'>> {
  const stored = yield* call(
    getLocalStorageJSON<Partial<Omit<BottomDockState, 'isExpanded'>>>,
    BOTTOM_DOCK_STORAGE_KEY
  );
  return {
    viewMode: stored?.viewMode ?? 'agents',
    activeTerminalId: stored?.activeTerminalId ?? null,
    height: stored?.height ?? DEFAULT_DOCK_HEIGHT,
  };
}
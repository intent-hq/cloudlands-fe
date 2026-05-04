import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageItem,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import { call, fork, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  selectBottomDockActiveTerminalId,
  selectBottomDockHeight,
  selectBottomDockViewMode,
  selectResizablePanelGroupLayout,
  selectResizablePanelSize,
  selectSidebarExpandedWidth,
  selectDiffIndicators,
  selectDiffSideBySide,
  selectFoldUnchanged,
  selectIsCollapsed,
  selectLineWrapping,
  selectSidebarWidth,
  selectSidebarSide,
  selectSpacesSidebarCollapsed,
  selectSpacesSidebarWidth,
  selectTabbedSidebarPinned,
  selectWorkspaceSidebarPanelLayout,
} from "../ui-layout-selectors";
import {
  hydrateCollapsiblePanelCollapsed,
  hydrateResizablePanelGroupLayout,
  hydrateResizablePanelSize,
  requestCollapsiblePanelCollapsed,
  requestResizablePanelGroupLayout,
  requestResizablePanelSize,
  setCollapsed,
  setCollapsiblePanelCollapsed,
  setDiffIndicators,
  setDiffSideBySide,
  setFoldUnchanged,
  setLineWrapping,
  setResizablePanelGroupLayout,
  setResizablePanelSize,
  setSidebarExpandedWidth,
  setSpacesSidebarCollapsed,
  setSpacesSidebarWidth,
  setSidebarSide,
  setTabbedSidebarPinned,
  setWidth,
  setWorkspaceSidebarPanelLayout,
  toggleDiffIndicators,
  toggleDiffSideBySide,
  toggleFoldUnchanged,
  toggleLineWrapping,
  toggleSidebar,
  toggleSidebarSide,
  toggleSpacesSidebarCollapsed,
  toggleTabbedSidebarPinned,
  collapseBottomDock,
  expandBottomDock,
  resetLayoutSettings,
  selectBottomDockTerminal,
  setBottomDockHeight,
  setBottomDockViewMode,
  showBottomDockAgents,
  toggleBottomDock,
  type ResizablePanelGroupLayoutState,
  type WorkspaceSidebarPanelLayoutState,
} from "../ui-layout-slice";

const EDITOR_SETTINGS_STORAGE_KEY = "editor-settings";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "workspace-left-panel-collapsed";
const SIDEBAR_WIDTH_STORAGE_KEY = "workspace-left-panel-width";
const SIDEBAR_EXPANDED_WIDTH_STORAGE_KEY = "workspace-left-panel-expanded-width";
const LAYOUT_SETTINGS_STORAGE_KEY = "layout-settings";
const BOTTOM_DOCK_STORAGE_KEY = "bottom-dock-state";
const WORKSPACE_SIDEBAR_PANELS_STORAGE_KEY = "vscode-resizable-panels";

function pixelsToPercent(pixels: number): number {
  if (typeof window === "undefined" || window.innerWidth <= 0) return pixels;
  return (pixels / window.innerWidth) * 100;
}

function parseStoredNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPanelGroupLayout(value: ResizablePanelGroupLayoutState | undefined): value is ResizablePanelGroupLayoutState {
  return !!value && Array.isArray(value.sizes) && Array.isArray(value.collapsed);
}

function* persistEditorSettings(settings: {
  lineWrapping: boolean;
  foldUnchanged: boolean;
  diffSideBySide: boolean;
  diffIndicators: boolean;
}): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, EDITOR_SETTINGS_STORAGE_KEY, settings);
}

function* persistSidebarCollapsed(collapsed: boolean): SagaGenerator<void> {
  yield* call(setLocalStorageItem, SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
}

function* watchEditorSettingsPersistence() {
  yield* takeEvery(
    [
      setLineWrapping,
      setFoldUnchanged,
      setDiffSideBySide,
      setDiffIndicators,
      toggleLineWrapping,
      toggleFoldUnchanged,
      toggleDiffSideBySide,
      toggleDiffIndicators,
    ],
    function* () {
      const lineWrapping = yield* selectLineWrapping.effect();
      const foldUnchanged = yield* selectFoldUnchanged.effect();
      const diffSideBySide = yield* selectDiffSideBySide.effect();
      const diffIndicators = yield* selectDiffIndicators.effect();

      yield* call(persistEditorSettings, {
        lineWrapping,
        foldUnchanged,
        diffSideBySide,
        diffIndicators,
      });
    }
  );
}

function* watchSidebarPersistence() {
  yield* takeEvery([toggleSidebar, setCollapsed], function* () {
    const sidebarCollapsed = yield* selectIsCollapsed.effect();
    yield* call(persistSidebarCollapsed, sidebarCollapsed);
  });

  yield* takeEvery(setWidth, function* () {
    const width = yield* selectSidebarWidth.effect();
    yield* call(setLocalStorageItem, SIDEBAR_WIDTH_STORAGE_KEY, String(pixelsToPercent(width)));
  });

  yield* takeEvery(setSidebarExpandedWidth, function* () {
    const width = yield* selectSidebarExpandedWidth.effect();
    yield* call(setLocalStorageItem, SIDEBAR_EXPANDED_WIDTH_STORAGE_KEY, String(pixelsToPercent(width)));
  });
}

function* watchResizablePanelPersistence() {
  yield* takeEvery(requestResizablePanelSize, function* (action: ReturnType<typeof requestResizablePanelSize>) {
    const [key] = action.payload;
    if (!key) return;

    const stored = yield* call(getLocalStorageItem, key);
    const value = parseStoredNumber(stored);
    if (value !== null) {
      yield* put(hydrateResizablePanelSize(key, value));
    }
  });

  yield* takeEvery(setResizablePanelSize, function* (action: ReturnType<typeof setResizablePanelSize>) {
    const [key] = action.payload;
    if (!key) return;

    const value = yield* selectResizablePanelSize.effect(key);
    if (value !== undefined) {
      yield* call(setLocalStorageItem, key, String(value));
    }
  });
}

function* watchResizablePanelGroupPersistence() {
  yield* takeEvery(
    requestResizablePanelGroupLayout,
    function* (action: ReturnType<typeof requestResizablePanelGroupLayout>) {
      const [key] = action.payload;
      if (!key) return;

      const stored = yield* call(getLocalStorageJSON<ResizablePanelGroupLayoutState>, key);
      if (isPanelGroupLayout(stored)) {
        yield* put(hydrateResizablePanelGroupLayout(key, stored));
      }
    }
  );

  yield* takeEvery(
    setResizablePanelGroupLayout,
    function* (action: ReturnType<typeof setResizablePanelGroupLayout>) {
      const [key] = action.payload;
      if (!key) return;

      const layout = yield* selectResizablePanelGroupLayout.effect(key);
      if (layout) {
        yield* call(setLocalStorageJSON, key, layout);
      }
    }
  );
}

function* watchCollapsiblePanelPersistence() {
  yield* takeEvery(
    requestCollapsiblePanelCollapsed,
    function* (action: ReturnType<typeof requestCollapsiblePanelCollapsed>) {
      const [key] = action.payload;
      if (!key) return;

      const stored = yield* call(getLocalStorageItem, key);
      if (stored === "true" || stored === "false") {
        yield* put(hydrateCollapsiblePanelCollapsed(key, stored === "true"));
      }
    }
  );

  yield* takeEvery(
    setCollapsiblePanelCollapsed,
    function* (action: ReturnType<typeof setCollapsiblePanelCollapsed>) {
      const [key, collapsed] = action.payload;
      if (!key) return;
      yield* call(setLocalStorageItem, key, String(collapsed));
    }
  );
}

function* watchWorkspaceSidebarPanelPersistence() {
  yield* takeEvery(setWorkspaceSidebarPanelLayout, function* () {
    const layout = yield* selectWorkspaceSidebarPanelLayout.effect();
    const persisted: WorkspaceSidebarPanelLayoutState = {
      collapsed: layout.collapsed,
      heights: layout.heights,
    };
    yield* call(setLocalStorageJSON, WORKSPACE_SIDEBAR_PANELS_STORAGE_KEY, persisted);
  });
}

function* persistLayoutSettings(settings: {
  spacesSidebarWidth: number;
  spacesSidebarCollapsed: boolean;
  tabbedSidebarPinned: boolean;
  sidebarSide: string;
}): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, LAYOUT_SETTINGS_STORAGE_KEY, settings);
}

function* watchLayoutSettingsPersistence() {
  yield* takeEvery(
    [
      setSpacesSidebarWidth,
      setSpacesSidebarCollapsed,
      toggleSpacesSidebarCollapsed,
      setTabbedSidebarPinned,
      toggleTabbedSidebarPinned,
      setSidebarSide,
      toggleSidebarSide,
      resetLayoutSettings,
    ],
    function* () {
      const spacesSidebarWidth = yield* selectSpacesSidebarWidth.effect();
      const spacesSidebarCollapsed = yield* selectSpacesSidebarCollapsed.effect();
      const tabbedSidebarPinned = yield* selectTabbedSidebarPinned.effect();
      const sidebarSide = yield* selectSidebarSide.effect();

      yield* call(persistLayoutSettings, {
        spacesSidebarWidth,
        spacesSidebarCollapsed,
        tabbedSidebarPinned,
        sidebarSide,
      });
    }
  );
}

function* watchBottomDockPersistence() {
  yield* takeEvery(
    [
      toggleBottomDock,
      expandBottomDock,
      collapseBottomDock,
      setBottomDockViewMode,
      selectBottomDockTerminal,
      showBottomDockAgents,
      setBottomDockHeight,
    ],
    function* () {
      const viewMode = yield* selectBottomDockViewMode.effect();
      const activeTerminalId = yield* selectBottomDockActiveTerminalId.effect();
      const height = yield* selectBottomDockHeight.effect();

      yield* call(setLocalStorageJSON, BOTTOM_DOCK_STORAGE_KEY, {
        viewMode,
        activeTerminalId,
        height,
      });
    }
  );
}

export function* persistenceSaga() {
  yield* fork(watchEditorSettingsPersistence);
  yield* fork(watchSidebarPersistence);
  yield* fork(watchResizablePanelPersistence);
  yield* fork(watchResizablePanelGroupPersistence);
  yield* fork(watchCollapsiblePanelPersistence);
  yield* fork(watchWorkspaceSidebarPanelPersistence);
  yield* fork(watchLayoutSettingsPersistence);
  yield* fork(watchBottomDockPersistence);
}
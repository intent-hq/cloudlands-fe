import {
  setLocalStorageItem,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import { call, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  selectBottomDockActiveTerminalId,
  selectBottomDockHeight,
  selectBottomDockViewMode,
  selectDiffIndicators,
  selectDiffSideBySide,
  selectFoldUnchanged,
  selectIsCollapsed,
  selectLineWrapping,
  selectSidebarSide,
  selectSpacesSidebarCollapsed,
  selectSpacesSidebarWidth,
  selectTabbedSidebarPinned,
} from "../ui-layout-selectors";
import {
  setCollapsed,
  setDiffIndicators,
  setDiffSideBySide,
  setFoldUnchanged,
  setLineWrapping,
  setSpacesSidebarCollapsed,
  setSpacesSidebarWidth,
  setSidebarSide,
  setTabbedSidebarPinned,
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
} from "../ui-layout-slice";

const EDITOR_SETTINGS_STORAGE_KEY = "editor-settings";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "workspace-left-panel-collapsed";
const LAYOUT_SETTINGS_STORAGE_KEY = "layout-settings";
const BOTTOM_DOCK_STORAGE_KEY = "bottom-dock-state";

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
  yield* takeEvery([toggleSidebar.type, setCollapsed.type], function* () {
    const sidebarCollapsed = yield* selectIsCollapsed.effect();
    yield* call(persistSidebarCollapsed, sidebarCollapsed);
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
      setSpacesSidebarWidth.type,
      setSpacesSidebarCollapsed.type,
      toggleSpacesSidebarCollapsed.type,
      setTabbedSidebarPinned.type,
      toggleTabbedSidebarPinned.type,
      setSidebarSide.type,
      toggleSidebarSide.type,
      resetLayoutSettings.type,
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
      toggleBottomDock.type,
      expandBottomDock.type,
      collapseBottomDock.type,
      setBottomDockViewMode.type,
      selectBottomDockTerminal.type,
      showBottomDockAgents.type,
      setBottomDockHeight.type,
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
  yield* call(watchEditorSettingsPersistence);
  yield* call(watchSidebarPersistence);
  yield* call(watchLayoutSettingsPersistence);
  yield* call(watchBottomDockPersistence);
}
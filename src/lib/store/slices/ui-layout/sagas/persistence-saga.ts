import { setLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  selectDiffIndicators,
  selectDiffSideBySide,
  selectFoldUnchanged,
  selectIsCollapsed,
  selectLineWrapping,
} from "../ui-layout-selectors";
import {
  setCollapsed,
  setDiffIndicators,
  setDiffSideBySide,
  setFoldUnchanged,
  setLineWrapping,
  toggleDiffIndicators,
  toggleDiffSideBySide,
  toggleFoldUnchanged,
  toggleLineWrapping,
  toggleSidebar,
} from "../ui-layout-slice";

const EDITOR_SETTINGS_STORAGE_KEY = "editor-settings";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "workspace-left-panel-collapsed";

function* persistEditorSettings(settings: {
  lineWrapping: boolean;
  foldUnchanged: boolean;
  diffSideBySide: boolean;
  diffIndicators: boolean;
}): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageItem, EDITOR_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

function* persistSidebarCollapsed(collapsed: boolean): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageItem, SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // Ignore storage errors
  }
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

export function* persistenceSaga() {
  yield* call(watchEditorSettingsPersistence);
  yield* call(watchSidebarPersistence);
}
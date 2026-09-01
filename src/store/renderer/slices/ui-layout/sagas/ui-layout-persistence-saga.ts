import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageItem,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
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
  setSidebarSide,
  toggleDiffIndicators,
  toggleDiffSideBySide,
  toggleFoldUnchanged,
  toggleLineWrapping,
  toggleSidebar,
  toggleSidebarSide,
  type ResizablePanelGroupLayoutState,
  type SidebarSide,
} from '../ui-layout-slice';
import {
  selectDiffIndicators,
  selectDiffSideBySide,
  selectFoldUnchanged,
  selectIsCollapsed,
  selectLineWrapping,
  selectSidebarSide,
} from '../ui-layout-selectors';

const EDITOR_SETTINGS_KEY = 'editor-settings';
const LAYOUT_SETTINGS_KEY = 'layout-settings';
const WORKSPACE_LEFT_PANEL_COLLAPSED_KEY = 'workspace-left-panel-collapsed';

function isSidebarSide(value: unknown): value is SidebarSide {
  return value === 'left' || value === 'right';
}

function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function* hydrateEditorSettings(): SagaGenerator<void> {
  try {
    const settings = yield* call(getLocalStorageJSON<unknown>, EDITOR_SETTINGS_KEY);
    if (!isSettingsObject(settings)) return;

    if (typeof settings.lineWrapping === 'boolean') {
      yield* put(setLineWrapping(settings.lineWrapping));
    }
    if (typeof settings.foldUnchanged === 'boolean') {
      yield* put(setFoldUnchanged(settings.foldUnchanged));
    }
    if (typeof settings.diffSideBySide === 'boolean') {
      yield* put(setDiffSideBySide(settings.diffSideBySide));
    }
    if (typeof settings.diffIndicators === 'boolean') {
      yield* put(setDiffIndicators(settings.diffIndicators));
    }
  } catch {
    // Layout persistence is best-effort and must never prevent watcher registration.
  }
}

function* persistEditorSettings(): SagaGenerator<void> {
  try {
    const lineWrapping = yield* selectLineWrapping.effect();
    const foldUnchanged = yield* selectFoldUnchanged.effect();
    const diffSideBySide = yield* selectDiffSideBySide.effect();
    const diffIndicators = yield* selectDiffIndicators.effect();
    if (
      typeof lineWrapping !== 'boolean' ||
      typeof foldUnchanged !== 'boolean' ||
      typeof diffSideBySide !== 'boolean' ||
      typeof diffIndicators !== 'boolean'
    ) {
      return;
    }

    const stored = yield* call(getLocalStorageJSON<unknown>, EDITOR_SETTINGS_KEY);
    const settings = isSettingsObject(stored) ? stored : {};
    yield* call(setLocalStorageJSON, EDITOR_SETTINGS_KEY, {
      ...settings,
      lineWrapping,
      foldUnchanged,
      diffSideBySide,
      diffIndicators,
    });
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

function* hydrateSidebarCollapsed(): SagaGenerator<void> {
  try {
    const stored = yield* call(getLocalStorageItem, WORKSPACE_LEFT_PANEL_COLLAPSED_KEY);
    if (stored === 'true' || stored === 'false') {
      yield* put(setCollapsed(stored === 'true'));
    }
  } catch {
    // Layout persistence is best-effort and must never prevent watcher registration.
  }
}

function* persistSidebarCollapsed(): SagaGenerator<void> {
  try {
    const collapsed = yield* selectIsCollapsed.effect();
    if (typeof collapsed === 'boolean') {
      yield* call(setLocalStorageItem, WORKSPACE_LEFT_PANEL_COLLAPSED_KEY, String(collapsed));
    }
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

function parseStoredNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPanelGroupLayout(value: unknown): value is ResizablePanelGroupLayoutState {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Partial<ResizablePanelGroupLayoutState>;
  return Array.isArray(layout.sizes) && Array.isArray(layout.collapsed);
}

function* hydratePanelSize(
  action: ReturnType<typeof requestResizablePanelSize>,
): SagaGenerator<void> {
  const key = action.payload[0];
  if (typeof key !== 'string' || key.length === 0) return;

  let value: number | undefined;
  try {
    value = parseStoredNumber(yield* call(getLocalStorageItem, key)) ?? undefined;
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
  yield* put(hydrateResizablePanelSize(key, value));
}

function* persistPanelSize(action: ReturnType<typeof setResizablePanelSize>): SagaGenerator<void> {
  try {
    const [key, value] = action.payload;
    if (typeof key === 'string' && key.length > 0 && typeof value === 'number') {
      yield* call(setLocalStorageItem, key, String(value));
    }
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

function* hydratePanelGroupLayout(
  action: ReturnType<typeof requestResizablePanelGroupLayout>,
): SagaGenerator<void> {
  try {
    const key = action.payload[0];
    if (typeof key !== 'string' || key.length === 0) return;
    const layout = yield* call(getLocalStorageJSON<unknown>, key);
    if (isPanelGroupLayout(layout)) yield* put(hydrateResizablePanelGroupLayout(key, layout));
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

function* persistPanelGroupLayout(
  action: ReturnType<typeof setResizablePanelGroupLayout>,
): SagaGenerator<void> {
  try {
    const [key, layout] = action.payload;
    if (typeof key === 'string' && key.length > 0 && isPanelGroupLayout(layout)) {
      yield* call(setLocalStorageJSON, key, layout);
    }
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

function* hydratePanelCollapsed(
  action: ReturnType<typeof requestCollapsiblePanelCollapsed>,
): SagaGenerator<void> {
  try {
    const key = action.payload[0];
    if (typeof key !== 'string' || key.length === 0) return;
    const stored = yield* call(getLocalStorageItem, key);
    if (stored === 'true' || stored === 'false') {
      yield* put(hydrateCollapsiblePanelCollapsed(key, stored === 'true'));
    }
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

function* persistPanelCollapsed(
  action: ReturnType<typeof setCollapsiblePanelCollapsed>,
): SagaGenerator<void> {
  try {
    const [key, collapsed] = action.payload;
    if (typeof key === 'string' && key.length > 0 && typeof collapsed === 'boolean') {
      yield* call(setLocalStorageItem, key, String(collapsed));
    }
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

function* hydrateSidebarSide(): SagaGenerator<void> {
  try {
    const settings = yield* call(getLocalStorageJSON<unknown>, LAYOUT_SETTINGS_KEY);
    if (isSettingsObject(settings) && isSidebarSide(settings.sidebarSide)) {
      yield* put(setSidebarSide(settings.sidebarSide));
    }
  } catch {
    // Layout persistence is best-effort and must never prevent watcher registration.
  }
}

function* persistSidebarSide(): SagaGenerator<void> {
  try {
    const sidebarSide = yield* selectSidebarSide.effect();
    if (!isSidebarSide(sidebarSide)) return;

    const stored = yield* call(getLocalStorageJSON<unknown>, LAYOUT_SETTINGS_KEY);
    const settings = isSettingsObject(stored) ? stored : {};
    yield* call(setLocalStorageJSON, LAYOUT_SETTINGS_KEY, { ...settings, sidebarSide });
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* uiLayoutPersistenceSaga(): SagaGenerator<void> {
  yield* call(hydrateSidebarSide);
  yield* call(hydrateEditorSettings);
  yield* call(hydrateSidebarCollapsed);
  yield* takeEvery([setSidebarSide, toggleSidebarSide], persistSidebarSide);
  yield* takeEvery(
    [
      setLineWrapping,
      toggleLineWrapping,
      setFoldUnchanged,
      toggleFoldUnchanged,
      setDiffSideBySide,
      toggleDiffSideBySide,
      setDiffIndicators,
      toggleDiffIndicators,
    ],
    persistEditorSettings,
  );
  yield* takeEvery([setCollapsed, toggleSidebar], persistSidebarCollapsed);
  yield* takeEvery(requestResizablePanelSize, hydratePanelSize);
  yield* takeEvery(setResizablePanelSize, persistPanelSize);
  yield* takeEvery(requestResizablePanelGroupLayout, hydratePanelGroupLayout);
  yield* takeEvery(setResizablePanelGroupLayout, persistPanelGroupLayout);
  yield* takeEvery(requestCollapsiblePanelCollapsed, hydratePanelCollapsed);
  yield* takeEvery(setCollapsiblePanelCollapsed, persistPanelCollapsed);
}

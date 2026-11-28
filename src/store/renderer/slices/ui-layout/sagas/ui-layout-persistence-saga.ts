import type { Action } from '@redux-saga/types';
import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageItem,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
import {
  hydrateSharedPreference,
  watchSharedPreference,
  type SharedPreferenceSagaOptions,
} from '../../../utils/shared-preference-saga';
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

type StoredSettings = Record<string, unknown>;

const parseSettings = (stored: unknown): StoredSettings | undefined =>
  isSettingsObject(stored) ? stored : undefined;

/** The stored object with `changes` on top: other fields in it belong to other owners. */
function* mergeIntoStored(key: string, changes: StoredSettings): SagaGenerator<StoredSettings> {
  const stored = yield* call(getLocalStorageJSON<unknown>, key);
  return { ...(isSettingsObject(stored) ? stored : {}), ...changes };
}

const storedFlag = (value: unknown, set: (value: boolean) => Action): Action[] =>
  typeof value === 'boolean' ? [set(value)] : [];

const editorSettingsPreference: SharedPreferenceSagaOptions<StoredSettings> = {
  key: EDITOR_SETTINGS_KEY,
  scope: 'app',
  parse: parseSettings,
  hydrate: (settings) => [
    ...storedFlag(settings?.lineWrapping, setLineWrapping),
    ...storedFlag(settings?.foldUnchanged, setFoldUnchanged),
    ...storedFlag(settings?.diffSideBySide, setDiffSideBySide),
    ...storedFlag(settings?.diffIndicators, setDiffIndicators),
  ],
  persistOn: [
    setLineWrapping,
    toggleLineWrapping,
    setFoldUnchanged,
    toggleFoldUnchanged,
    setDiffSideBySide,
    toggleDiffSideBySide,
    setDiffIndicators,
    toggleDiffIndicators,
  ],
  *select() {
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
      return undefined;
    }
    return yield* mergeIntoStored(EDITOR_SETTINGS_KEY, {
      lineWrapping,
      foldUnchanged,
      diffSideBySide,
      diffIndicators,
    });
  },
};

const sidebarCollapsedPreference: SharedPreferenceSagaOptions<boolean> = {
  key: WORKSPACE_LEFT_PANEL_COLLAPSED_KEY,
  scope: 'app',
  format: 'text',
  parse: (stored) => (stored === 'true' ? true : stored === 'false' ? false : undefined),
  hydrate: (collapsed) => (collapsed === undefined ? null : setCollapsed(collapsed)),
  persistOn: [setCollapsed, toggleSidebar],
  *select() {
    const collapsed = yield* selectIsCollapsed.effect();
    return typeof collapsed === 'boolean' ? collapsed : undefined;
  },
};

const sidebarSidePreference: SharedPreferenceSagaOptions<StoredSettings> = {
  key: LAYOUT_SETTINGS_KEY,
  scope: 'app',
  parse: parseSettings,
  hydrate: (settings) => {
    const sidebarSide = settings?.sidebarSide;
    return isSidebarSide(sidebarSide) ? setSidebarSide(sidebarSide) : null;
  },
  persistOn: [setSidebarSide, toggleSidebarSide],
  *select() {
    const sidebarSide = yield* selectSidebarSide.effect();
    if (!isSidebarSide(sidebarSide)) return undefined;
    return yield* mergeIntoStored(LAYOUT_SETTINGS_KEY, { sidebarSide });
  },
};

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

export function* uiLayoutPersistenceSaga(): SagaGenerator<void> {
  yield* hydrateSharedPreference(sidebarSidePreference);
  yield* hydrateSharedPreference(editorSettingsPreference);
  yield* hydrateSharedPreference(sidebarCollapsedPreference);
  yield* watchSharedPreference(sidebarSidePreference);
  yield* watchSharedPreference(editorSettingsPreference);
  yield* watchSharedPreference(sidebarCollapsedPreference);
  yield* takeEvery(requestResizablePanelSize, hydratePanelSize);
  yield* takeEvery(setResizablePanelSize, persistPanelSize);
  yield* takeEvery(requestResizablePanelGroupLayout, hydratePanelGroupLayout);
  yield* takeEvery(setResizablePanelGroupLayout, persistPanelGroupLayout);
  yield* takeEvery(requestCollapsiblePanelCollapsed, hydratePanelCollapsed);
  yield* takeEvery(setCollapsiblePanelCollapsed, persistPanelCollapsed);
}

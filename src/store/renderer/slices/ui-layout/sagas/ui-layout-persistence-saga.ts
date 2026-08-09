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
  setCollapsiblePanelCollapsed,
  setResizablePanelGroupLayout,
  setResizablePanelSize,
  type ResizablePanelGroupLayoutState,
} from '../ui-layout-slice';

const UI_LAYOUT_PERSISTENCE_ACTIONS = [
  requestResizablePanelSize,
  setResizablePanelSize,
  requestResizablePanelGroupLayout,
  setResizablePanelGroupLayout,
  requestCollapsiblePanelCollapsed,
  setCollapsiblePanelCollapsed,
];

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

export function* handleUiLayoutPersistenceAction(action: {
  type: string;
  payload?: unknown;
}): SagaGenerator<void> {
  try {
    const payload = Array.isArray(action.payload) ? action.payload : [];
    const key = payload[0];
    if (typeof key !== 'string' || key.length === 0) return;

    if (action.type === requestResizablePanelSize.type) {
      const value = parseStoredNumber(yield* call(getLocalStorageItem, key));
      if (value !== null) yield* put(hydrateResizablePanelSize(key, value));
      return;
    }

    if (action.type === setResizablePanelSize.type) {
      const value = payload[1];
      if (typeof value === 'number') {
        yield* call(setLocalStorageItem, key, String(value));
      }
      return;
    }

    if (action.type === requestResizablePanelGroupLayout.type) {
      const layout = yield* call(getLocalStorageJSON<unknown>, key);
      if (isPanelGroupLayout(layout)) {
        yield* put(hydrateResizablePanelGroupLayout(key, layout));
      }
      return;
    }

    if (action.type === setResizablePanelGroupLayout.type) {
      const layout = payload[1];
      if (isPanelGroupLayout(layout)) {
        yield* call(setLocalStorageJSON, key, layout);
      }
      return;
    }

    if (action.type === requestCollapsiblePanelCollapsed.type) {
      const stored = yield* call(getLocalStorageItem, key);
      if (stored === 'true' || stored === 'false') {
        yield* put(hydrateCollapsiblePanelCollapsed(key, stored === 'true'));
      }
      return;
    }

    if (action.type === setCollapsiblePanelCollapsed.type) {
      const collapsed = payload[1];
      if (typeof collapsed === 'boolean') {
        yield* call(setLocalStorageItem, key, String(collapsed));
      }
    }
  } catch {
    // Layout persistence is best-effort and must never terminate its watcher.
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* uiLayoutPersistenceSaga(): SagaGenerator<void> {
  yield* takeEvery(UI_LAYOUT_PERSISTENCE_ACTIONS, handleUiLayoutPersistenceAction);
}
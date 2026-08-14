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

/** Unregistered until the S20 middleware cutover. */
export function* uiLayoutPersistenceSaga(): SagaGenerator<void> {
  yield* takeEvery(requestResizablePanelSize, hydratePanelSize);
  yield* takeEvery(setResizablePanelSize, persistPanelSize);
  yield* takeEvery(requestResizablePanelGroupLayout, hydratePanelGroupLayout);
  yield* takeEvery(setResizablePanelGroupLayout, persistPanelGroupLayout);
  yield* takeEvery(requestCollapsiblePanelCollapsed, hydratePanelCollapsed);
  yield* takeEvery(setCollapsiblePanelCollapsed, persistPanelCollapsed);
}

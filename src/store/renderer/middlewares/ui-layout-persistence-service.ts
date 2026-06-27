/**
 * UI-layout persistence service — restores the per-panel localStorage read/write
 * that the removed `ui-layout/sagas/persistence-saga` performed for resizable
 * panel sizes, resizable panel group layouts, and collapsible panel collapsed
 * state. With no saga listening, the `request*` triggers (dispatched on mount)
 * became no-ops so panels never restored their persisted geometry, and the
 * `set*` actions (dispatched on resize/collapse) only updated in-memory state
 * without writing back to localStorage.
 *
 * Like `lifecycle-read-service`, this reconnects the persistence path WITHOUT
 * re-adding a saga and WITHOUT changing any call site: the middleware observes
 * each dispatched action and, for the restored triggers, reads localStorage and
 * dispatches the matching `hydrate*` action, or writes the new value back on
 * `set*`. Storage keys/shapes match the old saga exactly (the dynamic `key`
 * argument IS the localStorage key).
 *
 * Dependency-light per src/store AGENTS.md: imports only the safe-storage helper
 * and slice actions/types — no selectors (importing them would evaluate
 * `store.createSelector` mid store-init) and no store module.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
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
} from "../slices/ui-layout/ui-layout-slice";

function parseStoredNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPanelGroupLayout(
  value: ResizablePanelGroupLayoutState | undefined,
): value is ResizablePanelGroupLayoutState {
  return !!value && Array.isArray(value.sizes) && Array.isArray(value.collapsed);
}

/** First array-payload element as a non-empty string key, else undefined. */
function keyOf(action: { payload?: unknown }): string | undefined {
  const key = Array.isArray(action.payload) ? action.payload[0] : undefined;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

/**
 * Middleware giving the restored ui-layout persistence triggers real handlers
 * again. Reads run before/after `next` interchangeably since the localStorage
 * access is synchronous and the matching reducer cases only consume the
 * `hydrate*`/`set*` payloads we forward here.
 */
export function createUiLayoutPersistenceMiddleware(): StoreMiddleware {
  return (api) => (next) => (action) => {
    const result = next(action);
    if (action) {
      switch (action.type) {
        case requestResizablePanelSize.type: {
          const key = keyOf(action);
          if (key) {
            const value = parseStoredNumber(safeLocalStorage.getItem(key));
            if (value !== null) {
              api.dispatch(hydrateResizablePanelSize(key, value));
            }
          }
          break;
        }
        case setResizablePanelSize.type: {
          const payload = Array.isArray(action.payload) ? action.payload : undefined;
          const key = payload?.[0];
          const value = payload?.[1];
          if (typeof key === "string" && key.length > 0 && typeof value === "number") {
            safeLocalStorage.setItem(key, String(value));
          }
          break;
        }
        case requestResizablePanelGroupLayout.type: {
          const key = keyOf(action);
          if (key) {
            const stored = safeLocalStorage.getJSON<ResizablePanelGroupLayoutState>(key);
            if (isPanelGroupLayout(stored)) {
              api.dispatch(hydrateResizablePanelGroupLayout(key, stored));
            }
          }
          break;
        }
        case setResizablePanelGroupLayout.type: {
          const payload = Array.isArray(action.payload) ? action.payload : undefined;
          const key = payload?.[0];
          const layout = payload?.[1] as ResizablePanelGroupLayoutState | undefined;
          if (typeof key === "string" && key.length > 0 && isPanelGroupLayout(layout)) {
            safeLocalStorage.setJSON(key, layout);
          }
          break;
        }
        case requestCollapsiblePanelCollapsed.type: {
          const key = keyOf(action);
          if (key) {
            const stored = safeLocalStorage.getItem(key);
            if (stored === "true" || stored === "false") {
              api.dispatch(hydrateCollapsiblePanelCollapsed(key, stored === "true"));
            }
          }
          break;
        }
        case setCollapsiblePanelCollapsed.type: {
          const payload = Array.isArray(action.payload) ? action.payload : undefined;
          const key = payload?.[0];
          const collapsed = payload?.[1];
          if (typeof key === "string" && key.length > 0 && typeof collapsed === "boolean") {
            safeLocalStorage.setItem(key, String(collapsed));
          }
          break;
        }
      }
    }
    return result;
  };
}

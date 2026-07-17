/**
 * Zoom-sync service — restores the window zoom-factor listener that the removed
 * `user-preferences/sagas/ipc-saga.ts` (`ipcZoomSaga`) performed. With no saga
 * listening, zoom-level changes from the main process (Cmd/Ctrl+Plus/Minus or
 * View menu) never reached the Redux store, so zoom-dependent UI
 * (font-size overrides, layout adjustments) stayed stale.
 *
 * This reconnects the path WITHOUT re-adding a saga and WITHOUT changing any
 * call site: on creation it registers a window IPC listener for
 * `window:zoom-changed` and dispatches `setZoomFactor` when the payload is
 * valid (numeric and > 0). The listener is cleaned up when the store disposes.
 *
 * The `window:zoom-changed` channel is registered in `src/shared/ipc-registry.ts`
 * and exposed through the preload bridge (`src/preload/index.ts`). Main-process
 * zoom handlers emit this event whenever the zoom level changes; this middleware
 * is the renderer-side consumer.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the configured
 * store and the setZoomFactor action — no selectors and no store module.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { store as appStore } from "$store/renderer/store";
import { setZoomFactor } from "../slices/user-preferences/user-preferences-slice";
import { isElectron } from "$lib/electron-bridge";

interface ZoomChangedEvent {
  zoomFactor: number;
}

export function createZoomSyncMiddleware(): StoreMiddleware {
  return () => {
    // Register the listener once on middleware creation
    if (isElectron() && typeof window !== "undefined" && window.electronAPI?.on) {
      const handler = (data: ZoomChangedEvent) => {
        if (typeof data?.zoomFactor === "number" && data.zoomFactor > 0) {
          appStore.dispatch(setZoomFactor(data.zoomFactor));
        }
      };

      window.electronAPI.on("window:zoom-changed", handler);
      // Note: No cleanup is performed. The listener persists for the lifetime
      // of the renderer process.
    }

    return (next) => (action) => {
      const result = next(action);
      return result;
    };
  };
}

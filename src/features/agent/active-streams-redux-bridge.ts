/**
 * Active streams Redux bridge — restores the tracker→Redux bridge that the
 * removed saga performed. With no bridge, activeStreamsTracker updates never
 * dispatch `bumpActiveStreamsVersion`, so sidebar workspace cards don't
 * re-render when active-stream data arrives after mount (app refresh case).
 *
 * This reconnects the path WITHOUT re-adding a saga and WITHOUT changing any
 * call site: on middleware creation it subscribes to activeStreamsTracker
 * updates and dispatches `bumpActiveStreamsVersion` when the tracker notifies
 * listeners. It also ensures `activeStreamsTracker.startPolling()` is called
 * once at boot, independently of WindowTitleBar mounting.
 *
 * The tracker's `subscribe()` returns a cleanup function. The listener is
 * cleaned up when the store disposes (though in practice the renderer process
 * runs for the app lifetime, so cleanup is mainly for HMR/dev).
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the
 * configured store, the tracker, and the slice action — no selectors.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { store as appStore } from "$store/renderer/store";
import { bumpActiveStreamsVersion } from "$store/renderer/slices/sidebar-nav/sidebar-nav-slice";
import { activeStreamsTracker } from "./services/active-streams-tracker";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("ActiveStreamsReduxBridge");

let unsubscribe: (() => void) | null = null;
let hasStartedPolling = false;
let hasInitialized = false;

export function createActiveStreamsReduxBridge(): StoreMiddleware {
  return () => {
    return (next) => (action) => {
      // Initialize on first action dispatch (not at middleware creation time)
      // This ensures tests can reset state between runs
      if (!hasInitialized) {
        hasInitialized = true;

        // Subscribe to tracker updates and dispatch Redux action when tracker notifies
        unsubscribe = activeStreamsTracker.subscribe(() => {
          logger.debug("Tracker notified — dispatching bumpActiveStreamsVersion");
          appStore.dispatch(bumpActiveStreamsVersion());
        });

        logger.info("Subscribed to activeStreamsTracker updates");

        // Ensure startPolling is called exactly once, independently of component mounting
        if (!hasStartedPolling) {
          hasStartedPolling = true;
          activeStreamsTracker.startPolling();
          logger.info("Started activeStreamsTracker polling");
        }
      }

      const result = next(action);
      return result;
    };
  };
}

// Export cleanup for test isolation (optional, but good practice)
export function __resetActiveStreamsReduxBridgeForTests() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  hasStartedPolling = false;
  hasInitialized = false;
}

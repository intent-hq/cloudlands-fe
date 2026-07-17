/**
 * Active streams Redux bridge — restores the tracker→Redux bridge that the
 * removed saga performed. With no bridge, activeStreamsTracker updates never
 * dispatch `bumpActiveStreamsVersion`, so sidebar workspace cards don't
 * re-render when active-stream data arrives after mount (app refresh case).
 *
 * This reconnects the path WITHOUT re-adding a saga and WITHOUT changing any
 * call site: on first action dispatch it subscribes to activeStreamsTracker
 * updates and dispatches `bumpActiveStreamsVersion` when the tracker notifies
 * listeners. It also ensures `activeStreamsTracker.startPolling()` is called
 * once at boot, independently of WindowTitleBar mounting.
 *
 * The tracker's `subscribe()` returns a cleanup function. The middleware does
 * not expose a dispose hook, so cleanup is manual via the test reset helper.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the tracker
 * and the slice action — no selectors, no store import.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { bumpActiveStreamsVersion } from "$store/renderer/slices/sidebar-nav/sidebar-nav-slice";
import { activeStreamsTracker } from "./services/active-streams-tracker";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("ActiveStreamsReduxBridge");

let unsubscribe: (() => void) | null = null;
let hasStartedPolling = false;
// In test environments, disable the bridge by default.
// Tests that explicitly want to test the bridge should call __enableActiveStreamsReduxBridgeForTests().
// Detect test mode via import.meta.env.MODE rather than globalThis.vitest (which isn't set in our test setup).
let testModeDisabled = import.meta.env.MODE === "test";

export function createActiveStreamsReduxBridge(): StoreMiddleware {
  return (api) => (next) => (action) => {
    // Boot-time setup: subscribe to tracker updates and start polling once.
    // Runs on first action dispatch (not at middleware creation time) so the store
    // is fully constructed before we subscribe.
    // Skip in test mode unless explicitly enabled via __enableActiveStreamsReduxBridgeForTests()
    if (!testModeDisabled && !unsubscribe) {
      // Subscribe to tracker updates and dispatch Redux action when tracker notifies.
      // Use the middleware API dispatch to target the correct store instance.
      unsubscribe = activeStreamsTracker.subscribe(() => {
        logger.debug("Tracker notified — dispatching bumpActiveStreamsVersion");
        api.dispatch(bumpActiveStreamsVersion());
      });

      logger.info("Subscribed to activeStreamsTracker updates");

      // Ensure startPolling is called exactly once, independently of component mounting
      if (!hasStartedPolling) {
        hasStartedPolling = true;
        activeStreamsTracker.startPolling();
        logger.info("Started activeStreamsTracker polling");
      }
    }

    return next(action);
  };
}

// Export opt-in for tests that explicitly want to test the bridge
export function __enableActiveStreamsReduxBridgeForTests() {
  testModeDisabled = false;
}

// Export cleanup for test isolation
export function __resetActiveStreamsReduxBridgeForTests() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  hasStartedPolling = false;
  testModeDisabled = import.meta.env.MODE === "test";
}

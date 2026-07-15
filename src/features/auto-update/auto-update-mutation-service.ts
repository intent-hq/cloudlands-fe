/**
 * Auto-update mutation service — the post-saga consumer for the orphaned
 * `initAutoUpdate` trigger.
 *
 * Before the saga runtime was removed, `initAutoUpdate` (dispatched by
 * UpdateNotification.svelte onMount) lived in a saga that registered IPC
 * listeners and fetched initial state. When sagas were removed, the action
 * became trigger-only with no handler, so clicking "Check for Updates" in
 * production shows zero UI feedback — the main process runs the check but the
 * renderer never sees the events.
 *
 * This middleware restores the handler WITHOUT re-adding a saga:
 * `createAutoUpdateMutationMiddleware()` observes `initAutoUpdate`, registers
 * `autoUpdateClient` listeners exactly once (idempotent), maps each IPC event
 * to its corresponding slice action (status-changed → setUpdateState,
 * onShowToast → showToastChecking, etc.), and fetches initial state via
 * `getState()` → `setUpdateState`.
 *
 * Dependency-light per src/store AGENTS.md: imports only the autoUpdateClient,
 * the configured store, the slice actions, and the logger. No selector modules;
 * state is read directly off `appStore.state` if needed.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { autoUpdateClient } from "./auto-update.client";
import { store as appStore } from "$store/renderer/store";
import {
  initAutoUpdate,
  setUpdateState,
  setProgress,
  setUpdateError,
  showToastChecking,
  setUpToDate,
  showToast,
} from "$store/renderer/slices/auto-update/auto-update-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("AutoUpdateMutationService");

/**
 * Guard flag ensuring listeners are registered exactly once even if
 * `initAutoUpdate` dispatches multiple times. Once `true`, subsequent
 * `initAutoUpdate` actions are no-ops.
 */
let listenersRegistered = false;

/**
 * Initialize auto-update: register IPC listeners once (idempotent) and fetch
 * initial state. Listeners map IPC events to slice actions so the
 * UpdateNotification.svelte $effect logic renders correctly from slice state.
 */
async function handleInitAutoUpdate(): Promise<void> {
  // Idempotent guard — register listeners exactly once
  if (listenersRegistered) {
    logger.debug("Auto-update listeners already registered, skipping init");
    return;
  }

  // Set the guard immediately after checking to prevent concurrent calls from
  // double-registering listeners during the await below.
  listenersRegistered = true;

  try {
    // Register IPC listeners — map each event to its corresponding slice action
    autoUpdateClient.onShowToast(() => {
      appStore.dispatch(showToastChecking());
    });

    autoUpdateClient.onUpToDate((data) => {
      appStore.dispatch(setUpToDate(data.version));
      appStore.dispatch(showToast());
    });

    autoUpdateClient.onStatusChanged((state) => {
      appStore.dispatch(setUpdateState(state));
    });

    autoUpdateClient.onProgress((progress) => {
      appStore.dispatch(setProgress(progress));
    });

    autoUpdateClient.onError((error) => {
      appStore.dispatch(setUpdateError(error));
    });

    // Fetch initial state and populate the slice
    const initialState = await autoUpdateClient.getState();
    appStore.dispatch(setUpdateState(initialState));

    logger.debug("Auto-update listeners registered and initial state fetched");
  } catch (error) {
    // Do NOT reset listenersRegistered here — all listener registrations
    // (onShowToast / onUpToDate / onStatusChanged / onProgress / onError) are
    // synchronous and happen before the getState() await. If getState() throws,
    // listeners are already registered and a retry would duplicate them.
    logger.error("Failed to initialize auto-update", error);
    // Degrade gracefully — listeners are wired but the slice won't have initial
    // state until the next check.
  }
}

/**
 * Middleware that gives the `initAutoUpdate` trigger a real handler: after the
 * action passes through the (no-op) reducer, it routes to `handleInitAutoUpdate`
 * which registers IPC listeners once and fetches initial state. Errors inside
 * the handler are caught and logged so the dispatch chain itself never throws.
 */
export function createAutoUpdateMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;
    const type = (action as { type?: unknown }).type;
    if (type === initAutoUpdate.type) {
      void handleInitAutoUpdate();
    }
    return result;
  };
}

/**
 * Test-only reset function to clear the `listenersRegistered` flag between tests.
 * @internal
 */
export function __resetAutoUpdateMiddlewareForTests(): void {
  listenersRegistered = false;
}

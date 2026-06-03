/**
 * Main-process Redux store bridge.
 *
 * Main-process-only bridge for global access to the
 * configured main-process StreamingStore after initialization.
 */

import type { MainStore, MainStoreState } from "./types";

type MainAction = { type: string };

let storeBridge: MainStore | null = null;

/**
 * Initialize the main store bridge. Called once by `initMainStore()`.
 */
export function initMainStoreBridge(store: MainStore): void {
  if (storeBridge) {
    throw new Error("Main Redux store bridge already initialized.");
  }
  storeBridge = store;
}

/**
 * Get the configured main-process StreamingStore. Throws if not yet initialized.
 */
export function getMainStore(): MainStore {
  if (!storeBridge) {
    throw new Error("Main Redux store bridge not initialized. Call initMainStore() first.");
  }

  return storeBridge;
}

/**
 * Shortcut for `getMainStore().state`.
 */
export function getMainState(): MainStoreState {
  return getMainStore().state as MainStoreState;
}

/**
 * Shortcut for `getMainStore().dispatch(action)`.
 */
export const mainDispatch = <A extends MainAction>(action: A): A => {
  return getMainStore().dispatch(action as never) as A;
};

/**
 * Reset the bridge (for testing only).
 * @internal
 */
export function _resetMainStoreBridge(): void {
  storeBridge = null;
}
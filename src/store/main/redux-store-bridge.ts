/**
 * Main-process Redux store bridge.
 *
 * Main-process-only bridge for global access to the
 * main-process Redux store after initialization.
 */

import type { MainReduxStore, MainStoreState } from "./types";

type MainAction = { type: string };

let storeBridge: MainReduxStore | null = null;

/**
 * Initialize the main store bridge. Called once by `initMainStore()`.
 */
export function initMainStoreBridge(store: MainReduxStore): void {
  if (storeBridge) {
    throw new Error("Main Redux store bridge already initialized.");
  }
  storeBridge = store;
}

/**
 * Get the main-process Redux store. Throws if not yet initialized.
 */
export function getMainStore(): MainReduxStore {
  if (!storeBridge) {
    throw new Error("Main Redux store bridge not initialized. Call initMainStore() first.");
  }

  return storeBridge;
}

/**
 * Shortcut for `getMainStore().getState()`.
 */
export function getMainState(): MainStoreState {
  return getMainStore().getState();
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
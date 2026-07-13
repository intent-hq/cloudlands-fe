/**
 * Renderer-process Redux store bridge.
 *
 * Provides global access to the renderer app store without a static import of
 * `$store/renderer/store` or `$store/renderer/configured-store`. Those modules pull in
 * `@augmentcode/ag-redux-toolkit/svelte-store`, which transitively imports `svelte` — a
 * devDependency stripped from packaged builds. Any file reachable from the
 * main-process entry that statically imports the store will crash the packaged
 * app with ERR_MODULE_NOT_FOUND.
 *
 * This bridge uses only `import type` (erased at compile time), so it is safe
 * to import from both the renderer **and** main process.
 *
 * Initialised once by `initAppStore()` in `src/store/renderer/store.ts`.
 */

import type { StoreState } from './types';

/** Minimal store interface needed by consumer code. */
export interface RendererStoreBridge {
  readonly state: StoreState;
  dispatch(action: { type: string; [key: string]: any }): any;
}

let storeBridge: RendererStoreBridge | null = null;

/**
 * Set the renderer store reference. Called during `initAppStore()`.
 *
 * Re-initializing with the same configured Store is harmless in dev/HMR and
 * nested layout recovery paths. A different Store still indicates multiple app
 * roots competing for the bridge and remains an error.
 */
export function initRendererStoreBridge(store: RendererStoreBridge): void {
  if (storeBridge) {
    if (storeBridge === store) return;
    throw new Error('Renderer store bridge already initialized.');
  }
  storeBridge = store;
}

/**
 * Clear the renderer store reference when the owning app Store is disposed.
 * Passing the expected store prevents an older disposer from clearing a newer
 * bridge after a hot reload or root remount race.
 */
export function clearRendererStoreBridge(expectedStore?: RendererStoreBridge): boolean {
  if (!storeBridge) return false;
  if (expectedStore && storeBridge !== expectedStore) return false;
  storeBridge = null;
  return true;
}

/**
 * Get the renderer app store. Throws if not yet initialized.
 */
export function getRendererStore(): RendererStoreBridge {
  if (!storeBridge) {
    throw new Error(
      'Renderer store bridge not initialized. Call initAppStore() first.',
    );
  }
  return storeBridge;
}

/**
 * Reset the bridge (for testing only).
 * @internal
 */
export function _resetRendererStoreBridge(): void {
  clearRendererStoreBridge();
}

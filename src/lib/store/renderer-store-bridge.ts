/**
 * Renderer-process Redux store bridge.
 *
 * Provides global access to the renderer app store without a static import of
 * `$lib/store/store` or `$lib/store/configured-store`. Those modules pull in
 * `svelte-redux-toolkit/store`, which transitively imports `svelte` — a
 * devDependency stripped from packaged builds. Any file reachable from the
 * main-process entry that statically imports the store will crash the packaged
 * app with ERR_MODULE_NOT_FOUND.
 *
 * This bridge uses only `import type` (erased at compile time), so it is safe
 * to import from both the renderer **and** main process.
 *
 * Initialised once by `initAppStore()` in `src/lib/store/store.ts`.
 */

import type { StoreState } from './types';

/** Minimal store interface needed by consumer code. */
export interface RendererStoreBridge {
  readonly state: StoreState;
  dispatch(action: { type: string; [key: string]: any }): any;
}

let storeBridge: RendererStoreBridge | null = null;

/**
 * Set the renderer store reference. Called once during `initAppStore()`.
 */
export function initRendererStoreBridge(store: RendererStoreBridge): void {
  if (storeBridge) {
    throw new Error('Renderer store bridge already initialized.');
  }
  storeBridge = store;
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
  storeBridge = null;
}

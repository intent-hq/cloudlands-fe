import type { GenericAction, ReduxStore } from "./types";

/**
 * Bridge for dispatching Redux actions from non-Svelte code.
 * This is initialized when the store is created and provides
 * a way for services (agent.service.ts, stream-manager.ts, etc.)
 * to dispatch actions without needing Svelte context.
 */

let dispatchFn: ((action: GenericAction) => void) | null = null;
let storeBridge: ReduxStore | null = null;

export function initReduxDispatchBridge(dispatch: (action: GenericAction) => void): void {
  dispatchFn = dispatch;
}

export function initReduxStoreBridge(store: ReduxStore): void {
  storeBridge = store;
}

export function getReduxDispatch(): (action: GenericAction) => void {
  if (!dispatchFn) {
    throw new Error("Redux dispatch bridge not initialized. Call initReduxDispatchBridge first.");
  }
  return dispatchFn;
}

export function getReduxStore(): ReduxStore {
  if (!storeBridge) {
    throw new Error("Redux store bridge not initialized. Call initReduxStoreBridge first.");
  }
  return storeBridge;
}


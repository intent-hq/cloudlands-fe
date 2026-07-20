import type { Store } from '$lib/store-shim/svelte-store';
import type {
  PreloadedStoreState as ToolkitPreloadedStoreState,
  StoreState as ToolkitStoreState,
} from '$lib/store-shim/types';
import type { store as configuredStore } from './configured-store';

// ============================================================================
// Store Types
// ============================================================================

export type StoreState = ToolkitStoreState<typeof configuredStore>;

export type PreloadedStoreState = ToolkitPreloadedStoreState<StoreState>;

export type AppStore = typeof configuredStore;

export type ReduxStoreContext = {
  store: Store<any, any>;
  dispose: () => void;
};

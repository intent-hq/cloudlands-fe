import type { Store } from '@augmentcode/themis/svelte-store';
import type {
  PreloadedStoreState as ToolkitPreloadedStoreState,
  StoreState as ToolkitStoreState,
} from '@augmentcode/themis/types';
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

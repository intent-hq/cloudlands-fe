import type { Store } from 'svelte-redux-toolkit/store';
import type {
  PreloadedStoreState as ToolkitPreloadedStoreState,
  StoreState as ToolkitStoreState,
} from 'svelte-redux-toolkit/types';
import type { store as configuredStore } from './configured-store';

// ============================================================================
// Store Types
// ============================================================================

export type StoreState = ToolkitStoreState<typeof configuredStore>;

export type PreloadedStoreState = ToolkitPreloadedStoreState<StoreState>;

export type ReduxStoreContext = {
  store: Store<any, any>;
  dispose: () => void;
};

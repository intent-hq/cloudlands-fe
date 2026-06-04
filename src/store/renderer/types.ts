import type { Store } from 'ag-redux-toolkit/svelte-store';
import type {
  PreloadedStoreState as ToolkitPreloadedStoreState,
  StoreState as ToolkitStoreState,
} from 'ag-redux-toolkit/types';
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

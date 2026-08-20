import type { Store } from '@augmentcode/themis/svelte-store';
import type {
  PreloadedStoreState as ToolkitPreloadedStoreState,
  StoreSelector,
  StoreState as ToolkitStoreState,
} from '@augmentcode/themis/types';
import type { store as configuredStore } from './configured-store';

// ============================================================================
// Store Types
// ============================================================================

export type StoreState = ToolkitStoreState<typeof configuredStore>;

export type PreloadedStoreState = ToolkitPreloadedStoreState<StoreState>;

type AppStore = typeof configuredStore;

/**
 * Portable annotation type for `store.createSelector` results. Exported
 * selectors compiled under declaration emit (tsconfig.main.json) need an
 * explicit annotation so the emitted declarations do not reference
 * non-exported Themis internals (TS2883 under TypeScript 6).
 */
export type AppSelector<R, ARGS extends unknown[] = []> = StoreSelector<
  R,
  ARGS,
  StoreState,
  AppStore
>;

export type ReduxStoreContext = {
  store: Store<any, any>;
  dispose: () => void;
};

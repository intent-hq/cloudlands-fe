import { Store } from '@augmentcode/themis/svelte-store';
import type { StoreMiddleware, StoreStateFromReducers } from '@augmentcode/themis/types';
import { readable, type Readable } from 'svelte/store';

import { safeLocalStorage } from '$lib/utils/safe-storage';
import { REDUX_DEBUG_LS_KEY } from './constants';
import { enableRendererActionBatching } from './batch-actions';
import { middleware } from './middleware';
import { reducers } from './reducer';

type RendererStateMap = StoreStateFromReducers<typeof reducers>;
type RendererBaseStore = Store<RendererStateMap, typeof reducers>;
type RendererBoundState = ReturnType<RendererBaseStore['getStoreStateSnapshot']>;

function isTestEnvironment(): boolean {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') return true;
  // Playwright CT bundle: playwright/index.ts sets this flag before calling
  // store.init() outside Svelte component initialization (monorepo#2224).
  return (
    typeof window !== 'undefined' &&
    (window as { __PLAYWRIGHT_CT_STORE_BOOTSTRAP__?: boolean })
      .__PLAYWRIGHT_CT_STORE_BOOTSTRAP__ === true
  );
}

function isReduxActionLoggingEnabled(): boolean {
  const { value, hadError } = safeLocalStorage.getItemWithStatus(REDUX_DEBUG_LS_KEY);
  return !hadError && value === 'true';
}

class RendererStore extends Store<RendererStateMap, typeof reducers> {
  getReadableState(): Readable<RendererBoundState> {
    return readable(this.state, (set) => {
      set(this.state);
      const storeContext = (this as any).storeContext;
      if (!storeContext?.store) return () => undefined;
      return storeContext.store.subscribe(() => set(storeContext.store.getState()));
    });
  }

  init(initialState?: Parameters<Store<RendererStateMap, typeof reducers>['init']>[0]) {
    const dispose = super.init(initialState);
    Object.defineProperty(this, 'dispatch', {
      configurable: true,
      value: super.dispatch,
    });
    return () => {
      try {
        dispose();
      } finally {
        delete (this as any).dispatch;
      }
    };
  }

  protected getExistingStoreContext(): any {
    const instanceContext = (this as any).storeContext;
    if (instanceContext) return instanceContext;

    try {
      return super.getExistingStoreContext();
    } catch (error) {
      if (isTestEnvironment() && error instanceof Error) {
        if (error.message.includes('Store context accessed outside component initialization')) {
          return undefined;
        }
      }
      throw error;
    }
  }
}

export const store = new RendererStore(
  enableRendererActionBatching(reducers),
  middleware as unknown as StoreMiddleware[],
  {
    logReduxActions: isReduxActionLoggingEnabled(),
  },
);

import { Store } from '@augmentcode/themis/svelte-store';
import type { StoreMiddleware, StoreStateFromReducers } from '@augmentcode/themis/types';

import { middleware } from './middleware';
import { reducers } from './reducer';

type RendererStateMap = StoreStateFromReducers<typeof reducers>;

function isTestEnvironment(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
}

class RendererStore extends Store<RendererStateMap, typeof reducers> {
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

export const store = new RendererStore(reducers, middleware as unknown as StoreMiddleware[]);

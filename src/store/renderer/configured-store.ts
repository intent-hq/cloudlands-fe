import { Store } from '@augmentcode/themis/svelte-store';
import type {
  ReadableArgs,
  StoreMiddleware,
  StoreSelector,
  StoreSelectorCallback,
  StoreStateFromReducers,
} from '@augmentcode/themis/types';
import { get, readable, type Readable } from 'svelte/store';
import { select } from 'typed-redux-saga';

import { middleware } from './middleware';
import { reducers } from './reducer';

type RendererStateMap = StoreStateFromReducers<typeof reducers>;
type RendererBaseStore = Store<RendererStateMap, typeof reducers>;
type RendererBoundState = ReturnType<RendererBaseStore['getStoreStateSnapshot']>;

const isReadable = <T>(value: unknown): value is Readable<T> =>
  typeof value === 'object' &&
  value !== null &&
  'subscribe' in value &&
  typeof value.subscribe === 'function';

const readSelectorArg = <T>(arg: T | Readable<T>): T => (isReadable<T>(arg) ? get(arg) : arg);

function isTestEnvironment(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
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

  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, RendererBoundState>,
  ): StoreSelector<R, ARGS, RendererBoundState, RendererBaseStore> {
    const readableSelector = ((...args: ReadableArgs<ARGS>) =>
      readable(selectorFunc(this.state, ...(args.map(readSelectorArg) as ARGS)), (set) => {
        const emit = () => set(selectorFunc(this.state, ...(args.map(readSelectorArg) as ARGS)));
        emit();
        const storeContext = (this as any).storeContext;
        const unsubscribeStore = storeContext?.store?.subscribe(emit) ?? (() => undefined);
        const unsubscribeArgs = args
          .filter(isReadable)
          .map((arg: Readable<unknown>) => arg.subscribe(emit));
        return () => {
          unsubscribeStore();
          for (const unsubscribe of unsubscribeArgs) unsubscribe();
        };
      })) as StoreSelector<R, ARGS, RendererBoundState, RendererBaseStore>;

    readableSelector.select = selectorFunc;
    readableSelector.effect = (...args: ARGS) => select(selectorFunc, ...args);
    readableSelector.withStore = (store: RendererBaseStore) => (...args: ReadableArgs<ARGS>) =>
      store.createSelector(selectorFunc)(...args);
    return readableSelector;
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

export const store = new RendererStore(reducers, middleware as unknown as StoreMiddleware[]);

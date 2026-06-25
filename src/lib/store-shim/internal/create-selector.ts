import { derived, readable, type Readable } from 'svelte/store';
import { select } from 'typed-redux-saga';
import { areStoreUpdatesLocked, createCachedSelector } from './cached-selector.js';
import type { StoreSelector, StoreSelectorCallback } from '../types';

const isReadable = (arg: any): arg is Readable<any> => {
  if (!arg || typeof arg !== 'object') return false;
  return 'subscribe' in arg && typeof arg.subscribe === 'function';
};

const isReadableStateSource = (arg: any): boolean => {
  if (!arg || typeof arg !== 'object') return false;
  return 'getReadableState' in arg && typeof arg.getReadableState === 'function';
};

const createStoreStateReadable = (store: {
  getState: () => any;
  subscribe: (listener: () => void) => () => void;
}): Readable<any> => {
  const getStoreStateChange = () => store.getState();
  return readable(getStoreStateChange(), (set) => {
    set(getStoreStateChange());
    return store.subscribe(() => set(getStoreStateChange()));
  });
};

const resolveReadableState = (store: any): Readable<any> => {
  if (isReadableStateSource(store)) return store.getReadableState();
  return createStoreStateReadable(store);
};

/**
 * Emit synchronously while suppressing repeat emissions of an identical
 * reference, mirroring the toolkit's de-duped selector readable without the
 * frame-throttling scheduler.
 */
const createDedupedReadable = <T>(source: Readable<T>): Readable<T> => {
  let latest: T;
  let hasLatest = false;
  return readable<T>(undefined as unknown as T, (set) => {
    return source.subscribe((value) => {
      if (hasLatest && value === latest) return;
      hasLatest = true;
      latest = value;
      set(value);
    });
  });
};

export const createSelectorFromReadableState = <R, ARGS extends any[] = [], TState = any>(
  getReadableState: () => Readable<TState>,
  selectorFunc: StoreSelectorCallback<R, ARGS, TState>,
): StoreSelector<R, ARGS, TState> => {
  const boundSelector = (readableStoreState: Readable<any>, ...restArgs: any[]): Readable<R> => {
    const cachedSelector = createCachedSelector(selectorFunc as any, {
      lockUpdatesPredicate: areStoreUpdatesLocked,
    });
    const derivedStore = derived(
      [readableStoreState, ...restArgs.map((arg) => (isReadable(arg) ? arg : readable(arg)))],
      ([storeState, ...args]) => cachedSelector(storeState, ...args) as R,
    );
    return createDedupedReadable(derivedStore);
  };

  const readableSelector = ((...restArgs: any[]) => {
    return boundSelector(getReadableState(), ...restArgs);
  }) as any;

  readableSelector.withStore =
    (store: any) =>
    (...args: any[]) =>
      boundSelector(resolveReadableState(store), ...args);
  readableSelector.select = selectorFunc;
  readableSelector.effect = (...args: any[]) => select(selectorFunc as any, ...args);

  return readableSelector as StoreSelector<R, ARGS, TState>;
};

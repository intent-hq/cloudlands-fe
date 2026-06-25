import type { ReducersMap, StoreMiddleware } from '../types';

export type StoreCore = {
  getState: () => any;
  subscribe: (listener: () => void) => () => void;
  dispatch: (action: any) => any;
};

const INIT_ACTION = { type: '@@store-shim/INIT' };

/**
 * Combine a map of slice reducers into a single root reducer. Returns the same
 * state reference when no slice changed so downstream memoization can short-circuit.
 */
export const combineReducers = (reducers: ReducersMap) => {
  const keys = Object.keys(reducers);
  return (state: Record<string, any> = {}, action: any): Record<string, any> => {
    let changed = false;
    const next: Record<string, any> = {};
    for (const key of keys) {
      const prev = state[key];
      const nextForKey = reducers[key](prev, action);
      next[key] = nextForKey;
      changed = changed || nextForKey !== prev;
    }
    return changed || keys.length !== Object.keys(state).length ? next : state;
  };
};

const compose = (...fns: Array<(arg: any) => any>): ((arg: any) => any) => {
  if (fns.length === 0) return (arg) => arg;
  if (fns.length === 1) return fns[0];
  return fns.reduce((a, b) => (arg: any) => a(b(arg)));
};

/**
 * Minimal redux-free store with applyMiddleware semantics. dispatch runs the
 * middleware chain, applies the reducer, then notifies subscribers.
 */
export const createStoreCore = (
  rootReducer: (state: any, action: any) => any,
  preloadedState?: any,
  middlewares: StoreMiddleware[] = [],
): StoreCore => {
  let state = rootReducer(preloadedState, INIT_ACTION);
  const listeners = new Set<() => void>();

  const getState = () => state;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const baseDispatch = (action: any) => {
    state = rootReducer(state, action);
    for (const listener of [...listeners]) listener();
    return action;
  };

  let dispatch: (action: any) => any = baseDispatch;
  const middlewareAPI = {
    getState,
    dispatch: (action: any) => dispatch(action),
  };
  const chain = middlewares.map((middleware) => middleware(middlewareAPI));
  dispatch = compose(...chain)(baseDispatch);

  return {
    getState,
    subscribe,
    dispatch: (action: any) => dispatch(action),
  };
};

import type { StoreState, ReduxStore, StoreSelector, ReadableArgs } from "../types";
import { getStoreContext } from "./utils";
import { collectionFieldsSet, isCollection, type Collection } from "./collection-utils";
import { readable, derived, type Readable } from "svelte/store";
import { shallowEqual } from "fast-equals";
import { createStoreStateReadable } from "./create-readable-store-state";
import { select } from "typed-redux-saga";

/**
 * Tracks which state paths were accessed during selector execution
 */
type AccessedPath = (string | symbol)[];
const proxyValuesWeakMap = new WeakMap<any, any>();

const getRawValue = <R>(maybeProxy: R | any): R => {
  return proxyValuesWeakMap.get(maybeProxy) || maybeProxy;
};

/**
 * Creates a proxy that tracks all property accesses on the state object
 */
const createTrackingProxy = (
  target: any,
  accessedPaths: Set<string>,
  parsedPaths: Map<string, (string | symbol)[]>,
  currentPath: AccessedPath = []
): any => {
  // Don't proxy primitives or null/undefined
  if (target === null || target === undefined || typeof target !== "object") {
    return target;
  }

  // Need to cleanup target first, so we will not create proxy from proxy
  // Sometimes `createTrackingProxy` may be called with proxy because of selectors composition:
  // A selector gets state as proxy and call another selector inside with this proxy
  const proxy = new Proxy(getRawValue<typeof target>(target), {
    get(obj, prop) {
      const value = obj[prop];
      if (!prop) {
        return value;
      }
      /*
        We stop proxying when encounter a collection
        Collection object is always changed when a value of collection changed or items re-oredered.
        At this point it is cheaper to re-run selector than to check every single element if it is changed.
      */
      if (typeof prop === "string" && collectionFieldsSet.has(prop) && isCollection(obj)) {
        return value;
      }

      const newPath = [...currentPath, prop];
      const pathString = JSON.stringify(newPath);
      parsedPaths.set(pathString, newPath);
      // Record this access path
      accessedPaths.add(pathString);

      // If the value is an object, return a proxy for it to track nested accesses
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isCollection(value)
      ) {
        return createTrackingProxy(value, accessedPaths, parsedPaths, newPath);
      }

      return value;
    },
  });

  // Save in weakmap for `getRawValue`
  // This is the easiest way to get value out of proxy
  proxyValuesWeakMap.set(proxy, target);

  return proxy;
};

/**
 * Checks the value at a specific path in the state object
 */
const isValueChangedAtPath = (
  prevState: StoreState,
  nextState: StoreState,
  path: AccessedPath
): boolean => {
  let currentPrev: any = prevState;
  let currentNext: any = nextState;
  for (const key of path) {
    currentPrev = currentPrev ? currentPrev[key] : undefined;
    currentNext = currentNext ? currentNext[key] : undefined;
    if (currentPrev === currentNext) {
      return false;
    }
  }
  return true;
};

/**
 * Checks if any of the accessed state paths have changed
 */
const hasStateChanged = (
  oldState: StoreState,
  newState: StoreState,
  accessedPaths: Set<string>,
  parsedPaths: Map<string, (string | symbol)[]>
): boolean => {
  for (const pathStr of accessedPaths) {
    const path = parsedPaths.get(pathStr);
    if (!path) {
      continue;
    }

    // Use reference equality for objects/arrays, strict equality for primitives
    if (isValueChangedAtPath(oldState, newState, path)) {
      return true;
    }
  }
  return false;
};

/**
 * Creates a cached selector that only re-runs when:
 * 1. Arguments change (shallow equality check)
 * 2. State fields that were accessed in the previous run have changed (reference equality)
 */
export const createCachedSelector = <ARGS extends any[] = [], R extends any = undefined>(
  selectorFunc: (state: StoreState, ...args: ARGS) => R,
  lockable: boolean
) => {
  let previousSelectResult: R | undefined = undefined;
  let previousArgs: ARGS | undefined = undefined;
  let previousState: StoreState | undefined = undefined;
  let accessedPaths: Set<string> = new Set();
  let parsedPaths = new Map<string, (string | symbol)[]>();

  return (state: StoreState, ...args: ARGS): R => {
    // Performance. This allows to do a batch of updates to store without trigerring
    // readable selectors.
    const rawValue = getRawValue<StoreState>(state);
    if (lockable && rawValue.storeUtility.updatesLocked && previousSelectResult !== undefined) {
      return previousSelectResult;
    }
    // Check if arguments changed
    const argsChanged = !previousArgs || !shallowEqual(args, previousArgs);

    // Check if any accessed state paths changed
    const stateChanged =
      !argsChanged && previousState
        ? hasStateChanged(previousState, rawValue, accessedPaths, parsedPaths)
        : true;

    // Only re-run selector if args or relevant state changed
    if (!argsChanged && !stateChanged && previousSelectResult !== undefined) {
      return previousSelectResult;
    }

    // Do not init tracking proxy when selector called with another proxy (means it is called by another selector)
    if (rawValue !== state) {
      const result = selectorFunc(state, ...args);
      previousArgs = args;
      previousSelectResult = result;
      return result;
    }

    // Track which state paths are accessed during this selector run
    const newAccessedPaths = new Set<string>();
    const trackedState = createTrackingProxy(state, newAccessedPaths, parsedPaths);

    // Run the selector with the tracking proxy
    const maybeProxyResult = selectorFunc(trackedState, ...args);

    // Returns original value, if selector returns proxy created for tracking;
    const result = getRawValue<R>(maybeProxyResult);

    // Cache the results and accessed paths
    const finalResult =
      previousSelectResult !== undefined && shallowEqual(previousSelectResult, result)
        ? previousSelectResult
        : result;
    previousSelectResult = finalResult;
    previousArgs = args;
    previousState = getRawValue(state);
    accessedPaths = newAccessedPaths;

    return finalResult;
  };
};

const isReadable = <T = any>(arg: unknown): arg is Readable<T> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "subscribe" in arg && typeof arg.subscribe === "function";
};

export const createSelector = <ARGS extends any[], R>(
  selectorFunc: (state: StoreState, ...args: ARGS) => R
): StoreSelector<R, ARGS> => {
  const boundSelector = (
    readableStoreState: Readable<StoreState>,
    ...restArgs: ReadableArgs<ARGS>
  ): Readable<R> => {
    // Cached selector here is lockable, means it will return prev value when store is locked for updates
    const cachedSelector = createCachedSelector<ARGS, R>(selectorFunc, true);
    const readableArgs = restArgs.map((arg) => {
      if (isReadable(arg)) {
        return arg;
      }
      return readable(arg);
    });
    return derived([readableStoreState, ...readableArgs], ([storeState, ...args]) => {
      return cachedSelector(storeState, ...(args as ARGS));
    });
  };

  const readableSelector = (...restArgs: ReadableArgs<ARGS>) => {
    const context = getStoreContext();
    if (!context) {
      throw new Error("Missing redux store context. Wrap root component into <Store/>");
    }
    return boundSelector(context.storeState, ...restArgs);
  };

  readableSelector.withStore =
    (store: ReduxStore) =>
    (...args: ReadableArgs<ARGS>) => {
      return boundSelector(createStoreStateReadable(store), ...args);
    };

  readableSelector.select = selectorFunc;
  readableSelector.effect = (...args: ARGS) => {
    return select(selectorFunc, ...args);
  };

  return readableSelector;
};

export const createCollectionItemSelector = <ITEM extends object, K extends keyof ITEM & string>(
  collectionSelector: (state: StoreState, ...args: any[]) => Collection<ITEM, K>
) => {
  return createSelector<[itemId: ITEM[K] & string], ITEM | undefined>(
    (state, itemId: ITEM[K] & string): ITEM | undefined => {
      if (!itemId) return undefined;
      const collection = collectionSelector(state);
      return collection.map[itemId];
    }
  );
};

export const createCollectionItemsListSelector = <
  ITEM extends object,
  K extends keyof ITEM & string,
  F extends (...args: any) => boolean,
>(
  collectionSelector: (state: StoreState, ...args: any[]) => Collection<ITEM, K>,
  itemFilter?: F
) => {
  return createSelector((state): ITEM[] => {
    const { map, ids } = collectionSelector(state);
    const list = ids.map((id) => map[id]);
    return itemFilter ? list.filter(itemFilter) : list;
  });
};

import type {
  CreateSelector,
  StoreState,
  ReduxStore,
  ReduxStoreContext,
  StoreSelector,
  StoreSelectorCallback,
  ReadableArgs,
  StoreReadableStateSource,
} from "../types";
import {
  getItems,
  type Collection,
} from "./collection-utils";
import type { Readable } from "svelte/store";
import { select } from "typed-redux-saga";
import { createCachedSelector } from "../../../store/utils/create-cached-selector";
import { getReduxStore } from "../redux-dispatch-bridge";

// ─── Lazy Svelte dependencies ───────────────────────────────────────
// Injected at renderer startup via initSvelteDeps(). The main process
// never calls initSvelteDeps(), so svelte is never loaded there.
// Only the readable selector form (selector()) uses these — the pure
// .select() and .effect() methods work without them.

export interface SvelteDeps {
  readable: <T>(value: T, start?: (set: (value: T) => void) => (() => void) | void) => Readable<T>;
  derived: <T>(
    stores: Readable<any> | Array<Readable<any>>,
    fn: (values: any) => T
  ) => Readable<T>;
  getStoreContext: () => ReduxStoreContext | undefined;
  isLifecycleOutsideComponentError: (error: unknown) => error is Error;
  createStoreStateReadable: (store: ReduxStore) => Readable<StoreState>;
  createThrottledReadable: <T>(source: Readable<T>) => Readable<T>;
}

let _deps: SvelteDeps | null = null;

export function initSvelteDeps(deps: SvelteDeps): void {
  _deps = deps;
}

function requireSvelteDeps(): SvelteDeps {
  if (!_deps) {
    throw new Error(
      "Svelte selector dependencies not initialized. " +
      "Call initSvelteDeps() during renderer startup before using readable selectors. " +
      "If you are in the main process, use selector.select(state, ...args) instead."
    );
  }
  return _deps;
}

export { createCachedSelector };

const SELECTOR_OUTSIDE_COMPONENT_MESSAGE =
  "Selector called outside component initialization. " +
  "The readable form of selectors (e.g., selectFoo()) can only be called " +
  "during component init (top-level <script> block). For event handlers, " +
  "callbacks, or async functions, use selector.select(store.state, ...args) instead.";

const assertReadableSelectorLifecycle = (): void => {
  const deps = requireSvelteDeps();

  try {
    deps.getStoreContext();
  } catch (error) {
    if (deps.isLifecycleOutsideComponentError(error)) {
      throw new Error(SELECTOR_OUTSIDE_COMPONENT_MESSAGE, { cause: error });
    }

    throw error;
  }
};

export const createSelector: CreateSelector = <ARGS extends any[], R>(
  selectorFunc: StoreSelectorCallback<R, ARGS>
): StoreSelector<R, ARGS> => {
  const boundSelector: (
    readableStoreState: Readable<StoreState>,
    ...restArgs: ReadableArgs<ARGS>
  ) => Readable<R> = (
    readableStoreState: Readable<StoreState>,
    ...restArgs: ReadableArgs<ARGS>
  ): Readable<R> => {
      const deps = requireSvelteDeps();
      const cachedSelector = createCachedSelector<StoreState, ARGS, R>(selectorFunc, {
        lockUpdatesPredicate: (state) => state.storeUtility.updatesLocked,
      });
      const readableArgs = restArgs.map((arg) => {
        if (isReadable(arg)) {
          return arg;
        }
        return deps.readable(arg);
      });
      const source = deps.derived([readableStoreState, ...readableArgs], ([storeState, ...args]: [StoreState, ...ARGS]) => {
        return cachedSelector(storeState, ...(args as ARGS));
      });

      return deps.createThrottledReadable(source);
    };

  const readableSelector: StoreSelector<R, ARGS> = ((...restArgs: ReadableArgs<ARGS>) => {
    assertReadableSelectorLifecycle();
    const deps = requireSvelteDeps();
    let context: ReduxStoreContext | undefined;

    try {
      context = deps.getStoreContext();
    } catch (error) {
      if (deps.isLifecycleOutsideComponentError(error)) {
        throw new Error(SELECTOR_OUTSIDE_COMPONENT_MESSAGE, { cause: error });
      }

      throw error;
    }

    if (!context) {
      const store = getReduxStore();
      if (!store) {
        throw new Error("Missing redux store context. Wrap root component into <Store/>");
      }
      return boundSelector(deps.createStoreStateReadable(store), ...restArgs);
    }
    return boundSelector(context.storeState, ...restArgs);
  }) as StoreSelector<R, ARGS>;

  readableSelector.withStore =
    (store: StoreReadableStateSource<StoreState> | ReduxStore) =>
      (...args: ReadableArgs<ARGS>) => {
        const deps = requireSvelteDeps();
        const storeState = hasReadableStoreState(store)
          ? store.getReadableState()
          : deps.createStoreStateReadable(store);
        return boundSelector(storeState, ...args);
      };
  readableSelector.select = selectorFunc;
  readableSelector.effect = (...args: ARGS) => {
    return select(selectorFunc, ...args);
  };

  return readableSelector;
};

const isReadable = <T = any>(arg: unknown): arg is Readable<T> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "subscribe" in arg && typeof arg.subscribe === "function";
};

const hasReadableStoreState = (store: unknown): store is StoreReadableStateSource<StoreState> => {
  return (
    !!store &&
    typeof store === "object" &&
    "getReadableState" in store &&
    typeof store.getReadableState === "function"
  );
};

export const createCollectionItemSelector = <ITEM extends object, K extends keyof ITEM & string>(
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[]>
) => {
  return createSelector<[itemId: ITEM[K] & string], ITEM | undefined>(
    (state, itemId: ITEM[K] & string): ITEM | undefined => {
      if (!itemId) return undefined;
      const collection = collectionSelector(state as StoreState);
      return collection.map[itemId];
    }
  );
};

export const createCollectionItemsListSelector = <
  ITEM extends object,
  K extends keyof ITEM & string,
  F extends (...args: any) => boolean,
>(
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[]>,
  itemFilter?: F
) => {
  return createSelector((state): ITEM[] => {
    const list = getItems(collectionSelector(state as StoreState));
    return itemFilter ? list.filter(itemFilter) : list;
  });
};

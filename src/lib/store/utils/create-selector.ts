import type {
  CreateSelector,
  StoreState,
  ReduxStore,
  ReduxStoreContext,
  StoreSelector,
  ReadableArgs,
  StoreSelectorCallback,
} from "../types";
import type { Collection } from "./collection-utils";
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

const isReadable = <T = any>(arg: unknown): arg is Readable<T> => {
  if (!arg || typeof arg !== "object") {
    return false;
  }

  return "subscribe" in arg && typeof arg.subscribe === "function";
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
      // Cached selector here is lockable, means it will return prev value when store is locked for updates
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

  const readableSelector: StoreSelector<R, ARGS> = (...restArgs: ReadableArgs<ARGS>) => {
    const deps = requireSvelteDeps();
    let context: ReduxStoreContext | undefined;

    try {
      context = deps.getStoreContext();
    } catch (error) {
      if (deps.isLifecycleOutsideComponentError(error)) {
        throw new Error(
          "Selector called outside component initialization. " +
          "The readable form of selectors (e.g., selectFoo()) can only be called " +
          "during component init (top-level <script> block). For event handlers, " +
          "callbacks, or async functions, use selector.select(getReduxStore().getState(), ...args) instead.",
          { cause: error }
        );
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
  };

  readableSelector.withStore =
    (store: ReduxStore) =>
      (...args: ReadableArgs<ARGS>) => {
        const deps = requireSvelteDeps();
        return boundSelector(deps.createStoreStateReadable(store), ...args);
      };

  readableSelector.select = selectorFunc;
  readableSelector.effect = (...args: ARGS) => {
    return select(selectorFunc, ...args);
  };

  return readableSelector;
};

export const createCollectionItemSelector = <ITEM extends object, K extends keyof ITEM & string>(
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[]>
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
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[]>,
  itemFilter?: F
) => {
  return createSelector((state): ITEM[] => {
    const { map, ids } = collectionSelector(state);
    const list = ids.map((id) => map[id]);
    return itemFilter ? list.filter(itemFilter) : list;
  });
};

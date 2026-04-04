import type {
  CreateSelector,
  StoreState,
  ReduxStore,
  StoreSelector,
  ReadableArgs,
  StoreSelectorCallback,
} from "../types";
import { getStoreContext, isLifecycleOutsideComponentError } from "./utils";
import type { Collection } from "./collection-utils";
import { readable, derived, type Readable } from "svelte/store";
import { createStoreStateReadable } from "./create-readable-store-state";
import { select } from "typed-redux-saga";
import { createCachedSelector } from "../../../store/utils/create-cached-selector";
import { createThrottledReadable } from "./selector-scheduler";
import { getReduxStore } from "../redux-dispatch-bridge";

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
    // Cached selector here is lockable, means it will return prev value when store is locked for updates
    const cachedSelector = createCachedSelector<StoreState, ARGS, R>(selectorFunc, {
      lockUpdatesPredicate: (state) => state.storeUtility.updatesLocked,
    });
    const readableArgs = restArgs.map((arg) => {
      if (isReadable(arg)) {
        return arg;
      }
      return readable(arg);
    });
    const source = derived([readableStoreState, ...readableArgs], ([storeState, ...args]) => {
      return cachedSelector(storeState, ...(args as ARGS));
    });

    return createThrottledReadable(source);
  };

  const readableSelector: StoreSelector<R, ARGS> = (...restArgs: ReadableArgs<ARGS>) => {
    let context: ReturnType<typeof getStoreContext>;

    try {
      context = getStoreContext();
    } catch (error) {
      if (isLifecycleOutsideComponentError(error)) {
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
      return boundSelector(createStoreStateReadable(store), ...restArgs);
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

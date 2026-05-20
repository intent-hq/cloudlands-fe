import type {
  CreateSelector,
  StoreSelector,
  StoreSelectorCallback,
} from "../types";
import {
  getItems,
  type Collection,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import { select } from "typed-redux-saga";

import { store } from "../configured-store";

export const createSelector: CreateSelector = <ARGS extends any[], R>(
  selectorFunc: StoreSelectorCallback<R, ARGS>
): StoreSelector<R, ARGS> => {
  let storeBoundSelector: StoreSelector<R, ARGS> | null = null;
  const getStoreBoundSelector = (): StoreSelector<R, ARGS> => {
    storeBoundSelector ??= store.createSelector(selectorFunc) as StoreSelector<R, ARGS>;
    return storeBoundSelector;
  };

  const readableSelector = ((...args) => getStoreBoundSelector()(...args)) as StoreSelector<R, ARGS>;

  readableSelector.withStore = (store) => (...args) => getStoreBoundSelector().withStore(store)(...args);
  readableSelector.select = selectorFunc as StoreSelector<R, ARGS>["select"];
  readableSelector.effect = ((...args) => select(selectorFunc, ...args)) as StoreSelector<R, ARGS>["effect"];

  return readableSelector;
};

export const createCollectionItemSelector = <ITEM extends object, K extends keyof ITEM & string>(
  collectionSelector: StoreSelectorCallback<Collection<ITEM, K>, any[]>
) => {
  return createSelector<[itemId: ITEM[K] & string], ITEM | undefined>(
    (state, itemId: ITEM[K] & string): ITEM | undefined => {
      if (!itemId) return undefined;
      return collectionSelector(state).map[itemId];
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
    const list = getItems(collectionSelector(state));
    return itemFilter ? list.filter(itemFilter) : list;
  });
};
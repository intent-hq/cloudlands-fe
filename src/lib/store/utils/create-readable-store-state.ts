import { type Readable, readable } from "svelte/store";
import type { ReduxStore, StoreState } from "../types";

export const createStoreStateReadable = (store: ReduxStore): Readable<StoreState> => {
  const getStoreStateChange = () => {
    return store.getState();
  };

  const storeStartStopNotifier = (set: (val: StoreState) => void): (() => void) => {
    set(getStoreStateChange());
    return store.subscribe(() => set(getStoreStateChange()));
  };

  return readable(getStoreStateChange(), storeStartStopNotifier);
};

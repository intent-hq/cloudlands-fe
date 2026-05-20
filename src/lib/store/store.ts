import { Store } from "svelte-redux-toolkit/store";
import type {
  StoreInstanceState,
  StoreMiddleware,
} from "svelte-redux-toolkit/types";

import { middleware } from "./middleware";
import { reducers } from "./reducer";
import {
  sagaNames,
  sagas,
} from "./sagas";

export const store = new Store(reducers, sagas, middleware as unknown as StoreMiddleware[]);
export const appStore = store;

export type AppStore = typeof store;
export type AppStoreState = StoreInstanceState<typeof store>;
export type AppStoreRuntime = Pick<AppStore, "init" | "getReadableState" | "dispatch" | "state" | "runSaga">;

export function startAllAppSagas(configuredStore: Pick<AppStore, "runSaga"> = store): Array<() => void> {
  return sagaNames.map((name) => configuredStore.runSaga(name));
}

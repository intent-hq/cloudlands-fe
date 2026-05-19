import { Store } from "svelte-redux-toolkit/store";
import type {
  StoreMiddleware,
  StoreState as PackageStoreState,
} from "svelte-redux-toolkit/types";

import { middleware } from "./middleware";
import { reducers } from "./reducer";
import {
  sagaNames,
  sagas,
} from "./sagas";

export const appStore = new Store(reducers, sagas, middleware as unknown as StoreMiddleware[]);
export const store = appStore;

export type AppStore = typeof appStore;
export type AppStoreState = PackageStoreState<AppStore>;
export type AppStoreRuntime = Pick<AppStore, "init" | "getReadableState" | "dispatch" | "state" | "runSaga">;

export function startAllAppSagas(configuredStore: Pick<AppStore, "runSaga"> = appStore): Array<() => void> {
  return sagaNames.map((name) => configuredStore.runSaga(name));
}
import type { StoreSagaName } from "svelte-redux-toolkit/types";

import {
  appStore,
  initAppStore,
} from "./store";
import {
  sagaNames,
  sagas,
} from "./sagas";
import type { PreloadedStoreState } from "./types";

export const registeredAppStore = appStore.registerSagas(sagas);

export type RegisteredAppStore = typeof registeredAppStore;
export type RegisteredSagaName = StoreSagaName<RegisteredAppStore>;
export type RegisteredAppStoreRuntime = Pick<
  RegisteredAppStore,
  "init" | "getReadableState" | "dispatch" | "state" | "runSaga"
>;

export const registeredSagaNames: RegisteredSagaName[] = sagaNames;

export function startAllAppSagas(
  configuredStore: Pick<RegisteredAppStore, "runSaga"> = registeredAppStore
): Array<() => void> {
  return registeredSagaNames.map((name) => configuredStore.runSaga(name));
}

export const initRegisteredAppStore = (
  loadedState?: PreloadedStoreState,
  configuredStore: RegisteredAppStoreRuntime = registeredAppStore
) => initAppStore(loadedState, configuredStore);
import type { Store } from "svelte-redux-toolkit/store";

import {
  sagaNames,
  sagas,
} from "./sagas";
import type { SagaName } from "./types";

export const registeredSagaNames: SagaName[] = sagaNames;

export function startAllAppSagas(
  storeArg: Store<any, any, any>
): Array<() => void> {
  const registeredStore = storeArg.registerSagas(sagas);

  return registeredSagaNames.map((name) => registeredStore.runSaga(name));
}

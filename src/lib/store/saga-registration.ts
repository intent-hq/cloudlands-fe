import type { Store } from "svelte-redux-toolkit/store";

import {
  sagaNames,
  sagas,
} from "./sagas";
import type { SagaName } from "./types";

export const registeredSagaNames: SagaName[] = sagaNames;

export function startAllAppSagas(
  store: Store<any, any>
): Array<() => void> {
  const sagasList = Object.values(sagas);
  return sagasList.map((saga) => store.runSaga(saga));
}

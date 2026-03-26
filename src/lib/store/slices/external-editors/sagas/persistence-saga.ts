import { setLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, takeEvery, type SagaGenerator } from "typed-redux-saga";
import { selectOpenAction } from "../external-editors-selectors";
import { setOpenAction } from "../external-editors-slice";

const STORAGE_KEY = "open-combo-button-last-action";

function* persistAction(action: string): SagaGenerator<void> {
  yield* call(setLocalStorageItem, STORAGE_KEY, action);
}

/**
 * Watches for open action changes and persists to localStorage.
 */
export function* persistenceSaga() {
  yield* takeEvery([setOpenAction.type], function* () {
    const action = yield* selectOpenAction.effect();
    yield* call(persistAction, action);
  });
}
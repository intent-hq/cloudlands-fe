import { setLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { call, takeEvery, type SagaGenerator } from "typed-redux-saga";
import { clearForWorkspace, removeScrollPosition, saveScrollPosition } from "../tab-state-slice";
import { selectAllScrollPositions } from "../tab-state-selectors";

const STORAGE_KEY = "tab-scroll-positions";

function* persistPositions(positions: Record<string, number>): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, STORAGE_KEY, positions);
}

export function* persistenceSaga() {
  yield* takeEvery(
    [saveScrollPosition.type, removeScrollPosition.type, clearForWorkspace.type],
    function* () {
      const positions = yield* selectAllScrollPositions.effect();
      yield* call(persistPositions, positions);
    }
  );
}
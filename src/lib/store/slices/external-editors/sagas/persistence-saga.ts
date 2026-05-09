import { setLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import { selectHiddenEditorIds, selectOpenAction } from "../external-editors-selectors";
import {
  normalizeHiddenEditorIds,
  setHiddenEditorIds,
  setOpenAction,
  toggleHiddenEditor,
} from "../external-editors-slice";

const STORAGE_KEY = "open-combo-button-last-action";
const HIDDEN_OPEN_IN_EDITORS_KEY = "hiddenOpenInEditors";

async function invokeSettings(channel: string, data?: any): Promise<any> {
  if (typeof window === "undefined" || !window.electronAPI) return undefined;
  return await window.electronAPI.invoke(channel, data);
}

function* persistAction(action: string): SagaGenerator<void> {
  yield* call(setLocalStorageItem, STORAGE_KEY, action);
}

function* loadHiddenEditorIds(): SagaGenerator<void> {
  try {
    const result = yield* call(invokeSettings, "settings:get", {
      key: HIDDEN_OPEN_IN_EDITORS_KEY,
    });
    yield* put(setHiddenEditorIds(normalizeHiddenEditorIds(result?.data)));
  } catch {
    // Ignore load errors; hidden editors default to visible.
  }
}

function* persistHiddenEditorIds(): SagaGenerator<void> {
  try {
    const hiddenEditorIds = yield* selectHiddenEditorIds.effect();
    yield* call(invokeSettings, "settings:set", {
      key: HIDDEN_OPEN_IN_EDITORS_KEY,
      value: hiddenEditorIds,
    });
  } catch {
    // Ignore save errors.
  }
}

/**
 * Loads hidden editor IDs and watches for preference changes to persist.
 */
export function* persistenceSaga() {
  yield* call(loadHiddenEditorIds);
  yield* takeEvery([setOpenAction], function* () {
    const action = yield* selectOpenAction.effect();
    yield* call(persistAction, action);
  });
  yield* takeEvery([toggleHiddenEditor], persistHiddenEditorIds);
}
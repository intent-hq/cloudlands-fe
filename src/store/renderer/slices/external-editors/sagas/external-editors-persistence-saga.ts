import { call, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { getLocalStorageItem, setLocalStorageItem } from '../../../utils/safe-local-storage-saga';
import { selectHiddenEditorIds } from '../external-editors-selectors';
import {
  normalizeHiddenEditorIds,
  setHiddenEditorIds,
  setOpenAction,
  toggleHiddenEditor,
} from '../external-editors-slice';

const OPEN_ACTION_STORAGE_KEY = 'open-combo-button-last-action';
const HIDDEN_EDITORS_STORAGE_KEY = 'legacy-settings:hiddenOpenInEditors';

export function* hydrateHiddenEditorIdsWorker(): SagaGenerator<void> {
  const stored = yield* call(getLocalStorageItem, HIDDEN_EDITORS_STORAGE_KEY);
  if (!stored) return;

  try {
    yield* put(setHiddenEditorIds(normalizeHiddenEditorIds(JSON.parse(stored))));
  } catch {
    // Hidden editors default to visible when persisted JSON is invalid.
  }
}

export function* persistOpenActionWorker(
  action: ReturnType<typeof setOpenAction>,
): SagaGenerator<void> {
  const [openAction] = action.payload;
  if (typeof openAction !== 'string') return;
  yield* call(setLocalStorageItem, OPEN_ACTION_STORAGE_KEY, openAction);
}

export function* persistHiddenEditorIdsWorker(): SagaGenerator<void> {
  const hiddenEditorIds = yield* selectHiddenEditorIds.effect();
  yield* call(setLocalStorageItem, HIDDEN_EDITORS_STORAGE_KEY, JSON.stringify(hiddenEditorIds));
}

function* watchExternalEditorPersistence(): SagaGenerator<void> {
  yield* takeEvery(setOpenAction, persistOpenActionWorker);
  yield* takeEvery(toggleHiddenEditor, persistHiddenEditorIdsWorker);
}

/** Unregistered until the S20 middleware cutover. */
export function* externalEditorsPersistenceSaga(): SagaGenerator<void> {
  yield* call(hydrateHiddenEditorIdsWorker);
  yield* fork(watchExternalEditorPersistence);
}

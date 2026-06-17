import {
  removeLocalStorageItem,
  setLocalStorageJSON,
  getLocalStorageJSON,
} from '$store/renderer/utils/safe-local-storage-saga';
import {
  call,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { debounceWithKeySaga } from '@augmentcode/ag-redux-toolkit/utils/sagas/debounce-saga';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { removeWorkspaceEntity } from '../../workspace/workspace-slice';
import {
  clearChatDraft,
  clearWorkspaceTransientUi,
  hydrateWorkspaceTransientUi,
  persistWorkspaceTransientUi,
  requestPersistWorkspaceTransientUi,
  SAVE_DEBOUNCE_MS,
  setChatDraft,
  setRawNoteViewEnabled,
  setSidebarActiveTab,
  setViewedFiles,
  toggleRawNoteView,
  type TransientUiWorkspaceState,
} from '../transient-ui-slice';
import {
  getTransientUiStorageKey,
  sanitizePersistedTransientUiState,
} from '../utils/persistence';
import { selectTransientUiWorkspaceStateEntry } from '../transient-ui-selectors';

const DEBOUNCED_PERSIST_ACTION_TYPES = [
  setViewedFiles,
  setSidebarActiveTab,
  setRawNoteViewEnabled,
  toggleRawNoteView,
  setChatDraft,
  clearChatDraft,
] as const;

function* persistWorkspaceState(
  workspaceId: string,
  workspaceState: TransientUiWorkspaceState,
): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, getTransientUiStorageKey(workspaceId), {
    ...workspaceState,
    timestamp: Date.now(),
  });
}

type WorkspaceScopedAction = { payload: [workspaceId: string, ...rest: unknown[]] };

export function* queueTransientUiPersistence(action: WorkspaceScopedAction): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* put(requestPersistWorkspaceTransientUi(persistWorkspaceTransientUi(workspaceId)));
}

export function* handlePersistWorkspace(
  action: ReturnType<typeof persistWorkspaceTransientUi>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const workspaceState = yield* selectTransientUiWorkspaceStateEntry.effect(workspaceId);

  if (!workspaceState) {
    yield* call(removeLocalStorageItem, getTransientUiStorageKey(workspaceId));
    return;
  }

  yield* call(persistWorkspaceState, workspaceId, workspaceState);
}

export function* handleWorkspaceMounted(
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const storageKey = getTransientUiStorageKey(workspaceId);
  const persisted = yield* call(getLocalStorageJSON<unknown>, storageKey);

  if (persisted === undefined) {
    return;
  }

  const { state, removeStorage, persistSanitized } = sanitizePersistedTransientUiState(persisted);
  if (!state) {
    if (removeStorage) {
      yield* call(removeLocalStorageItem, storageKey);
    }
    return;
  }

  yield* put(hydrateWorkspaceTransientUi(workspaceId, state));

  if (persistSanitized) {
    yield* call(persistWorkspaceState, workspaceId, state);
  }
}

export function* handleRemovedWorkspace(
  action: ReturnType<typeof removeWorkspaceEntity>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* put(clearWorkspaceTransientUi(workspaceId));
  yield* call(removeLocalStorageItem, getTransientUiStorageKey(workspaceId));
}

function getWorkspaceIdFromWrappedPersistAction(
  action: ReturnType<typeof persistWorkspaceTransientUi>,
): string {
  return action.payload[0];
}

export function* transientUiSaga() {
  yield* takeEvery(workspaceMounted, handleWorkspaceMounted);

  for (const actionCreator of DEBOUNCED_PERSIST_ACTION_TYPES) {
    yield* takeEvery(actionCreator, queueTransientUiPersistence);
  }

  yield* takeEvery(persistWorkspaceTransientUi, handlePersistWorkspace);
  yield* takeEvery(removeWorkspaceEntity, handleRemovedWorkspace);

  yield* fork(
    debounceWithKeySaga,
    requestPersistWorkspaceTransientUi,
    SAVE_DEBOUNCE_MS,
    getWorkspaceIdFromWrappedPersistAction,
  );
}

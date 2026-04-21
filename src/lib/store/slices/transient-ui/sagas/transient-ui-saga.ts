import { removeLocalStorageItem, setLocalStorageJSON, getLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { call, fork, put, select, takeEvery, type SagaGenerator } from "typed-redux-saga";
import type { StoreState } from "../../../types";
import { debounceWithKeySaga } from "../../../utils/debounce-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceEntity } from "../../workspace/workspace-slice";
import {
  clearChatDraft,
  clearWorkspaceTransientUi,
  hydrateWorkspaceTransientUi,
  persistWorkspaceTransientUi,
  requestPersistWorkspaceTransientUi,
  SAVE_DEBOUNCE_MS,
  setChatDraft,
  setSidebarActiveTab,
  setViewedFiles,
  type TransientUiWorkspaceState,
} from "../transient-ui-slice";
import {
  getTransientUiStorageKey,
  sanitizePersistedTransientUiState,
} from "../utils/persistence";

const DEBOUNCED_PERSIST_ACTION_TYPES = [
  setViewedFiles,
  setSidebarActiveTab,
  setChatDraft,
  clearChatDraft,
] as const;

function* persistWorkspaceState(
  workspaceId: string,
  workspaceState: TransientUiWorkspaceState
): SagaGenerator<void> {
  yield* call(setLocalStorageJSON, getTransientUiStorageKey(workspaceId), {
    ...workspaceState,
    timestamp: Date.now(),
  });
}

function selectWorkspaceStateEntry(state: StoreState, workspaceId: string) {
  return state.transientUi.byWorkspaceId[workspaceId] ?? null;
}

type WorkspaceScopedAction = { payload: [workspaceId: string, ...rest: unknown[]] };

export function* queueTransientUiPersistence(action: WorkspaceScopedAction): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* put(requestPersistWorkspaceTransientUi(persistWorkspaceTransientUi(workspaceId)));
}

export function* handlePersistWorkspace(
  action: ReturnType<typeof persistWorkspaceTransientUi>
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const workspaceState = yield* select(selectWorkspaceStateEntry, workspaceId);

  if (!workspaceState) {
    yield* call(removeLocalStorageItem, getTransientUiStorageKey(workspaceId));
    return;
  }

  yield* call(persistWorkspaceState, workspaceId, workspaceState);
}

export function* handleWorkspaceMounted(
  action: ReturnType<typeof workspaceMounted>
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
  action: ReturnType<typeof removeWorkspaceEntity>
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* put(clearWorkspaceTransientUi(workspaceId));
  yield* call(removeLocalStorageItem, getTransientUiStorageKey(workspaceId));
}

function getWorkspaceIdFromWrappedPersistAction(action: ReturnType<typeof persistWorkspaceTransientUi>): string {
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
    getWorkspaceIdFromWrappedPersistAction
  );
}
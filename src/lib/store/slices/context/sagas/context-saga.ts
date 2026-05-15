import {
  call,
  put,
  fork,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  initContextForWorkspace,
  hydrateContextItems,
  addContextItem,
  removeContextItem,
  updateContextItem,
} from "../context-slice";
import { selectContextItems } from "../context-selectors";
import type { ContextItem } from "$features/context/types";

// ============================================================================
// Constants
// ============================================================================

function storageKey(workspaceId: string): string {
  return `workspace:context:${workspaceId}`;
}

/** Workspace IDs that have already been hydrated from localStorage. */
const initializedWorkspaces = new Set<string>();

// ============================================================================
// Init saga — load from localStorage on workspace init
// ============================================================================

function* handleInitContext(
  action: ReturnType<typeof initContextForWorkspace>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;

  if (initializedWorkspaces.has(workspaceId)) {
    return;
  }

  const stored = yield* call(getLocalStorageJSON<ContextItem[]>, storageKey(workspaceId));
  if (stored && Array.isArray(stored)) {
    yield* put(hydrateContextItems(workspaceId, stored));
  }

  initializedWorkspaces.add(workspaceId);
}

// ============================================================================
// Persistence saga — save to localStorage on every mutation
// ============================================================================

function* persistContextItems(
  action: ReturnType<typeof addContextItem> | ReturnType<typeof removeContextItem> | ReturnType<typeof updateContextItem>,
): SagaGenerator<void> {
  const workspaceId = action.payload[0];
  const items = yield* selectContextItems.effect(workspaceId);
  yield* call(setLocalStorageJSON, storageKey(workspaceId), items);
}

// ============================================================================
// Root saga
// ============================================================================

function* initSaga(): SagaGenerator<void> {
  yield* takeEvery(initContextForWorkspace, handleInitContext);
}

function* persistenceSaga(): SagaGenerator<void> {
  yield* takeEvery(
    [addContextItem, removeContextItem, updateContextItem],
    persistContextItems,
  );
}

export function* contextSaga(): SagaGenerator<void> {
  yield* fork(initSaga);
  yield* fork(persistenceSaga);
}


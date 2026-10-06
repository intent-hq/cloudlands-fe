import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import { getLocalStorageJSON, setLocalStorageJSON } from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectChiefActiveAgentId,
  selectMultiSelectSidebarSelectedTabIds,
  selectPinnedWorkspaceIds,
  selectWorkspaceCollapsedNoteIds,
  selectWorkspaceNoteOrder,
} from '../sidebar-nav-selectors';
import {
  CHIEF_ACTIVE_AGENT_ID_KEY,
  hydrateSidebarNav,
  hydrateWorkspaceSidebarUi,
  MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  PINNED_WORKSPACES_KEY,
  setChiefActiveAgentId,
  setMultiSelectSidebarSelectedTabs,
  setWorkspaceNoteOrder,
  togglePinWorkspace,
  toggleWorkspaceCollapsedNote,
  WORKSPACE_COLLAPSED_NOTES_PREFIX,
  WORKSPACE_NOTE_ORDER_PREFIX,
} from '../sidebar-nav-slice';

function pinnedWorkspacesKey(backendId: string): string {
  return namespaceBackendKey(PINNED_WORKSPACES_KEY, backendId);
}

function chiefActiveAgentIdKey(backendId: string): string {
  return namespaceBackendKey(CHIEF_ACTIVE_AGENT_ID_KEY, backendId);
}

function multiSelectTabOrderKey(backendId: string): string {
  return namespaceBackendKey(MULTISELECT_SIDEBAR_TAB_ORDER_KEY, backendId);
}

// Per-workspace keys embed backend-specific workspace IDs, so they are
// backend-namespaced too (local keeps the legacy un-prefixed key).
function selectedTabsKey(backendId: string, workspaceId: string): string {
  return namespaceBackendKey(
    `${MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX}${workspaceId}`,
    backendId,
  );
}

function noteOrderKey(backendId: string, workspaceId: string): string {
  return namespaceBackendKey(`${WORKSPACE_NOTE_ORDER_PREFIX}${workspaceId}`, backendId);
}

function collapsedNotesKey(backendId: string, workspaceId: string): string {
  return namespaceBackendKey(`${WORKSPACE_COLLAPSED_NOTES_PREFIX}${workspaceId}`, backendId);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function* hydrateSidebarNavState(): SagaGenerator<void> {
  try {
    const backendId = yield* selectActiveBackendId();
    const data: Parameters<typeof hydrateSidebarNav>[0] = {};
    const pinned = stringArray(
      yield* call(getLocalStorageJSON<unknown>, pinnedWorkspacesKey(backendId)),
    );
    if (pinned !== undefined) data.pinnedWorkspaceIds = pinned;

    const chiefAgentId = yield* call(
      getLocalStorageJSON<unknown>,
      chiefActiveAgentIdKey(backendId),
    );
    if (chiefAgentId === null || typeof chiefAgentId === 'string') {
      data.chiefActiveAgentId = chiefAgentId;
    }

    const tabOrder = stringArray(
      yield* call(getLocalStorageJSON<unknown>, multiSelectTabOrderKey(backendId)),
    );
    if (tabOrder !== undefined) data.multiSelectTabOrder = tabOrder;

    if (Object.keys(data).length > 0) yield* put(hydrateSidebarNav(data));
  } catch {
    // Hydration is best-effort; malformed or unavailable storage is ignored.
  }
}

function* persistPinnedWorkspaces(): SagaGenerator<void> {
  try {
    yield* call(
      setLocalStorageJSON,
      pinnedWorkspacesKey(yield* selectActiveBackendId()),
      yield* selectPinnedWorkspaceIds.effect(),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistChiefActiveAgentId(): SagaGenerator<void> {
  try {
    yield* call(
      setLocalStorageJSON,
      chiefActiveAgentIdKey(yield* selectActiveBackendId()),
      yield* selectChiefActiveAgentId.effect(),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* hydrateWorkspaceSidebarUiState(
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  try {
    const backendId = yield* selectActiveBackendId();
    const data: { selectedTabIds?: string[]; noteOrder?: string[]; collapsedNoteIds?: string[] } =
      {};
    const selectedTabIds = stringArray(
      yield* call(getLocalStorageJSON<unknown>, selectedTabsKey(backendId, workspaceId)),
    );
    if (selectedTabIds !== undefined) data.selectedTabIds = selectedTabIds;
    const noteOrder = stringArray(
      yield* call(getLocalStorageJSON<unknown>, noteOrderKey(backendId, workspaceId)),
    );
    if (noteOrder !== undefined) data.noteOrder = noteOrder;
    const collapsedNoteIds = stringArray(
      yield* call(getLocalStorageJSON<unknown>, collapsedNotesKey(backendId, workspaceId)),
    );
    if (collapsedNoteIds !== undefined) data.collapsedNoteIds = collapsedNoteIds;
    if (Object.keys(data).length > 0) yield* put(hydrateWorkspaceSidebarUi(workspaceId, data));
  } catch {
    // Hydration is best-effort; malformed or unavailable storage is ignored.
  }
}

function* persistWorkspaceSelectedTabs(
  action: ReturnType<typeof setMultiSelectSidebarSelectedTabs>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  try {
    yield* call(
      setLocalStorageJSON,
      selectedTabsKey(yield* selectActiveBackendId(), workspaceId),
      yield* selectMultiSelectSidebarSelectedTabIds.effect(workspaceId),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistWorkspaceNoteOrder(
  action: ReturnType<typeof setWorkspaceNoteOrder>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  try {
    yield* call(
      setLocalStorageJSON,
      noteOrderKey(yield* selectActiveBackendId(), workspaceId),
      yield* selectWorkspaceNoteOrder.effect(workspaceId),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistWorkspaceCollapsedNotes(
  action: ReturnType<typeof toggleWorkspaceCollapsedNote>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  try {
    yield* call(
      setLocalStorageJSON,
      collapsedNotesKey(yield* selectActiveBackendId(), workspaceId),
      yield* selectWorkspaceCollapsedNoteIds.effect(workspaceId),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

/**
 * Backend switched (activeId flips via the boot connections:list refresh after
 * the window reloads): re-hydrate the per-backend keys from the incoming
 * backend's namespace, resetting to empty where it has none so the previous
 * backend's pins/tab order don't linger.
 */
function* watchBackendSwitch(): SagaGenerator<void> {
  let lastBackendId = yield* selectActiveBackendId();
  while (true) {
    yield* take(connectionsListReceived);
    const backendId = yield* selectActiveBackendId();
    if (backendId === lastBackendId) continue;
    lastBackendId = backendId;
    try {
      const pinned = stringArray(
        yield* call(getLocalStorageJSON<unknown>, pinnedWorkspacesKey(backendId)),
      );
      const chiefAgentId = yield* call(
        getLocalStorageJSON<unknown>,
        chiefActiveAgentIdKey(backendId),
      );
      const tabOrder = stringArray(
        yield* call(getLocalStorageJSON<unknown>, multiSelectTabOrderKey(backendId)),
      );
      yield* put(
        hydrateSidebarNav({
          pinnedWorkspaceIds: pinned ?? [],
          chiefActiveAgentId: typeof chiefAgentId === 'string' ? chiefAgentId : null,
          multiSelectTabOrder: tabOrder ?? [],
        }),
      );
    } catch {
      // Backend-specific hydration is best-effort; keep watching future switches.
    }
  }
}

export function* sidebarNavSaga(): SagaGenerator<void> {
  yield* call(hydrateSidebarNavState);
  yield* fork(watchBackendSwitch);
  yield* takeEvery(togglePinWorkspace, persistPinnedWorkspaces);
  yield* takeEvery(setChiefActiveAgentId, persistChiefActiveAgentId);
  yield* takeEvery(workspaceMounted, hydrateWorkspaceSidebarUiState);
  yield* takeEvery(setMultiSelectSidebarSelectedTabs, persistWorkspaceSelectedTabs);
  yield* takeEvery(setWorkspaceNoteOrder, persistWorkspaceNoteOrder);
  yield* takeEvery(toggleWorkspaceCollapsedNote, persistWorkspaceCollapsedNotes);
}

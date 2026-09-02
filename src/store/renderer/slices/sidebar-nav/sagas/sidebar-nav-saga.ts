import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  namespaceBackendKey,
  selectActiveBackendId,
} from '../../../utils/backend-storage-namespace';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '../../../utils/safe-local-storage-saga';
import { connectionsListReceived } from '../../connections/connections-slice';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectAllSpacesViewMode,
  selectChiefActiveAgentId,
  selectCollapsedStatusGroupIds,
  selectCombinedPanelSplit,
  selectIsChiefCollapsed,
  selectIsCardPinned,
  selectMultiSelectSidebarSelectedTabIds,
  selectPanelItem,
  selectPanelWidth,
  selectPinnedWorkspaceIds,
  selectShowArchivedWorkspaces,
  selectWorkspaceCollapsedNoteIds,
  selectWorkspaceNoteOrder,
} from '../sidebar-nav-selectors';
import {
  CARD_PINNED_KEY,
  CHIEF_ACTIVE_AGENT_ID_KEY,
  CHIEF_COLLAPSED_KEY,
  COLLAPSED_STATUS_GROUPS_KEY,
  COMBINED_PANEL_SPLIT_KEY,
  closeAll,
  closeHoverCards,
  closePanel,
  hydrateSidebarNav,
  hydrateWorkspaceSidebarUi,
  LEGACY_HOME_PANEL_SPLIT_KEY,
  MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  openPanel,
  PANEL_ITEM_KEY,
  PANEL_WIDTH_KEY,
  PINNED_WORKSPACES_KEY,
  setAllSpacesViewMode,
  setCardPinned,
  setChiefActiveAgentId,
  setChiefCollapsed,
  setCombinedPanelSplit,
  setMultiSelectSidebarSelectedTabs,
  setPanelWidth,
  setShowArchivedWorkspaces,
  setWorkspaceNoteOrder,
  SHOW_ARCHIVED_KEY,
  toggleCardPinned,
  toggleChiefCollapsed,
  togglePanel,
  togglePinWorkspace,
  toggleStatusGroupCollapsed,
  toggleWorkspaceCollapsedNote,
  VIEW_MODE_KEY,
  WORKSPACE_COLLAPSED_NOTES_PREFIX,
  WORKSPACE_NOTE_ORDER_PREFIX,
} from '../sidebar-nav-slice';
import type { AllSpacesViewMode, SidebarNavItem } from '../sidebar-nav-types';

const PINNED_ACTIONS = [togglePinWorkspace];
const PANEL_ITEM_ACTIONS = [openPanel, closePanel, togglePanel, closeAll];
const CARD_PINNED_ACTIONS = [setCardPinned, toggleCardPinned, closeHoverCards];

// Pinned workspace IDs, the multi-select sidebar tab order, and the chief
// active agent id all reference backend-specific workspace/agent IDs, so they
// are namespaced per backend (local keeps the legacy un-prefixed key). The
// remaining keys (view mode, panel width/item, card-pinned) are global UI
// preferences shared across backends and stay un-namespaced.
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

function parseViewMode(raw: string | null): {
  mode?: AllSpacesViewMode;
  legacy: boolean;
} {
  if (raw === null) return { legacy: false };
  let value: unknown;
  let legacy = false;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
    legacy = true;
  }
  return value === 'recent' || value === 'repo' || value === 'status'
    ? { mode: value, legacy }
    : { legacy };
}

function panelItem(value: unknown): SidebarNavItem | 'home' | null | undefined {
  if (value === null) return null;
  const validItems: readonly string[] = [
    'home',
    'new-workspace',
    'active',
    'chief',
    'all-workspaces',
    'settings',
  ];
  return typeof value === 'string' && validItems.includes(value)
    ? (value as SidebarNavItem | 'home')
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

    const viewMode = parseViewMode(yield* call(getLocalStorageItem, VIEW_MODE_KEY));
    if (viewMode.mode !== undefined) {
      data.allSpacesViewMode = viewMode.mode;
      if (viewMode.legacy) yield* call(setLocalStorageJSON, VIEW_MODE_KEY, viewMode.mode);
    }

    const showArchived = yield* call(getLocalStorageJSON<unknown>, SHOW_ARCHIVED_KEY);
    if (typeof showArchived === 'boolean') data.showArchivedWorkspaces = showArchived;

    const collapsedStatusGroups = stringArray(
      yield* call(getLocalStorageJSON<unknown>, COLLAPSED_STATUS_GROUPS_KEY),
    );
    if (collapsedStatusGroups !== undefined) {
      data.collapsedStatusGroupIds = collapsedStatusGroups;
    }

    const chiefCollapsed = yield* call(getLocalStorageJSON<unknown>, CHIEF_COLLAPSED_KEY);
    if (typeof chiefCollapsed === 'boolean') data.isChiefCollapsed = chiefCollapsed;

    const width = yield* call(getLocalStorageJSON<unknown>, PANEL_WIDTH_KEY);
    if (typeof width === 'number' && Number.isFinite(width)) data.panelWidth = width;

    const combinedSplit = yield* call(getLocalStorageJSON<unknown>, COMBINED_PANEL_SPLIT_KEY);
    if (typeof combinedSplit === 'number' && Number.isFinite(combinedSplit)) {
      data.combinedPanelSplit = combinedSplit;
    } else {
      const legacySplit = yield* call(getLocalStorageJSON<unknown>, LEGACY_HOME_PANEL_SPLIT_KEY);
      if (typeof legacySplit === 'number' && Number.isFinite(legacySplit)) {
        data.combinedPanelSplit = legacySplit;
        yield* call(setLocalStorageJSON, COMBINED_PANEL_SPLIT_KEY, legacySplit);
      }
    }

    const item = panelItem(yield* call(getLocalStorageJSON<unknown>, PANEL_ITEM_KEY));
    if (item !== undefined) data.panelItem = item;

    const pinnedCard = yield* call(getLocalStorageJSON<unknown>, CARD_PINNED_KEY);
    if (typeof pinnedCard === 'boolean') data.isCardPinned = pinnedCard;

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

function* persistViewMode(): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageJSON, VIEW_MODE_KEY, yield* selectAllSpacesViewMode.effect());
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistShowArchivedWorkspaces(): SagaGenerator<void> {
  try {
    yield* call(
      setLocalStorageJSON,
      SHOW_ARCHIVED_KEY,
      yield* selectShowArchivedWorkspaces.effect(),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistCollapsedStatusGroups(): SagaGenerator<void> {
  try {
    yield* call(
      setLocalStorageJSON,
      COLLAPSED_STATUS_GROUPS_KEY,
      yield* selectCollapsedStatusGroupIds.effect(),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistChiefCollapsed(): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageJSON, CHIEF_COLLAPSED_KEY, yield* selectIsChiefCollapsed.effect());
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistPanelWidth(): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageJSON, PANEL_WIDTH_KEY, yield* selectPanelWidth.effect());
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistCombinedPanelSplit(): SagaGenerator<void> {
  try {
    yield* call(
      setLocalStorageJSON,
      COMBINED_PANEL_SPLIT_KEY,
      yield* selectCombinedPanelSplit.effect(),
    );
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistPanelAndCardState(): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageJSON, PANEL_ITEM_KEY, yield* selectPanelItem.effect());
    yield* call(setLocalStorageJSON, CARD_PINNED_KEY, yield* selectIsCardPinned.effect());
  } catch {
    // Storage failures are non-fatal and must not terminate the watcher.
  }
}

function* persistCardPinned(): SagaGenerator<void> {
  try {
    yield* call(setLocalStorageJSON, CARD_PINNED_KEY, yield* selectIsCardPinned.effect());
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

/** Unregistered until the S20 middleware cutover. */
export function* sidebarNavSaga(): SagaGenerator<void> {
  yield* call(hydrateSidebarNavState);
  yield* fork(watchBackendSwitch);
  yield* takeEvery(PINNED_ACTIONS, persistPinnedWorkspaces);
  yield* takeEvery(setAllSpacesViewMode, persistViewMode);
  yield* takeEvery(setShowArchivedWorkspaces, persistShowArchivedWorkspaces);
  yield* takeEvery(toggleStatusGroupCollapsed, persistCollapsedStatusGroups);
  yield* takeEvery([setChiefCollapsed, toggleChiefCollapsed], persistChiefCollapsed);
  yield* takeEvery(setPanelWidth, persistPanelWidth);
  yield* takeEvery(setCombinedPanelSplit, persistCombinedPanelSplit);
  yield* takeEvery(PANEL_ITEM_ACTIONS, persistPanelAndCardState);
  yield* takeEvery(CARD_PINNED_ACTIONS, persistCardPinned);
  yield* takeEvery(setChiefActiveAgentId, persistChiefActiveAgentId);
  yield* takeEvery(workspaceMounted, hydrateWorkspaceSidebarUiState);
  yield* takeEvery(setMultiSelectSidebarSelectedTabs, persistWorkspaceSelectedTabs);
  yield* takeEvery(setWorkspaceNoteOrder, persistWorkspaceNoteOrder);
  yield* takeEvery(toggleWorkspaceCollapsedNote, persistWorkspaceCollapsedNotes);
}

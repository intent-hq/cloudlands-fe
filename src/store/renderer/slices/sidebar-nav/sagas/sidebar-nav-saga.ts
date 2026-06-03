/**
 * Sidebar Nav Saga
 *
 * Manages:
 * - localStorage hydration on startup
 * - localStorage persistence on state changes
 * - Active streams / unread tracking subscriptions
 */

import {
  buffers,
  eventChannel,
} from "redux-saga";
import {
  call,
  fork,
  put,
  take,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageItem,
  setLocalStorageJSON,
  removeLocalStorageItem,
} from "$store/renderer/utils/safe-local-storage-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  hydrateSidebarNav,
  setAllSpacesViewMode,
  setCardPinned,
  toggleCardPinned,
  setPanelWidth,
  openPanel,
  closePanel,
  togglePanel,
  closeAll,
  closeHoverCards,
  pinWorkspace,
  unpinWorkspace,
  togglePinWorkspace,
  setPinnedWorkspaceIds,
  setMultiSelectSidebarSelectedTabs,
  setMultiSelectSidebarTabOrder,
  setWorkspaceNoteOrder,
  setWorkspaceCollapsedNoteIds,
  toggleWorkspaceCollapsedNote,
  hydrateWorkspaceSidebarUi,
  bumpActiveStreamsVersion,
  setOnboardingActive,
  PINNED_WORKSPACES_KEY,
  VIEW_MODE_KEY,
  PANEL_WIDTH_KEY,
  PANEL_ITEM_KEY,
  CARD_PINNED_KEY,
  MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
  WORKSPACE_NOTE_ORDER_PREFIX,
  WORKSPACE_COLLAPSED_NOTES_PREFIX,
} from "../sidebar-nav-slice";
import {
  selectIsCardPinned,
  selectPanelItem,
  selectPanelWidth,
  selectAllSpacesViewMode,
  selectPinnedWorkspaceIds,
  selectMultiSelectSidebarSelectedTabIds,
  selectMultiSelectSidebarTabOrder,
  selectWorkspaceNoteOrder,
  selectWorkspaceCollapsedNoteIds,
} from "../sidebar-nav-selectors";
import type { AllSpacesViewMode, SidebarNavItem } from "../sidebar-nav-types";
import { activeStreamsTracker } from "$features/agent/services/active-streams-tracker";

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

// ── Init Saga ──

function* initSidebarNav(): SagaGenerator<void> {
  const cardPinnedStr = yield* call(getLocalStorageItem, CARD_PINNED_KEY);
  const panelItemStr = yield* call(getLocalStorageItem, PANEL_ITEM_KEY);
  const panelWidthStr = yield* call(getLocalStorageItem, PANEL_WIDTH_KEY);
  const viewModeStr = yield* call(getLocalStorageItem, VIEW_MODE_KEY);
  const pinnedStr = yield* call(getLocalStorageItem, PINNED_WORKSPACES_KEY);
  const tabOrder = stringArray(
    yield* call(getLocalStorageJSON<unknown>, MULTISELECT_SIDEBAR_TAB_ORDER_KEY),
  );

  const data: Parameters<typeof hydrateSidebarNav>[0] = {};

  if (cardPinnedStr === "true") data.isCardPinned = true;
  if (panelItemStr) data.panelItem = panelItemStr as SidebarNavItem;
  if (panelWidthStr) {
    const w = Number(panelWidthStr);
    if (w > 0) data.panelWidth = w;
  }
  if (viewModeStr === "recent" || viewModeStr === "repo" || viewModeStr === "status") {
    data.allSpacesViewMode = viewModeStr as AllSpacesViewMode;
  }
  if (pinnedStr) {
    try {
      const parsed = JSON.parse(pinnedStr);
      if (Array.isArray(parsed)) data.pinnedWorkspaceIds = parsed;
    } catch {
      // ignore
    }
  }
  if (tabOrder) data.multiSelectTabOrder = tabOrder;

  if (Object.keys(data).length > 0) {
    yield* put(hydrateSidebarNav(data));
  }
}

function getWorkspaceSelectedTabsKey(workspaceId: string): string {
  return `${MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX}${workspaceId}`;
}

function getWorkspaceNoteOrderKey(workspaceId: string): string {
  return `${WORKSPACE_NOTE_ORDER_PREFIX}${workspaceId}`;
}

function getWorkspaceCollapsedNotesKey(workspaceId: string): string {
  return `${WORKSPACE_COLLAPSED_NOTES_PREFIX}${workspaceId}`;
}

export function* hydrateWorkspaceSidebarUiSaga(
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  let selectedTabIds: string[] | undefined;
  let noteOrder: string[] | undefined;
  let collapsedNoteIds: string[] | undefined;

  try {
    selectedTabIds = stringArray(
      yield* call(getLocalStorageJSON<unknown>, getWorkspaceSelectedTabsKey(workspaceId)),
    );
  } catch {
    // Safe storage helpers catch internally; keep hydration resilient if a helper throws unexpectedly.
  }
  try {
    noteOrder = stringArray(
      yield* call(getLocalStorageJSON<unknown>, getWorkspaceNoteOrderKey(workspaceId)),
    );
  } catch {
    // Ignore storage errors and hydrate the default note order.
  }
  try {
    collapsedNoteIds = stringArray(
      yield* call(getLocalStorageJSON<unknown>, getWorkspaceCollapsedNotesKey(workspaceId)),
    );
  } catch {
    // Ignore storage errors and hydrate with no collapsed notes.
  }

  yield* put(
    hydrateWorkspaceSidebarUi(workspaceId, {
      selectedTabIds,
      noteOrder,
      collapsedNoteIds,
    }),
  );
}

/** @internal Exported for testing only. */
export function* hydrateActiveWorkspaceSidebarUiSaga(): SagaGenerator<void> {
  const activeWorkspaceId = yield* selectActiveWorkspaceId.effect();

  if (
    !activeWorkspaceId ||
    activeWorkspaceId === "new" ||
    activeWorkspaceId.startsWith("optimistic-") ||
    activeWorkspaceId === "undefined"
  ) {
    return;
  }

  yield* call(hydrateWorkspaceSidebarUiSaga, workspaceMounted(activeWorkspaceId));
}

// ── Persistence Sagas ──

function* persistCardPinned(): SagaGenerator<void> {
  yield* takeEvery(
    [
      setCardPinned,
      toggleCardPinned,
      closeHoverCards,
      closePanel,
      togglePanel,
      closeAll,
      openPanel,
    ],
    function* () {
      const pinned = yield* selectIsCardPinned.effect();
      yield* call(setLocalStorageItem, CARD_PINNED_KEY, String(pinned));
    },
  );
}

function* persistPanelItem(): SagaGenerator<void> {
  yield* takeEvery(
    [openPanel, closePanel, togglePanel, closeAll],
    function* () {
      const item = yield* selectPanelItem.effect();
      if (item) {
        yield* call(setLocalStorageItem, PANEL_ITEM_KEY, item);
      } else {
        yield* call(removeLocalStorageItem, PANEL_ITEM_KEY);
      }
    },
  );
}

function* persistPanelWidth(): SagaGenerator<void> {
  yield* takeEvery(setPanelWidth, function* () {
    const width = yield* selectPanelWidth.effect();
    yield* call(setLocalStorageItem, PANEL_WIDTH_KEY, String(width));
  });
}

function* persistViewMode(): SagaGenerator<void> {
  yield* takeEvery(setAllSpacesViewMode, function* () {
    const mode = yield* selectAllSpacesViewMode.effect();
    yield* call(setLocalStorageItem, VIEW_MODE_KEY, mode);
  });
}

function* persistPinnedWorkspaces(): SagaGenerator<void> {
  yield* takeEvery(
    [pinWorkspace, unpinWorkspace, togglePinWorkspace, setPinnedWorkspaceIds],
    function* () {
      const ids = yield* selectPinnedWorkspaceIds.effect();
      yield* call(setLocalStorageItem, PINNED_WORKSPACES_KEY, JSON.stringify(ids));
    },
  );
}

export function* persistMultiSelectSidebarTabOrderSaga(): SagaGenerator<void> {
  const tabOrder = yield* selectMultiSelectSidebarTabOrder.effect();
  try {
    yield* call(setLocalStorageJSON, MULTISELECT_SIDEBAR_TAB_ORDER_KEY, tabOrder);
  } catch {
    // Safe storage helpers catch internally; this preserves saga safety if they throw unexpectedly.
  }
}

function* persistMultiSelectSidebarTabOrder(): SagaGenerator<void> {
  yield* takeEvery(setMultiSelectSidebarTabOrder, persistMultiSelectSidebarTabOrderSaga);
}

export function* persistWorkspaceSelectedTabsSaga(
  action: ReturnType<typeof setMultiSelectSidebarSelectedTabs>
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const selectedTabIds = yield* selectMultiSelectSidebarSelectedTabIds.effect(workspaceId);
  try {
    yield* call(setLocalStorageJSON, getWorkspaceSelectedTabsKey(workspaceId), selectedTabIds);
  } catch {
    // Ignore storage errors; Redux state remains the source of truth for the current session.
  }
}

function* persistWorkspaceSelectedTabs(): SagaGenerator<void> {
  yield* takeEvery(setMultiSelectSidebarSelectedTabs, persistWorkspaceSelectedTabsSaga);
}

export function* persistWorkspaceNoteOrderSaga(
  action: ReturnType<typeof setWorkspaceNoteOrder>
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const noteOrder = yield* selectWorkspaceNoteOrder.effect(workspaceId);
  try {
    yield* call(setLocalStorageJSON, getWorkspaceNoteOrderKey(workspaceId), noteOrder);
  } catch {
    // Ignore storage errors; note order still updates in Redux state.
  }
}

function* persistWorkspaceNoteOrder(): SagaGenerator<void> {
  yield* takeEvery(setWorkspaceNoteOrder, persistWorkspaceNoteOrderSaga);
}

export function* persistWorkspaceCollapsedNotesSaga(
  action: ReturnType<typeof setWorkspaceCollapsedNoteIds> | ReturnType<typeof toggleWorkspaceCollapsedNote>
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const collapsedNoteIds = yield* selectWorkspaceCollapsedNoteIds.effect(workspaceId);
  try {
    yield* call(setLocalStorageJSON, getWorkspaceCollapsedNotesKey(workspaceId), collapsedNoteIds);
  } catch {
    // Ignore storage errors; collapsed state still updates in Redux state.
  }
}

function* persistWorkspaceCollapsedNotes(): SagaGenerator<void> {
  yield* takeEvery(
    [setWorkspaceCollapsedNoteIds, toggleWorkspaceCollapsedNote],
    persistWorkspaceCollapsedNotesSaga,
  );
}

// ── Subscriptions Saga ──
// Sets up polling / subscriptions for active streams & unread tracking,
// dispatching version bumps so selectors re-evaluate.

let subscriptionsInitialized = false;

function createActiveStreamsTrackerChannel() {
  return eventChannel<"changed">((emitter) => {
    activeStreamsTracker.startPolling();
    const unsubscribe = activeStreamsTracker.subscribe(() => emitter("changed"));
    return unsubscribe;
  }, buffers.expanding<"changed">());
}

/** @internal Exported for testing only. */
export function* watchActiveStreamsTrackerSaga(): SagaGenerator<void> {
  const channel = createActiveStreamsTrackerChannel();
  try {
    while (true) {
      yield* take(channel);
      yield* put(bumpActiveStreamsVersion());
    }
  } finally {
    channel.close();
  }
}

function* initSubscriptions(): SagaGenerator<void> {
  if (subscriptionsInitialized) return;
  subscriptionsInitialized = true;

  // Bridge non-Redux tracker callbacks into saga-owned channel events.
  yield* fork(watchActiveStreamsTrackerSaga);
}

// ── Onboarding Saga ──
// When onboarding becomes active, close all panels

function* watchOnboarding(): SagaGenerator<void> {
  yield* takeEvery(setOnboardingActive, function* (action) {
    const active = action.payload[0];
    if (active) {
      yield* put(closeAll(true));
    }
  });
}

// ── Root Saga ──

export function* sidebarNavSaga(): SagaGenerator<void> {
  yield* call(initSidebarNav);
  yield* call(initSubscriptions);
  yield* fork(persistCardPinned);
  yield* fork(persistPanelItem);
  yield* fork(persistPanelWidth);
  yield* fork(persistViewMode);
  yield* fork(persistPinnedWorkspaces);
  yield* fork(persistMultiSelectSidebarTabOrder);
  yield* fork(persistWorkspaceSelectedTabs);
  yield* fork(persistWorkspaceNoteOrder);
  yield* fork(persistWorkspaceCollapsedNotes);
  yield* takeEvery(workspaceMounted, hydrateWorkspaceSidebarUiSaga);
  yield* call(hydrateActiveWorkspaceSidebarUiSaga);
  yield* fork(watchOnboarding);
}


/**
 * Sidebar Nav Saga
 *
 * Manages:
 * - localStorage hydration on startup
 * - localStorage persistence on state changes
 * - Active streams / unread tracking subscriptions
 */

import { call, fork, put, takeEvery, type SagaGenerator } from "typed-redux-saga";
import {
  getLocalStorageItem,
  setLocalStorageItem,
  removeLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
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
  bumpActiveStreamsVersion,
  setOnboardingActive,
  PINNED_WORKSPACES_KEY,
  VIEW_MODE_KEY,
  PANEL_WIDTH_KEY,
  PANEL_ITEM_KEY,
  CARD_PINNED_KEY,
} from "../sidebar-nav-slice";
import {
  selectIsCardPinned,
  selectPanelItem,
  selectPanelWidth,
  selectAllSpacesViewMode,
  selectPinnedWorkspaceIds,
} from "../sidebar-nav-selectors";
import type { AllSpacesViewMode, SidebarNavItem } from "../sidebar-nav-types";
import { activeStreamsTracker } from "$features/agent/services/active-streams-tracker";


// ── Init Saga ──

function* initSidebarNav(): SagaGenerator<void> {
  const cardPinnedStr = yield* call(getLocalStorageItem, CARD_PINNED_KEY);
  const panelItemStr = yield* call(getLocalStorageItem, PANEL_ITEM_KEY);
  const panelWidthStr = yield* call(getLocalStorageItem, PANEL_WIDTH_KEY);
  const viewModeStr = yield* call(getLocalStorageItem, VIEW_MODE_KEY);
  const pinnedStr = yield* call(getLocalStorageItem, PINNED_WORKSPACES_KEY);

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

  if (Object.keys(data).length > 0) {
    yield* put(hydrateSidebarNav(data));
  }
}

// ── Persistence Sagas ──

function* persistCardPinned(): SagaGenerator<void> {
  yield* takeEvery(
    [setCardPinned.type, toggleCardPinned.type, closeHoverCards.type, closePanel.type, togglePanel.type, closeAll.type, openPanel.type],
    function* () {
      const pinned = yield* selectIsCardPinned.effect();
      yield* call(setLocalStorageItem, CARD_PINNED_KEY, String(pinned));
    },
  );
}

function* persistPanelItem(): SagaGenerator<void> {
  yield* takeEvery(
    [openPanel.type, closePanel.type, togglePanel.type, closeAll.type],
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
    [pinWorkspace.type, unpinWorkspace.type, togglePinWorkspace.type, setPinnedWorkspaceIds.type],
    function* () {
      const ids = yield* selectPinnedWorkspaceIds.effect();
      yield* call(setLocalStorageItem, PINNED_WORKSPACES_KEY, JSON.stringify(ids));
    },
  );
}

// ── Subscriptions Saga ──
// Sets up polling / subscriptions for active streams & unread tracking,
// dispatching version bumps so selectors re-evaluate.

let subscriptionsInitialized = false;

function* initSubscriptions(): SagaGenerator<void> {
  if (subscriptionsInitialized) return;
  subscriptionsInitialized = true;

  // These are non-Redux services that use callbacks.
  // We bridge them into Redux by dispatching version bump actions.
  yield* call(() => {
    activeStreamsTracker.startPolling();
  });

  // We need to use the store's dispatch to bridge callbacks into Redux.
  // Get dispatch from the store context.
  const { getReduxStore } = yield* call(async () => {
    const mod = await import("$lib/store/redux-dispatch-bridge");
    return mod;
  });

  yield* call(() => {
    const store = getReduxStore();
    activeStreamsTracker.subscribe(() => {
      store.dispatch(bumpActiveStreamsVersion());
    });
    // NOTE: unreadTrackingService subscription removed — unread state is now in Redux
    // and components use selectUnreadAgentIdsForWorkspace directly.
  });
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
  yield* fork(watchOnboarding);
}


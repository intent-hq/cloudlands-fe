/**
 * Sidebar-nav persistence service — restores the localStorage hydrate/persist
 * that the removed sidebar-nav sagas performed. With no saga listening,
 * pinned workspaces and other sidebar UI state never loaded on boot or persisted
 * on change.
 *
 * Like `tab-state-persistence-service` and `unread-tracking-persistence-service`,
 * this reconnects the path WITHOUT re-adding a saga and WITHOUT changing any call site:
 *   - On creation it hydrates sidebar-nav state from localStorage once.
 *   - After any mutating action it writes the affected state back.
 *
 * Dependency-light per src/store AGENTS.md: imports only the safe-storage helper
 * and slice actions — no selectors and no store module (state is read through the
 * middleware `api.getState()`).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import type { StoreState } from "../types";
import type { AllSpacesViewMode, SidebarNavItem } from "../slices/sidebar-nav/sidebar-nav-types";
import {
  hydrateSidebarNav,
  setPinnedWorkspaceIds,
  pinWorkspace,
  unpinWorkspace,
  togglePinWorkspace,
  setAllSpacesViewMode,
  setPanelWidth,
  openPanel,
  closePanel,
  togglePanel,
  closeAll,
  closeHoverCards,
  setCardPinned,
  toggleCardPinned,
  setChiefActiveAgentId,
  setMultiSelectSidebarTabOrder,
  PINNED_WORKSPACES_KEY,
  VIEW_MODE_KEY,
  PANEL_WIDTH_KEY,
  PANEL_ITEM_KEY,
  CARD_PINNED_KEY,
  CHIEF_ACTIVE_AGENT_ID_KEY,
  MULTISELECT_SIDEBAR_TAB_ORDER_KEY,
} from "../slices/sidebar-nav/sidebar-nav-slice";

/** Actions whose reducer changes pinnedWorkspaceIds and needs a write-back. */
const PINNED_WORKSPACES_ACTION_TYPES = new Set<string>([
  setPinnedWorkspaceIds.type,
  pinWorkspace.type,
  unpinWorkspace.type,
  togglePinWorkspace.type,
]);

/** Actions whose reducer changes allSpacesViewMode and needs a write-back. */
const VIEW_MODE_ACTION_TYPES = new Set<string>([
  setAllSpacesViewMode.type,
]);

/** Actions whose reducer changes panelWidth and needs a write-back. */
const PANEL_WIDTH_ACTION_TYPES = new Set<string>([
  setPanelWidth.type,
]);

/** Actions whose reducer changes panelItem and needs a write-back. */
const PANEL_ITEM_ACTION_TYPES = new Set<string>([
  openPanel.type,
  closePanel.type,
  togglePanel.type,
  closeAll.type,
]);

/** Actions whose reducer changes isCardPinned and needs a write-back. */
const CARD_PINNED_ACTION_TYPES = new Set<string>([
  setCardPinned.type,
  toggleCardPinned.type,
  openPanel.type,
  closePanel.type,
  togglePanel.type,
  closeAll.type,
  closeHoverCards.type,
]);

/** Actions whose reducer changes chiefActiveAgentId and needs a write-back. */
const CHIEF_ACTIVE_AGENT_ID_ACTION_TYPES = new Set<string>([
  setChiefActiveAgentId.type,
]);

/** Actions whose reducer changes multiSelectTabOrder and needs a write-back. */
const MULTISELECT_TAB_ORDER_ACTION_TYPES = new Set<string>([
  setMultiSelectSidebarTabOrder.type,
]);

function loadStoredPinnedWorkspaceIds(): string[] | undefined {
  const stored = safeLocalStorage.getJSON<unknown>(PINNED_WORKSPACES_KEY);
  if (!Array.isArray(stored)) return undefined;
  return stored.filter((id): id is string => typeof id === "string");
}

function loadStoredViewMode(): AllSpacesViewMode | undefined {
  // Read raw and parse locally: legacy builds wrote the view mode as a raw
  // string (e.g. `repo`), which safeLocalStorage.getJSON would warn on and drop.
  const raw = safeLocalStorage.getItem(VIEW_MODE_KEY);
  if (raw === null) return undefined;

  let stored: unknown;
  let isLegacyRawString = false;
  try {
    stored = JSON.parse(raw);
  } catch {
    stored = raw;
    isLegacyRawString = true;
  }

  if (stored !== "recent" && stored !== "repo" && stored !== "status") return undefined;
  if (isLegacyRawString) {
    safeLocalStorage.setJSON(VIEW_MODE_KEY, stored);
  }
  return stored;
}

function loadStoredPanelWidth(): number | undefined {
  const stored = safeLocalStorage.getJSON<unknown>(PANEL_WIDTH_KEY);
  if (typeof stored !== "number" || !Number.isFinite(stored)) return undefined;
  return stored;
}

function loadStoredPanelItem(): SidebarNavItem | null | undefined {
  const stored = safeLocalStorage.getJSON<unknown>(PANEL_ITEM_KEY);
  if (stored === null) return null;
  const validItems: readonly string[] = [
    'home',
    'new-workspace',
    'active',
    'chief',
    'all-workspaces',
    'settings',
  ];
  if (typeof stored === "string" && validItems.includes(stored)) {
    return stored as SidebarNavItem;
  }
  return undefined;
}

function loadStoredCardPinned(): boolean | undefined {
  const stored = safeLocalStorage.getJSON<unknown>(CARD_PINNED_KEY);
  if (typeof stored !== "boolean") return undefined;
  return stored;
}

function loadStoredChiefActiveAgentId(): string | null | undefined {
  const stored = safeLocalStorage.getJSON<unknown>(CHIEF_ACTIVE_AGENT_ID_KEY);
  if (stored !== null && typeof stored !== "string") return undefined;
  return stored;
}

function loadStoredMultiSelectTabOrder(): string[] | undefined {
  const stored = safeLocalStorage.getJSON<unknown>(MULTISELECT_SIDEBAR_TAB_ORDER_KEY);
  if (!Array.isArray(stored)) return undefined;
  return stored.filter((id): id is string => typeof id === "string");
}

function persistPinnedWorkspaceIds(state: StoreState): void {
  safeLocalStorage.setJSON(PINNED_WORKSPACES_KEY, state.sidebarNav.pinnedWorkspaceIds);
}

function persistViewMode(state: StoreState): void {
  safeLocalStorage.setJSON(VIEW_MODE_KEY, state.sidebarNav.allSpacesViewMode);
}

function persistPanelWidth(state: StoreState): void {
  safeLocalStorage.setJSON(PANEL_WIDTH_KEY, state.sidebarNav.panelWidth);
}

function persistPanelItem(state: StoreState): void {
  safeLocalStorage.setJSON(PANEL_ITEM_KEY, state.sidebarNav.panelItem);
}

function persistCardPinned(state: StoreState): void {
  safeLocalStorage.setJSON(CARD_PINNED_KEY, state.sidebarNav.isCardPinned);
}

function persistChiefActiveAgentId(state: StoreState): void {
  safeLocalStorage.setJSON(CHIEF_ACTIVE_AGENT_ID_KEY, state.sidebarNav.chiefActiveAgentId);
}

function persistMultiSelectTabOrder(state: StoreState): void {
  safeLocalStorage.setJSON(MULTISELECT_SIDEBAR_TAB_ORDER_KEY, state.sidebarNav.multiSelectTabOrder);
}

/**
 * Middleware giving the sidebar-nav persistence triggers real handlers again.
 * Hydration runs once at factory time (state is already initialized through
 * the INIT reducer pass before the middleware chain is composed); persistence
 * runs after each mutating action passes the reducer.
 */
export function createSidebarNavPersistenceMiddleware(): StoreMiddleware {
  return (api) => {
    const hydrateData: Parameters<typeof hydrateSidebarNav>[0] = {};

    const pinnedWorkspaceIds = loadStoredPinnedWorkspaceIds();
    if (pinnedWorkspaceIds !== undefined) {
      hydrateData.pinnedWorkspaceIds = pinnedWorkspaceIds;
    }

    const viewMode = loadStoredViewMode();
    if (viewMode !== undefined) {
      hydrateData.allSpacesViewMode = viewMode;
    }

    const panelWidth = loadStoredPanelWidth();
    if (panelWidth !== undefined) {
      hydrateData.panelWidth = panelWidth;
    }

    const panelItem = loadStoredPanelItem();
    if (panelItem !== undefined) {
      hydrateData.panelItem = panelItem;
    }

    const cardPinned = loadStoredCardPinned();
    if (cardPinned !== undefined) {
      hydrateData.isCardPinned = cardPinned;
    }

    const chiefActiveAgentId = loadStoredChiefActiveAgentId();
    if (chiefActiveAgentId !== undefined) {
      hydrateData.chiefActiveAgentId = chiefActiveAgentId;
    }

    const multiSelectTabOrder = loadStoredMultiSelectTabOrder();
    if (multiSelectTabOrder !== undefined) {
      hydrateData.multiSelectTabOrder = multiSelectTabOrder;
    }

    if (Object.keys(hydrateData).length > 0) {
      api.dispatch(hydrateSidebarNav(hydrateData));
    }

    return (next) => (action) => {
      const result = next(action);
      if (action) {
        const state = api.getState() as StoreState;
        if (PINNED_WORKSPACES_ACTION_TYPES.has(action.type)) {
          persistPinnedWorkspaceIds(state);
        }
        if (VIEW_MODE_ACTION_TYPES.has(action.type)) {
          persistViewMode(state);
        }
        if (PANEL_WIDTH_ACTION_TYPES.has(action.type)) {
          persistPanelWidth(state);
        }
        if (PANEL_ITEM_ACTION_TYPES.has(action.type)) {
          persistPanelItem(state);
        }
        if (CARD_PINNED_ACTION_TYPES.has(action.type)) {
          persistCardPinned(state);
        }
        if (CHIEF_ACTIVE_AGENT_ID_ACTION_TYPES.has(action.type)) {
          persistChiefActiveAgentId(state);
        }
        if (MULTISELECT_TAB_ORDER_ACTION_TYPES.has(action.type)) {
          persistMultiSelectTabOrder(state);
        }
      }
      return result;
    };
  };
}


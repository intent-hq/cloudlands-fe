/**
 * Sidebar Nav Slice
 *
 * Actions and reducer for the sidebar navigation state.
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createBooleanPreference } from "../../utils/boolean-preference";
import type { SidebarNavState, SidebarNavItem, AllSpacesViewMode } from "./sidebar-nav-types";

// ── localStorage keys ──
export const PINNED_WORKSPACES_KEY = "intent:pinned-workspaces";
export const VIEW_MODE_KEY = "intent:all-spaces-view-mode";
export const PANEL_WIDTH_KEY = "intent:sidebar-panel-width";
export const PANEL_ITEM_KEY = "intent:sidebar-panel-item";
export const CARD_PINNED_KEY = "intent:sidebar-card-pinned";

// ── Initial State ──
export const initialState: SidebarNavState = {
  activeStreamsVersion: 0,
  unreadVersion: 0,
  hoveredItem: null,
  expandedItem: null,
  isCardPinned: false,
  panelItem: null,
  panelWidth: 288,
  onboardingActive: false,
  draftPrompt: "",
  allSpacesViewMode: "recent",
  pinnedWorkspaceIds: [],
  contextMenuOpenCount: 0,
  deferredLeave: null,
};

// ── Actions ──

// Version bumps for reactive tracking
export const bumpActiveStreamsVersion = createAction("sidebarNav/bumpActiveStreamsVersion");
// Hover card state
export const setHoveredItem = createAction<[item: SidebarNavItem | null]>("sidebarNav/setHoveredItem");
export const setExpandedItem = createAction<[item: SidebarNavItem | null]>("sidebarNav/setExpandedItem");

// Card pinned
const cardPinnedPreference = createBooleanPreference<SidebarNavState>({
  sliceName: "sidebarNav",
  field: "isCardPinned",
  setActionName: "setCardPinned",
  toggleActionName: "toggleCardPinned",
});
export const setCardPinned = cardPinnedPreference.setAction;
export const toggleCardPinned = cardPinnedPreference.toggleAction;

// Panel
export const setPanelWidth = createAction<[width: number]>("sidebarNav/setPanelWidth");

// Onboarding
export const setOnboardingActive = createAction<[active: boolean]>("sidebarNav/setOnboardingActive");

// View mode
export const setAllSpacesViewMode = createAction<[mode: AllSpacesViewMode]>("sidebarNav/setAllSpacesViewMode");

// Pinned workspaces
export const setPinnedWorkspaceIds = createAction<[ids: string[]]>("sidebarNav/setPinnedWorkspaceIds");
export const pinWorkspace = createAction<[id: string]>("sidebarNav/pinWorkspace");
export const unpinWorkspace = createAction<[id: string]>("sidebarNav/unpinWorkspace");
export const togglePinWorkspace = createAction<[id: string]>("sidebarNav/togglePinWorkspace");

// Context menu tracking (prevents hover card auto-close)
export const incrementContextMenuOpen = createAction("sidebarNav/incrementContextMenuOpen");
export const decrementContextMenuOpen = createAction("sidebarNav/decrementContextMenuOpen");
export const setDeferredLeave = createAction<[leaveType: 'card' | 'nav']>("sidebarNav/setDeferredLeave");
export const clearDeferredLeave = createAction("sidebarNav/clearDeferredLeave");

// Composite actions (handled by reducer for pure state, sagas for side effects)
export const closeHoverCards = createAction("sidebarNav/closeHoverCards");
export const openPanel = createAction<[item: SidebarNavItem]>("sidebarNav/openPanel");
export const closePanel = createAction("sidebarNav/closePanel");
export const togglePanel = createAction<[item: SidebarNavItem]>("sidebarNav/togglePanel");
export const closeAll = createAction<[force: boolean]>("sidebarNav/closeAll");

// Hydration from localStorage
export const hydrateSidebarNav = createAction(
  "sidebarNav/hydrate",
  (data: Partial<Pick<SidebarNavState, "isCardPinned" | "panelItem" | "panelWidth" | "allSpacesViewMode" | "pinnedWorkspaceIds">>) => data,
);

// ── Reducer ──
export const sidebarNavReducer = cardPinnedPreference.register(
  createReducer<SidebarNavState>(initialState)
)
  .with(bumpActiveStreamsVersion, (state) => ({
    ...state,
    activeStreamsVersion: state.activeStreamsVersion + 1,
  }))
  .with(setHoveredItem, (state, { payload: [item] }) => ({
    ...state,
    hoveredItem: item,
  }))
  .with(setExpandedItem, (state, { payload: [item] }) => ({
    ...state,
    expandedItem: item,
  }))
  .with(setPanelWidth, (state, { payload: [width] }) => ({
    ...state,
    panelWidth: width,
  }))
  .with(setOnboardingActive, (state, { payload: [active] }) => ({
    ...state,
    onboardingActive: active,
  }))
  .with(setAllSpacesViewMode, (state, { payload: [mode] }) => ({
    ...state,
    allSpacesViewMode: mode,
  }))
  .with(setPinnedWorkspaceIds, (state, { payload: [ids] }) => ({
    ...state,
    pinnedWorkspaceIds: ids,
  }))
  .with(pinWorkspace, (state, { payload: [id] }) => {
    if (state.pinnedWorkspaceIds.includes(id)) return state;
    return {
      ...state,
      pinnedWorkspaceIds: [...state.pinnedWorkspaceIds, id],
    };
  })
  .with(unpinWorkspace, (state, { payload: [id] }) => {
    if (!state.pinnedWorkspaceIds.includes(id)) return state;
    return {
      ...state,
      pinnedWorkspaceIds: state.pinnedWorkspaceIds.filter((wid) => wid !== id),
    };
  })
  .with(togglePinWorkspace, (state, { payload: [id] }) => {
    if (state.pinnedWorkspaceIds.includes(id)) {
      return {
        ...state,
        pinnedWorkspaceIds: state.pinnedWorkspaceIds.filter((wid) => wid !== id),
      };
    }
    return {
      ...state,
      pinnedWorkspaceIds: [...state.pinnedWorkspaceIds, id],
    };
  })
  .with(closeHoverCards, (state) => ({
    ...state,
    hoveredItem: null,
    expandedItem: null,
    // Reset pin if no panel is open
    isCardPinned: state.panelItem ? state.isCardPinned : false,
  }))
  .with(openPanel, (state, { payload: [item] }) => ({
    ...state,
    hoveredItem: null,
    expandedItem: null,
    isCardPinned: state.panelItem ? state.isCardPinned : false,
    panelItem: item,
  }))
  .with(closePanel, (state) => ({
    ...state,
    isCardPinned: false,
    panelItem: null,
  }))
  .with(togglePanel, (state, { payload: [item] }) => {
    if (state.onboardingActive) return state;
    if (state.panelItem === item) {
      // If pinned, unpin instead of closing
      if (state.isCardPinned) {
        return { ...state, isCardPinned: false };
      }
      return { ...state, isCardPinned: false, panelItem: null };
    }
    // Open new panel (close hover cards first)
    return {
      ...state,
      hoveredItem: null,
      expandedItem: null,
      isCardPinned: state.panelItem ? state.isCardPinned : false,
      panelItem: item,
    };
  })
  .with(closeAll, (state, { payload: [force] }) => {
    const shouldClosePanel = !state.isCardPinned || force;
    return {
      ...state,
      hoveredItem: null,
      expandedItem: null,
      isCardPinned: shouldClosePanel ? false : state.isCardPinned,
      panelItem: shouldClosePanel ? null : state.panelItem,
    };
  })
  .with(incrementContextMenuOpen, (state) => ({
    ...state,
    contextMenuOpenCount: state.contextMenuOpenCount + 1,
  }))
  .with(decrementContextMenuOpen, (state) => ({
    ...state,
    contextMenuOpenCount: Math.max(0, state.contextMenuOpenCount - 1),
  }))
  .with(setDeferredLeave, (state, { payload: [leaveType] }) => ({
    ...state,
    deferredLeave: leaveType,
  }))
  .with(clearDeferredLeave, (state) => ({
    ...state,
    deferredLeave: null,
  }))
  .with(hydrateSidebarNav, (state, { payload }) => ({
    ...state,
    ...payload,
  }));


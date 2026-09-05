/**
 * Sidebar Nav Slice
 *
 * Actions and reducer for the sidebar navigation state.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createBooleanPreference } from '@augmentcode/themis/utils/store/boolean-preference';
import type { SidebarNavState, SidebarNavItem, AllSpacesViewMode } from './sidebar-nav-types';
import { isCombinedWorkspacePanelItem } from './sidebar-nav-types';

// ── localStorage keys ──
export const PINNED_WORKSPACES_KEY = 'intent:pinned-workspaces';
export const VIEW_MODE_KEY = 'intent:all-spaces-view-mode';
export const SHOW_ARCHIVED_KEY = 'intent:all-spaces-show-archived';
export const COLLAPSED_STATUS_GROUPS_KEY = 'intent:all-spaces-collapsed-status-groups';
export const CHIEF_COLLAPSED_KEY = 'intent:sidebar-chief-collapsed';
export const PANEL_WIDTH_KEY = 'intent:sidebar-panel-width';
export const COMBINED_PANEL_SPLIT_KEY = 'intent:sidebar-combined-panel-split';
export const LEGACY_HOME_PANEL_SPLIT_KEY = 'intent:sidebar-home-panel-split';
export const PANEL_ITEM_KEY = 'intent:sidebar-panel-item';
export const CARD_PINNED_KEY = 'intent:sidebar-card-pinned';
export const CHIEF_ACTIVE_AGENT_ID_KEY = 'intent:chief-active-agent-id';
export const MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX = 'multiselect-sidebar-';
export const MULTISELECT_SIDEBAR_TAB_ORDER_KEY = 'multiselect-sidebar-tab-order';
export const WORKSPACE_NOTE_ORDER_PREFIX = 'workspace-note-order-';
export const WORKSPACE_COLLAPSED_NOTES_PREFIX = 'workspace-collapsed-notes-';

// ── Initial State ──
export const initialState: SidebarNavState = {
  activeStreamsVersion: 0,
  unreadVersion: 0,
  hoveredItem: null,
  expandedItem: null,
  isCardPinned: false,
  panelItem: null,
  panelWidth: 288,
  combinedPanelSplit: 0.45,
  workspaceCreationActive: false,
  draftPrompt: '',
  allSpacesViewMode: 'recent',
  showArchivedWorkspaces: false,
  collapsedStatusGroupIds: [],
  isChiefCollapsed: false,
  pinnedWorkspaceIds: [],
  multiSelectTabOrder: [],
  multiSelectSelectedTabIdsByWorkspaceId: {},
  noteOrderByWorkspaceId: {},
  collapsedNoteIdsByWorkspaceId: {},
  chiefActiveAgentId: null,
  contextMenuOpenCount: 0,
  deferredLeave: null,
  statsOverlayOpen: false,
};

// ── Actions ──

// Version bumps for reactive tracking
export const bumpActiveStreamsVersion = createAction('sidebarNav/bumpActiveStreamsVersion');
// Hover card state
export const setHoveredItem = createAction<[item: SidebarNavItem | null]>(
  'sidebarNav/setHoveredItem',
);
export const setExpandedItem = createAction<[item: SidebarNavItem | null]>(
  'sidebarNav/setExpandedItem',
);

// Card pinned
const cardPinnedPreference = createBooleanPreference<SidebarNavState>({
  sliceName: 'sidebarNav',
  field: 'isCardPinned',
  setActionName: 'setCardPinned',
  toggleActionName: 'toggleCardPinned',
});
export const setCardPinned = cardPinnedPreference.setAction;
export const toggleCardPinned = cardPinnedPreference.toggleAction;

// Panel
export const setPanelWidth = createAction<[width: number]>('sidebarNav/setPanelWidth');
export const setCombinedPanelSplit = createAction<[split: number]>(
  'sidebarNav/setCombinedPanelSplit',
);

// Workspace creation
export const setWorkspaceCreationActive = createAction<[active: boolean]>(
  'sidebarNav/setWorkspaceCreationActive',
);

// View mode
export const setAllSpacesViewMode = createAction<[mode: AllSpacesViewMode]>(
  'sidebarNav/setAllSpacesViewMode',
);

const showArchivedWorkspacesPreference = createBooleanPreference<SidebarNavState>({
  sliceName: 'sidebarNav',
  field: 'showArchivedWorkspaces',
  setActionName: 'setShowArchivedWorkspaces',
  toggleActionName: 'toggleShowArchivedWorkspaces',
});
export const setShowArchivedWorkspaces = showArchivedWorkspacesPreference.setAction;
export const toggleShowArchivedWorkspaces = showArchivedWorkspacesPreference.toggleAction;
export const toggleStatusGroupCollapsed = createAction<[groupId: string]>(
  'sidebarNav/toggleStatusGroupCollapsed',
);
const chiefCollapsedPreference = createBooleanPreference<SidebarNavState>({
  sliceName: 'sidebarNav',
  field: 'isChiefCollapsed',
  setActionName: 'setChiefCollapsed',
  toggleActionName: 'toggleChiefCollapsed',
});
export const setChiefCollapsed = chiefCollapsedPreference.setAction;
export const toggleChiefCollapsed = chiefCollapsedPreference.toggleAction;
export const togglePinWorkspace = createAction<[id: string]>('sidebarNav/togglePinWorkspace');
export const setMultiSelectSidebarSelectedTabs = createAction<
  [workspaceId: string, tabIds: string[]]
>('sidebarNav/setMultiSelectSidebarSelectedTabs');
export const setWorkspaceNoteOrder = createAction<[workspaceId: string, noteIds: string[]]>(
  'sidebarNav/setWorkspaceNoteOrder',
);
export const setChiefActiveAgentId = createAction<[agentId: string | null]>(
  'sidebarNav/setChiefActiveAgentId',
);
export const toggleWorkspaceCollapsedNote = createAction<[workspaceId: string, noteId: string]>(
  'sidebarNav/toggleWorkspaceCollapsedNote',
);

// Context menu tracking (prevents hover card auto-close)
export const incrementContextMenuOpen = createAction('sidebarNav/incrementContextMenuOpen');
export const decrementContextMenuOpen = createAction('sidebarNav/decrementContextMenuOpen');
export const setDeferredLeave = createAction<[leaveType: 'card' | 'nav']>(
  'sidebarNav/setDeferredLeave',
);
export const clearDeferredLeave = createAction('sidebarNav/clearDeferredLeave');

// Usage-stats overlay
export const setStatsOverlayOpen = createAction<[open: boolean]>('sidebarNav/setStatsOverlayOpen');

// Composite actions (handled by reducer for pure state, sagas for side effects)
export const closeHoverCards = createAction('sidebarNav/closeHoverCards');
export const openPanel = createAction<[item: SidebarNavItem]>('sidebarNav/openPanel');
export const closePanel = createAction('sidebarNav/closePanel');
export const togglePanel = createAction<[item: SidebarNavItem]>('sidebarNav/togglePanel');
export const closeAll = createAction<[force: boolean]>('sidebarNav/closeAll');

// Hydration from localStorage
type SidebarNavHydrationState = Partial<
  Omit<
    Pick<
      SidebarNavState,
      | 'isCardPinned'
      | 'panelItem'
      | 'panelWidth'
      | 'combinedPanelSplit'
      | 'allSpacesViewMode'
      | 'showArchivedWorkspaces'
      | 'collapsedStatusGroupIds'
      | 'isChiefCollapsed'
      | 'pinnedWorkspaceIds'
      | 'multiSelectTabOrder'
      | 'chiefActiveAgentId'
    >,
    'panelItem'
  >
> & { panelItem?: SidebarNavItem | 'home' | null };

export const hydrateSidebarNav = createAction(
  'sidebarNav/hydrate',
  (data: SidebarNavHydrationState) => data,
);

export const hydrateWorkspaceSidebarUi = createAction<
  [
    workspaceId: string,
    data: { selectedTabIds?: string[]; noteOrder?: string[]; collapsedNoteIds?: string[] },
  ]
>('sidebarNav/hydrateWorkspaceSidebarUi');

function migrateLegacyPanelItem(item: SidebarNavItem | 'home' | null): SidebarNavItem | null {
  return item === 'home' ? 'all-workspaces' : item;
}

// ── Reducer ──
export const sidebarNavReducer = createReducer<SidebarNavState>(initialState);
cardPinnedPreference.register(sidebarNavReducer);
showArchivedWorkspacesPreference.register(sidebarNavReducer);
chiefCollapsedPreference.register(sidebarNavReducer);
sidebarNavReducer.with(bumpActiveStreamsVersion, (state) => ({
  ...state,
  activeStreamsVersion: state.activeStreamsVersion + 1,
}));
sidebarNavReducer.with(setHoveredItem, (state, { payload: [item] }) => ({
  ...state,
  hoveredItem: item,
}));
sidebarNavReducer.with(setExpandedItem, (state, { payload: [item] }) => ({
  ...state,
  expandedItem: item,
}));
sidebarNavReducer.with(setPanelWidth, (state, { payload: [width] }) => ({
  ...state,
  panelWidth: width,
}));
sidebarNavReducer.with(setCombinedPanelSplit, (state, { payload: [split] }) => {
  if (!Number.isFinite(split)) return state;
  const clamped = Math.min(0.85, Math.max(0.15, split));
  if (clamped === state.combinedPanelSplit) return state;
  return { ...state, combinedPanelSplit: clamped };
});
sidebarNavReducer.with(setWorkspaceCreationActive, (state, { payload: [active] }) => ({
  ...state,
  workspaceCreationActive: active,
}));
sidebarNavReducer.with(setAllSpacesViewMode, (state, { payload: [mode] }) => ({
  ...state,
  allSpacesViewMode: mode,
}));
sidebarNavReducer.with(toggleStatusGroupCollapsed, (state, { payload: [groupId] }) => ({
  ...state,
  collapsedStatusGroupIds: state.collapsedStatusGroupIds.includes(groupId)
    ? state.collapsedStatusGroupIds.filter((id) => id !== groupId)
    : [...state.collapsedStatusGroupIds, groupId],
}));
sidebarNavReducer.with(togglePinWorkspace, (state, { payload: [id] }) => {
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
});
sidebarNavReducer.with(
  setMultiSelectSidebarSelectedTabs,
  (state, { payload: [workspaceId, tabIds] }) => ({
    ...state,
    multiSelectSelectedTabIdsByWorkspaceId: {
      ...state.multiSelectSelectedTabIdsByWorkspaceId,
      [workspaceId]: tabIds,
    },
  }),
);
sidebarNavReducer.with(setWorkspaceNoteOrder, (state, { payload: [workspaceId, noteIds] }) => ({
  ...state,
  noteOrderByWorkspaceId: {
    ...state.noteOrderByWorkspaceId,
    [workspaceId]: noteIds,
  },
}));
sidebarNavReducer.with(setChiefActiveAgentId, (state, { payload: [agentId] }) => ({
  ...state,
  chiefActiveAgentId: agentId,
}));
sidebarNavReducer.with(
  toggleWorkspaceCollapsedNote,
  (state, { payload: [workspaceId, noteId] }) => {
    const current = state.collapsedNoteIdsByWorkspaceId[workspaceId] ?? [];
    const next = current.includes(noteId)
      ? current.filter((id) => id !== noteId)
      : [...current, noteId];
    return {
      ...state,
      collapsedNoteIdsByWorkspaceId: {
        ...state.collapsedNoteIdsByWorkspaceId,
        [workspaceId]: next,
      },
    };
  },
);
sidebarNavReducer.with(closeHoverCards, (state) => ({
  ...state,
  hoveredItem: null,
  expandedItem: null,
  // Reset pin if no panel is open
  isCardPinned: state.panelItem ? state.isCardPinned : false,
}));
sidebarNavReducer.with(openPanel, (state, { payload: [item] }) => ({
  ...state,
  hoveredItem: null,
  expandedItem: null,
  isCardPinned: state.panelItem ? state.isCardPinned : false,
  panelItem: item,
}));
sidebarNavReducer.with(closePanel, (state) => ({
  ...state,
  isCardPinned: false,
  panelItem: null,
}));
sidebarNavReducer.with(togglePanel, (state, { payload: [item] }) => {
  if (state.workspaceCreationActive) return state;
  const isSamePanel =
    state.panelItem === item ||
    (state.panelItem !== null &&
      isCombinedWorkspacePanelItem(state.panelItem) &&
      isCombinedWorkspacePanelItem(item));
  if (isSamePanel) {
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
});
sidebarNavReducer.with(closeAll, (state, { payload: [force] }) => {
  const shouldClosePanel = !state.isCardPinned || force;
  return {
    ...state,
    hoveredItem: null,
    expandedItem: null,
    isCardPinned: shouldClosePanel ? false : state.isCardPinned,
    panelItem: shouldClosePanel ? null : state.panelItem,
  };
});
sidebarNavReducer.with(incrementContextMenuOpen, (state) => ({
  ...state,
  contextMenuOpenCount: state.contextMenuOpenCount + 1,
}));
sidebarNavReducer.with(decrementContextMenuOpen, (state) => ({
  ...state,
  contextMenuOpenCount: Math.max(0, state.contextMenuOpenCount - 1),
}));
sidebarNavReducer.with(setDeferredLeave, (state, { payload: [leaveType] }) => ({
  ...state,
  deferredLeave: leaveType,
}));
sidebarNavReducer.with(clearDeferredLeave, (state) => ({
  ...state,
  deferredLeave: null,
}));
sidebarNavReducer.with(setStatsOverlayOpen, (state, { payload: [open] }) => ({
  ...state,
  statsOverlayOpen: open,
}));
sidebarNavReducer.with(hydrateWorkspaceSidebarUi, (state, { payload: [workspaceId, data] }) => ({
  ...state,
  multiSelectSelectedTabIdsByWorkspaceId:
    data.selectedTabIds === undefined
      ? state.multiSelectSelectedTabIdsByWorkspaceId
      : {
          ...state.multiSelectSelectedTabIdsByWorkspaceId,
          [workspaceId]: data.selectedTabIds,
        },
  noteOrderByWorkspaceId:
    data.noteOrder === undefined
      ? state.noteOrderByWorkspaceId
      : {
          ...state.noteOrderByWorkspaceId,
          [workspaceId]: data.noteOrder,
        },
  collapsedNoteIdsByWorkspaceId:
    data.collapsedNoteIds === undefined
      ? state.collapsedNoteIdsByWorkspaceId
      : {
          ...state.collapsedNoteIdsByWorkspaceId,
          [workspaceId]: data.collapsedNoteIds,
        },
}));
sidebarNavReducer.with(hydrateSidebarNav, (state, { payload }) => {
  const hydrated = payload;
  let combinedPanelSplit = state.combinedPanelSplit;
  if (hydrated.combinedPanelSplit !== undefined) {
    if (Number.isFinite(hydrated.combinedPanelSplit)) {
      combinedPanelSplit = Math.min(0.85, Math.max(0.15, hydrated.combinedPanelSplit));
    }
  }
  return {
    ...state,
    ...hydrated,
    combinedPanelSplit,
    panelItem:
      hydrated.panelItem === undefined
        ? state.panelItem
        : migrateLegacyPanelItem(hydrated.panelItem),
  };
});

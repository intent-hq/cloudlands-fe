/**
 * Sidebar Nav Slice
 *
 * Actions and reducer for the sidebar navigation state.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { SidebarNavState } from './sidebar-nav-types';

// ── localStorage keys ──
export const PINNED_WORKSPACES_KEY = 'intent:pinned-workspaces';
export const CHIEF_ACTIVE_AGENT_ID_KEY = 'intent:chief-active-agent-id';
export const MULTISELECT_SIDEBAR_SELECTED_TABS_PREFIX = 'multiselect-sidebar-';
export const MULTISELECT_SIDEBAR_TAB_ORDER_KEY = 'multiselect-sidebar-tab-order';
export const WORKSPACE_NOTE_ORDER_PREFIX = 'workspace-note-order-';
export const WORKSPACE_COLLAPSED_NOTES_PREFIX = 'workspace-collapsed-notes-';

// ── Initial State ──
export const initialState: SidebarNavState = {
  panelItem: null,
  onboardingActive: false,
  showCreateModal: false,
  pinnedWorkspaceIds: [],
  multiSelectTabOrder: [],
  multiSelectSelectedTabIdsByWorkspaceId: {},
  noteOrderByWorkspaceId: {},
  collapsedNoteIdsByWorkspaceId: {},
  chiefActiveAgentId: null,
  statsOverlayOpen: false,
};

// ── Actions ──

// Onboarding
export const setOnboardingActive = createAction<[active: boolean]>(
  'sidebarNav/setOnboardingActive',
);

// Create modal
export const setShowCreateModal = createAction<[show: boolean]>('sidebarNav/setShowCreateModal');

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

// Usage-stats overlay
export const setStatsOverlayOpen = createAction<[open: boolean]>('sidebarNav/setStatsOverlayOpen');

export const openPanel = createAction<[item: 'chief']>('sidebarNav/openPanel');
export const closePanel = createAction('sidebarNav/closePanel');

// Hydration from localStorage
type SidebarNavHydrationState = Partial<
  Pick<SidebarNavState, 'pinnedWorkspaceIds' | 'multiSelectTabOrder' | 'chiefActiveAgentId'>
>;

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

// ── Reducer ──
export const sidebarNavReducer = createReducer<SidebarNavState>(initialState);
sidebarNavReducer.with(setOnboardingActive, (state, { payload: [active] }) => ({
  ...state,
  onboardingActive: active,
}));
sidebarNavReducer.with(setShowCreateModal, (state, { payload: [show] }) => ({
  ...state,
  showCreateModal: show,
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
sidebarNavReducer.with(openPanel, (state, { payload: [item] }) => ({
  ...state,
  panelItem: item,
}));
sidebarNavReducer.with(closePanel, (state) => ({
  ...state,
  panelItem: null,
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
sidebarNavReducer.with(hydrateSidebarNav, (state, { payload }) => ({
  ...state,
  ...payload,
}));

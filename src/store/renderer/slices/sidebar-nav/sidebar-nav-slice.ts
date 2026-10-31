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
/** Set once local pins have been copied to daemon labels; the pin key is kept for rollback. */
export const PINNED_WORKSPACES_LABEL_MIGRATION_KEY = 'intent:pinned-workspaces-label-migration';
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

/**
 * Pin or unpin a workspace. On a daemon with label support this sets or clears
 * the `"pinned"` label; otherwise it toggles the local pin list.
 */
export const togglePinWorkspace = createAction<[id: string]>('sidebarNav/togglePinWorkspace');
/**
 * Set (string) or clear (`null`) a workspace's label via `workspace.update`.
 * Applied right away and rolled back with an error toast if the call fails.
 */
export const setWorkspaceLabel = createAction<[workspaceId: string, label: string | null]>(
  'sidebarNav/setWorkspaceLabel',
);
/**
 * Turn a workspace's auto-archive opt-out on (`true`) or off via
 * `workspace.update`. Applied right away and rolled back with an error toast
 * if the call fails.
 */
export const setWorkspaceAutoArchiveDisabled = createAction<
  [workspaceId: string, disabled: boolean]
>('sidebarNav/setWorkspaceAutoArchiveDisabled');
export const setMultiSelectSidebarSelectedTabs = createAction<
  [workspaceId: string, tabIds: string[]]
>('sidebarNav/setMultiSelectSidebarSelectedTabs');
export const activateSidebarSectionRequested = createAction<
  [workspaceId: string, sectionId: string, panelLayoutId?: string]
>('sidebarNav/activateSidebarSectionRequested');
export const cancelSidebarSectionNavigation = createAction<[workspaceId: string]>(
  'sidebarNav/cancelSidebarSectionNavigation',
);
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

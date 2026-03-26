import type { Workspace } from "$shared/types";
import { openTerminalOverlay, toggleTerminalOverlay } from "../terminals/terminals-slice";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../workspace-lifecycle/workspace-lifecycle-slice";

export type WorkspaceUpdatedEvent = {
  workspaceId: string;
  changes: Partial<Workspace>;
};

// ---------------------------------------------------------------------------
// Panel Visibility — workspace-scoped sub-state
// ---------------------------------------------------------------------------

export interface PanelVisibilityState {
  showNavigationRail: boolean;
  showNotesPanel: boolean;
  showCodeChangesPanel: boolean;
  showFilesPanel: boolean;
  showActivityLogPanel: boolean;
  showWorkspaceDock: boolean;
  showAgentNavRail: boolean;
  showTerminalNavRail: boolean;
  showMainContent: boolean;
  showChatHeader: boolean;
  isChatFocusedMode: boolean;
}

/** All panels visible by default. */
export const defaultPanelVisibility: PanelVisibilityState = {
  showNavigationRail: true,
  showNotesPanel: true,
  showCodeChangesPanel: true,
  showFilesPanel: true,
  showActivityLogPanel: true,
  showWorkspaceDock: true,
  showAgentNavRail: true,
  showTerminalNavRail: true,
  showMainContent: true,
  showChatHeader: true,
  isChatFocusedMode: false,
};

const {
  getWorkspaceState: getPanelVisibility,
  setWorkspaceState: setPanelVisibilityState,
  clearWorkspaceState: clearPanelVisibilityState,
} = createWorkspaceScopedHelpers(defaultPanelVisibility);

// ---------------------------------------------------------------------------
// Root workspace state
// ---------------------------------------------------------------------------

export type WorkspaceState = {
  activeWorkspaceId: string | null;
  byWorkspaceId: Record<string, Workspace>;
  panelVisibility: {
    byWorkspaceId: Record<string, PanelVisibilityState>;
  };
};

export const initialState: WorkspaceState = {
  activeWorkspaceId: null,
  byWorkspaceId: {},
  panelVisibility: {
    byWorkspaceId: {},
  },
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const setActiveWorkspaceId = createAction<[wsId: string]>("workspace/setActiveWorkspaceId");

/** Set a single panel visibility flag for a workspace. */
export const setPanelVisibility = createAction<
  [wsId: string, key: keyof PanelVisibilityState, value: boolean]
>("workspace/setPanelVisibility");

/** Bulk-set multiple panel visibility flags for a workspace. */
export const setPanelVisibilityBulk = createAction<
  [wsId: string, updates: Partial<PanelVisibilityState>]
>("workspace/setPanelVisibilityBulk");

/** Clear persisted panel visibility state for a workspace (e.g. on unmount/cleanup). */
export const clearPanelVisibility = createAction<[wsId: string]>(
  "workspace/clearPanelVisibility"
);

/** Store a full workspace entity by ID. */
export const setWorkspaceEntity = createAction<[workspace: Workspace]>(
  "workspace/setWorkspaceEntity"
);

/** Merge partial changes into an existing workspace entity. No-op if workspace not found. */
export const updateWorkspaceEntity = createAction<
  [wsId: string, changes: Partial<Workspace>]
>("workspace/updateWorkspaceEntity");

/** Remove a workspace entity by ID. */
export const removeWorkspaceEntity = createAction<[wsId: string]>(
  "workspace/removeWorkspaceEntity"
);

// ---------------------------------------------------------------------------
// Reducer helpers
// ---------------------------------------------------------------------------

function updateActiveWorkspaceId(state: WorkspaceState, wsId: string): WorkspaceState {
  if (state.activeWorkspaceId === wsId) return state;
  return { ...state, activeWorkspaceId: wsId };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const workspaceReducer = createReducer<WorkspaceState>(initialState)
  .with(setActiveWorkspaceId, (state, { payload: [wsId] }) => {
    return updateActiveWorkspaceId(state, wsId);
  })
  .with(openTerminalOverlay, (state, { payload: [wsId] }) => {
    return updateActiveWorkspaceId(state, wsId);
  })
  .with(toggleTerminalOverlay, (state, { payload: [wsId] }) => {
    return updateActiveWorkspaceId(state, wsId);
  })
  .with(setPanelVisibility, (state, { payload: [wsId, key, value] }) => {
    const current = getPanelVisibility(state.panelVisibility, wsId);
    if (current[key] === value) return state;
    const updated = { ...current, [key]: value };
    return {
      ...state,
      panelVisibility: setPanelVisibilityState(state.panelVisibility, wsId, updated),
    };
  })
  .with(setPanelVisibilityBulk, (state, { payload: [wsId, updates] }) => {
    const current = getPanelVisibility(state.panelVisibility, wsId);
    let changed = false;
    const updated = { ...current };
    for (const k of Object.keys(updates) as (keyof PanelVisibilityState)[]) {
      const v = updates[k];
      if (v !== undefined && current[k] !== v) {
        (updated as Record<string, boolean>)[k] = v;
        changed = true;
      }
    }
    if (!changed) return state;
    return {
      ...state,
      panelVisibility: setPanelVisibilityState(state.panelVisibility, wsId, updated),
    };
  })
  .with(clearPanelVisibility, (state, { payload: [wsId] }) => {
    const next = clearPanelVisibilityState(state.panelVisibility, wsId);
    if (next === state.panelVisibility) return state;
    return { ...state, panelVisibility: next };
  })
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => {
    // Keep panel visibility on unmount — it should survive workspace switches.
    // Only clear explicitly via clearPanelVisibility (e.g. workspace deletion).
    return state;
  })
  // -----------------------------------------------------------------------
  // Workspace entity storage
  // -----------------------------------------------------------------------
  .with(setWorkspaceEntity, (state, { payload: [workspace] }) => {
    return {
      ...state,
      byWorkspaceId: { ...state.byWorkspaceId, [workspace.id]: workspace },
    };
  })
  .with(updateWorkspaceEntity, (state, { payload: [wsId, changes] }) => {
    const existing = state.byWorkspaceId[wsId];
    if (!existing) return state;
    return {
      ...state,
      byWorkspaceId: { ...state.byWorkspaceId, [wsId]: { ...existing, ...changes } },
    };
  })
  .with(removeWorkspaceEntity, (state, { payload: [wsId] }) => {
    if (!(wsId in state.byWorkspaceId)) return state;
    const { [wsId]: _, ...rest } = state.byWorkspaceId;
    return { ...state, byWorkspaceId: rest };
  });
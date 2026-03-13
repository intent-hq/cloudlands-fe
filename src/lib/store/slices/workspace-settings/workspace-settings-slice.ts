import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type WorkspaceSettingsState = {
  autoCommitEnabled: boolean;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: WorkspaceSettingsState = {
  autoCommitEnabled: true,
};

// ============================================================================
// Actions
// ============================================================================

export const setAutoCommitEnabled = createAction<[workspaceId: string, enabled: boolean]>(
  "workspaceSettings/setAutoCommitEnabled"
);

export const toggleAutoCommit = createAction<[workspaceId: string]>(
  "workspaceSettings/toggleAutoCommit"
);

export const refreshAutoCommitSettings = createAction(
  "workspaceSettings/refreshAutoCommitSettings"
);

export const syncWorkspaceSettings = createAction<[workspaceId: string]>(
  "workspaceSettings/syncWorkspaceSettings"
);

export const loadAutoCommitSettings = createAction<[enabled: boolean]>(
  "workspaceSettings/loadAutoCommitSettings"
);

// ============================================================================
// Reducer
// ============================================================================

export const workspaceSettingsReducer = createReducer<WorkspaceSettingsState>(initialState)
  .with(setAutoCommitEnabled, (state, { payload: [, enabled] }) => ({
    ...state,
    autoCommitEnabled: enabled,
  }))
  .with(toggleAutoCommit, (state) => ({
    ...state,
    autoCommitEnabled: !state.autoCommitEnabled,
  }))
  .with(loadAutoCommitSettings, (state, { payload: [enabled] }) => ({
    ...state,
    autoCommitEnabled: enabled,
  }));


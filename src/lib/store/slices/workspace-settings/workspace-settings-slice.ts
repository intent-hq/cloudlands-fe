import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";

// ============================================================================
// Types
// ============================================================================

export type SingleWorkspaceSettings = {
  autoCommitEnabled: boolean;
};

export type WorkspaceSettingsState = {
  byWorkspaceId: Record<string, SingleWorkspaceSettings>;
};

// ============================================================================
// Initial State
// ============================================================================

export const emptyWorkspaceSettings: SingleWorkspaceSettings = {
  autoCommitEnabled: true,
};

export const initialState: WorkspaceSettingsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceSettings);

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

export const loadAutoCommitSettings = createAction<[workspaceId: string, enabled: boolean]>(
  "workspaceSettings/loadAutoCommitSettings"
);

export const clearWorkspaceSettings = createAction<[workspaceId: string]>(
  "workspaceSettings/clearWorkspaceSettings"
);

// ============================================================================
// Reducer
// ============================================================================

export const workspaceSettingsReducer = createReducer<WorkspaceSettingsState>(initialState)
  .with(setAutoCommitEnabled, (state, { payload: [workspaceId, enabled] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...wsState,
      autoCommitEnabled: enabled,
    });
  })
  .with(toggleAutoCommit, (state, { payload: [workspaceId] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...wsState,
      autoCommitEnabled: !wsState.autoCommitEnabled,
    });
  })
  .with(loadAutoCommitSettings, (state, { payload: [workspaceId, enabled] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...wsState,
      autoCommitEnabled: enabled,
    });
  })
  .with(clearWorkspaceSettings, (state, { payload: [workspaceId] }) =>
    clearWorkspaceState(state, workspaceId)
  );


import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';

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

const initialState: WorkspaceSettingsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceSettings);

// ============================================================================
// Actions
// ============================================================================

export const setAutoCommitEnabled = createAction<[workspaceId: string, enabled: boolean]>(
  'workspaceSettings/setAutoCommitEnabled',
);

export const refreshAutoCommitSettings = createAction(
  'workspaceSettings/refreshAutoCommitSettings',
);

export const syncWorkspaceSettings = createAction<[workspaceId: string]>(
  'workspaceSettings/syncWorkspaceSettings',
);

export const loadAutoCommitSettings = createAction<[workspaceId: string, enabled: boolean]>(
  'workspaceSettings/loadAutoCommitSettings',
);

export const clearWorkspaceSettings = createAction<[workspaceId: string]>(
  'workspaceSettings/clearWorkspaceSettings',
);

// ============================================================================
// Reducer
// ============================================================================

export const workspaceSettingsReducer = createReducer<WorkspaceSettingsState>(initialState);
workspaceSettingsReducer.with(
  setAutoCommitEnabled,
  (state, { payload: [workspaceId, enabled] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...wsState,
      autoCommitEnabled: enabled,
    });
  },
);
workspaceSettingsReducer.with(
  loadAutoCommitSettings,
  (state, { payload: [workspaceId, enabled] }) => {
    const wsState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...wsState,
      autoCommitEnabled: enabled,
    });
  },
);
workspaceSettingsReducer.with(clearWorkspaceSettings, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);

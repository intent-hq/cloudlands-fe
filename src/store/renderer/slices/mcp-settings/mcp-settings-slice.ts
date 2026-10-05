import { getMcpServerKey } from '$lib/components/settings/mcp/types';
/**
 * MCP Settings Slice
 *
 * Actions and reducer for MCP server management.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { omitKey } from '../../utils/utils';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  McpSettingsState,
  McpServerConfig,
  McpServerStatus,
  WorkspaceMcpSettingsState,
} from './mcp-settings-types';

// ============================================================================
// Initial State
// ============================================================================

const emptyWorkspaceMcpSettingsState: WorkspaceMcpSettingsState = {
  disabledServers: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyWorkspaceMcpSettingsState,
);

export const initialState: McpSettingsState = {
  servers: [],
  statusMap: {},
  errorMessages: {},
  toolsMap: {},
  disabledServers: {},
  loading: false,
  error: null,
  enabled: false,
  lastImportedCount: null,
  advancedSaveStatus: 'idle',
  advancedSaveError: null,
  byWorkspaceId: {},
};

// ============================================================================
// Actions — Pure state updates
// ============================================================================

/** Set the full server list */
export const setServers = createAction<[servers: McpServerConfig[]]>('mcpSettings/setServers');

/** Set loading state */
export const setLoading = createAction<[loading: boolean]>('mcpSettings/setLoading');

/** Set global error */
export const setError = createAction<[error: string | null]>('mcpSettings/setError');

/** Set feature enabled */
export const setEnabled = createAction<[enabled: boolean]>('mcpSettings/setEnabled');

/** Set a server's status */
export const setServerStatus = createAction<[key: string, status: McpServerStatus]>(
  'mcpSettings/setServerStatus',
);

/** Set server error message */
export const setServerErrorMessage = createAction<[key: string, message: string]>(
  'mcpSettings/setServerErrorMessage',
);

/** Clear a server's error message */
export const clearServerErrorMessage = createAction<[key: string]>(
  'mcpSettings/clearServerErrorMessage',
);

/** Clear all error messages */
export const clearAllErrorMessages = createAction('mcpSettings/clearAllErrorMessages');

/** Set disabled servers map */
export const setDisabledServers = createAction<[disabled: Record<string, true>]>(
  'mcpSettings/setDisabledServers',
);

/** Toggle a server's disabled state */
export const toggleServerDisabled = createAction<[key: string]>('mcpSettings/toggleServerDisabled');

/** Remove a server from local state */
export const removeServerFromState = createAction<[key: string]>(
  'mcpSettings/removeServerFromState',
);

/** Bulk update status map (e.g. after loading servers) */
export const bulkSetServerStatus = createAction<[statusMap: Record<string, McpServerStatus>]>(
  'mcpSettings/bulkSetServerStatus',
);

/** Set one server's daemon-confirmed per-workspace disabled state */
export const setWorkspaceMcpServerDisabled = createAction<
  [workspaceId: string, serverKey: string, disabled: boolean]
>('mcpSettings/setWorkspaceMcpServerDisabled');

/** Replace a workspace's disabled-server map from the daemon's scoped list */
export const setWorkspaceDisabledMcpServers = createAction<
  [workspaceId: string, disabled: Record<string, true>]
>('mcpSettings/setWorkspaceDisabledMcpServers');

// ============================================================================
// Saga trigger actions (side-effect-only, no reducer handler)
// ============================================================================

/**
 * Trigger: toggle a server for one workspace via the daemon's workspace-scoped
 * `mcp.servers.toggle` (PROTOCOL §5.22 per-workspace disable). State is written
 * by the saga via `setWorkspaceMcpServerDisabled` once the daemon confirms.
 */
export const toggleWorkspaceMcpServer = createAction<
  [workspaceId: string, serverKey: string, enabled: boolean]
>('mcpSettings/toggleWorkspaceMcpServer');

/** Trigger: hydrate a workspace's disabled-server map from the daemon's scoped list */
export const hydrateWorkspaceMcpDisabled = createAction<[workspaceId: string]>(
  'mcpSettings/hydrateWorkspaceMcpDisabled',
);

/** Trigger: load servers from main process */
export const loadServers = createAction('mcpSettings/loadServers');

/** Trigger: toggle feature enabled/disabled */
export const toggleEnabled = createAction('mcpSettings/toggleEnabled');

/** Trigger: toggle a server's disabled state and persist */
export const toggleServer = createAction<[key: string]>('mcpSettings/toggleServer');

/** Trigger: add a new server */
export const addServer = createAction<[config: McpServerConfig]>('mcpSettings/addServer');

/** Trigger: remove a server */
export const removeServer = createAction<[key: string]>('mcpSettings/removeServer');

/** Trigger: update a server (remove + add) */
export const updateServer = createAction<[key: string, config: McpServerConfig]>(
  'mcpSettings/updateServer',
);

/** Trigger: import servers from JSON */
export const importFromJson = createAction<[jsonString: string]>('mcpSettings/importFromJson');

/** Dispatched by the saga after a successful JSON import */
export const importFromJsonCompleted = createAction<[count: number]>(
  'mcpSettings/importFromJsonCompleted',
);

/** Trigger: retry/restart a stopped or errored server */
export const restartServer = createAction<[key: string]>('mcpSettings/restartServer');

/** Trigger: run interactive OAuth for a saved hosted server */
export const authenticateServer = createAction<[key: string]>('mcpSettings/authenticateServer');

/** Trigger: replace the whole server set from the advanced JSON editor */
export const saveAdvancedJson = createAction<[jsonString: string]>('mcpSettings/saveAdvancedJson');

/** Set the advanced-editor save status (+ optional error message) */
export const setAdvancedSaveStatus = createAction<
  [status: McpSettingsState['advancedSaveStatus'], error?: string | null]
>('mcpSettings/setAdvancedSaveStatus');

// ============================================================================
// Reducer
// ============================================================================

export const mcpSettingsReducer = createReducer<McpSettingsState>(initialState);

mcpSettingsReducer.with(setServers, (state, { payload: [servers] }) => {
  // A newly saved legacy entry gains an ID; move its metadata to that key.
  const assigned = servers.flatMap((server) => {
    if (!server.id) return [];
    const previous = state.servers.filter((candidate) => candidate.name === server.name);
    return previous.length === 1 && previous[0].id === undefined
      ? [[server.name, server.id] as const]
      : [];
  });
  const rekey = <T>(map: Record<string, T>): Record<string, T> => {
    if (assigned.length === 0) return map;
    const next = { ...map };
    for (const [name, id] of assigned) {
      if (Object.hasOwn(next, name)) {
        next[id] = next[name];
        delete next[name];
      }
    }
    return next;
  };
  return {
    ...state,
    servers,
    statusMap: rekey(state.statusMap),
    errorMessages: rekey(state.errorMessages),
    toolsMap: rekey(state.toolsMap),
    disabledServers: rekey(state.disabledServers),
    byWorkspaceId:
      assigned.length === 0
        ? state.byWorkspaceId
        : Object.fromEntries(
            Object.entries(state.byWorkspaceId).map(([id, workspace]) => [
              id,
              { disabledServers: rekey(workspace.disabledServers) },
            ]),
          ),
  };
});
mcpSettingsReducer.with(setLoading, (state, { payload: [loading] }) => ({
  ...state,
  loading,
}));
mcpSettingsReducer.with(setError, (state, { payload: [error] }) => ({
  ...state,
  error,
}));
mcpSettingsReducer.with(setEnabled, (state, { payload: [enabled] }) => ({
  ...state,
  enabled,
}));
mcpSettingsReducer.with(setServerStatus, (state, { payload: [name, status] }) => ({
  ...state,
  statusMap: { ...state.statusMap, [name]: status },
}));
mcpSettingsReducer.with(setServerErrorMessage, (state, { payload: [name, message] }) => ({
  ...state,
  errorMessages: { ...state.errorMessages, [name]: message },
}));
mcpSettingsReducer.with(clearServerErrorMessage, (state, { payload: [name] }) => {
  const { [name]: _, ...rest } = state.errorMessages;
  return { ...state, errorMessages: rest };
});
mcpSettingsReducer.with(clearAllErrorMessages, (state) => ({
  ...state,
  errorMessages: {},
}));
mcpSettingsReducer.with(setDisabledServers, (state, { payload: [disabled] }) => ({
  ...state,
  disabledServers: disabled,
}));
mcpSettingsReducer.with(toggleServerDisabled, (state, { payload: [name] }) => {
  const isDisabled = name in state.disabledServers;
  if (isDisabled) {
    const { [name]: _, ...rest } = state.disabledServers;
    return { ...state, disabledServers: rest };
  }
  return { ...state, disabledServers: { ...state.disabledServers, [name]: true as const } };
});
mcpSettingsReducer.with(removeServerFromState, (state, { payload: [name] }) => {
  const { [name]: _s, ...restStatus } = state.statusMap;

  const { [name]: _t, ...restTools } = state.toolsMap;

  const { [name]: _e, ...restErrors } = state.errorMessages;

  const { [name]: _d, ...restDisabled } = state.disabledServers;
  return {
    ...state,
    servers: state.servers.filter((s) => getMcpServerKey(s) !== name),
    statusMap: restStatus,
    toolsMap: restTools,
    errorMessages: restErrors,
    disabledServers: restDisabled,
  };
});
mcpSettingsReducer.with(bulkSetServerStatus, (state, { payload: [statusMap] }) => ({
  ...state,
  statusMap: { ...state.statusMap, ...statusMap },
}));
mcpSettingsReducer.with(importFromJsonCompleted, (state, { payload: [count] }) => ({
  ...state,
  lastImportedCount: count,
}));
mcpSettingsReducer.with(setAdvancedSaveStatus, (state, { payload: [status, error] }) => ({
  ...state,
  advancedSaveStatus: status,
  advancedSaveError: error ?? null,
}));
mcpSettingsReducer.with(
  setWorkspaceMcpServerDisabled,
  (state, { payload: [workspaceId, serverKey, disabled] }) => {
    if (!workspaceId) return state;
    const wsState = getWorkspaceState(state, workspaceId);
    const currentlyDisabled = serverKey in wsState.disabledServers;
    if (disabled === currentlyDisabled) return state;

    const disabledServers = disabled
      ? { ...wsState.disabledServers, [serverKey]: true as const }
      : omitKey(wsState.disabledServers, serverKey);

    return setWorkspaceState(state, workspaceId, { disabledServers });
  },
);
mcpSettingsReducer.with(
  setWorkspaceDisabledMcpServers,
  (state, { payload: [workspaceId, disabled] }) => {
    if (!workspaceId) return state;
    return setWorkspaceState(state, workspaceId, { disabledServers: disabled });
  },
);
mcpSettingsReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) => {
  return clearWorkspaceState(state, workspaceId);
});

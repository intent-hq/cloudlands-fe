/**
 * MCP Settings Slice
 *
 * Actions and reducer for MCP server management.
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { omitKey } from "../../utils/utils";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type {
  McpSettingsState,
  McpServerConfig,
  McpServerStatus,
  WorkspaceMcpSettingsState,
} from "./mcp-settings-types";

// ============================================================================
// Initial State
// ============================================================================

export const emptyWorkspaceMcpSettingsState: WorkspaceMcpSettingsState = {
  disabledServers: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceMcpSettingsState);

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
  byWorkspaceId: {},
};

// ============================================================================
// Actions — Pure state updates
// ============================================================================

/** Set the full server list */
export const setServers = createAction<[servers: McpServerConfig[]]>(
  "mcpSettings/setServers"
);

/** Set loading state */
export const setLoading = createAction<[loading: boolean]>(
  "mcpSettings/setLoading"
);

/** Set global error */
export const setError = createAction<[error: string | null]>(
  "mcpSettings/setError"
);

/** Set feature enabled */
export const setEnabled = createAction<[enabled: boolean]>(
  "mcpSettings/setEnabled"
);

/** Set a server's status */
export const setServerStatus = createAction<[name: string, status: McpServerStatus]>(
  "mcpSettings/setServerStatus"
);

/** Set server error message */
export const setServerErrorMessage = createAction<[name: string, message: string]>(
  "mcpSettings/setServerErrorMessage"
);

/** Clear a server's error message */
export const clearServerErrorMessage = createAction<[name: string]>(
  "mcpSettings/clearServerErrorMessage"
);

/** Clear all error messages */
export const clearAllErrorMessages = createAction(
  "mcpSettings/clearAllErrorMessages"
);

/** Set disabled servers map */
export const setDisabledServers = createAction<[disabled: Record<string, true>]>(
  "mcpSettings/setDisabledServers"
);

/** Toggle a server's disabled state */
export const toggleServerDisabled = createAction<[name: string]>(
  "mcpSettings/toggleServerDisabled"
);

/** Remove a server from local state */
export const removeServerFromState = createAction<[name: string]>(
  "mcpSettings/removeServerFromState"
);

/** Bulk update status map (e.g. after loading servers) */
export const bulkSetServerStatus = createAction<[statusMap: Record<string, McpServerStatus>]>(
  "mcpSettings/bulkSetServerStatus"
);

/** Set persisted disabled server names for a workspace */
export const setWorkspaceDisabledServers = createAction<
  [workspaceId: string, disabledServers: Record<string, true>]
>("mcpSettings/setWorkspaceDisabledServers");

/** Apply persisted disabled server names for a workspace */
export const applyWorkspaceDisabledServers = createAction<
  [workspaceId: string, disabledNames: string[]]
>("mcpSettings/applyWorkspaceDisabledServers");

/** Toggle a workspace-specific server enabled state and persist it */
export const toggleWorkspaceMcpServer = createAction<
  [workspaceId: string, serverName: string, enabled: boolean]
>("mcpSettings/toggleWorkspaceMcpServer");

// ============================================================================
// Saga trigger actions (side-effect-only, no reducer handler)
// ============================================================================

/** Trigger: load servers from main process */
export const loadServers = createAction("mcpSettings/loadServers");

/** Trigger: toggle feature enabled/disabled */
export const toggleEnabled = createAction("mcpSettings/toggleEnabled");

/** Trigger: toggle a server's disabled state and persist */
export const toggleServer = createAction<[name: string]>(
  "mcpSettings/toggleServer"
);

/** Trigger: add a new server */
export const addServer = createAction<[config: McpServerConfig]>(
  "mcpSettings/addServer"
);

/** Trigger: remove a server */
export const removeServer = createAction<[name: string]>(
  "mcpSettings/removeServer"
);

/** Trigger: update a server (remove + add) */
export const updateServer = createAction<[name: string, config: McpServerConfig]>(
  "mcpSettings/updateServer"
);

/** Trigger: import servers from JSON */
export const importFromJson = createAction<[jsonString: string]>(
  "mcpSettings/importFromJson"
);

/** Dispatched by the saga after a successful JSON import */
export const importFromJsonCompleted = createAction<[count: number]>(
  "mcpSettings/importFromJsonCompleted"
);

/** Trigger: test a server connection */
export const testServerConnection = createAction<
  [name: string, url: string, headers?: Record<string, string>]
>("mcpSettings/testServerConnection");

// ============================================================================
// Reducer
// ============================================================================

export const mcpSettingsReducer = createReducer<McpSettingsState>(initialState)
  .with(setServers, (state, { payload: [servers] }) => ({
    ...state,
    servers,
  }))
  .with(setLoading, (state, { payload: [loading] }) => ({
    ...state,
    loading,
  }))
  .with(setError, (state, { payload: [error] }) => ({
    ...state,
    error,
  }))
  .with(setEnabled, (state, { payload: [enabled] }) => ({
    ...state,
    enabled,
  }))
  .with(setServerStatus, (state, { payload: [name, status] }) => ({
    ...state,
    statusMap: { ...state.statusMap, [name]: status },
  }))
  .with(setServerErrorMessage, (state, { payload: [name, message] }) => ({
    ...state,
    errorMessages: { ...state.errorMessages, [name]: message },
  }))
  .with(clearServerErrorMessage, (state, { payload: [name] }) => {
     
    const { [name]: _, ...rest } = state.errorMessages;
    return { ...state, errorMessages: rest };
  })
  .with(clearAllErrorMessages, (state) => ({
    ...state,
    errorMessages: {},
  }))
  .with(setDisabledServers, (state, { payload: [disabled] }) => ({
    ...state,
    disabledServers: disabled,
  }))
  .with(toggleServerDisabled, (state, { payload: [name] }) => {
    const isDisabled = name in state.disabledServers;
    if (isDisabled) {
       
      const { [name]: _, ...rest } = state.disabledServers;
      return { ...state, disabledServers: rest };
    }
    return { ...state, disabledServers: { ...state.disabledServers, [name]: true as const } };
  })
  .with(removeServerFromState, (state, { payload: [name] }) => {
     
    const { [name]: _s, ...restStatus } = state.statusMap;
     
    const { [name]: _t, ...restTools } = state.toolsMap;
     
    const { [name]: _e, ...restErrors } = state.errorMessages;
     
    const { [name]: _d, ...restDisabled } = state.disabledServers;
    return {
      ...state,
      servers: state.servers.filter((s) => s.name !== name),
      statusMap: restStatus,
      toolsMap: restTools,
      errorMessages: restErrors,
      disabledServers: restDisabled,
    };
  })
  .with(bulkSetServerStatus, (state, { payload: [statusMap] }) => ({
    ...state,
    statusMap: { ...state.statusMap, ...statusMap },
  }))
  .with(importFromJsonCompleted, (state, { payload: [count] }) => ({
    ...state,
    lastImportedCount: count,
  }))
  .with(setWorkspaceDisabledServers, (state, { payload: [workspaceId, disabledServers] }) => {
    if (!workspaceId) return state;
    return setWorkspaceState(state, workspaceId, { disabledServers });
  })
  .with(applyWorkspaceDisabledServers, (state, { payload: [workspaceId, disabledNames] }) => {
    if (!workspaceId) return state;
    const disabledServers: Record<string, true> = {};
    for (const name of disabledNames) {
      disabledServers[name] = true;
    }
    return setWorkspaceState(state, workspaceId, { disabledServers });
  })
  .with(toggleWorkspaceMcpServer, (state, { payload: [workspaceId, serverName, enabled] }) => {
    if (!workspaceId) return state;
    const wsState = getWorkspaceState(state, workspaceId);
    const currentlyDisabled = serverName in wsState.disabledServers;

    if (enabled && !currentlyDisabled) return state;
    if (!enabled && currentlyDisabled) return state;

    const disabledServers = enabled
      ? omitKey(wsState.disabledServers, serverName)
      : { ...wsState.disabledServers, [serverName]: true as const };

    return setWorkspaceState(state, workspaceId, { disabledServers });
  })
  .with(workspaceUnmounted, (state, { payload: [workspaceId] }) => {
    return clearWorkspaceState(state, workspaceId);
  });


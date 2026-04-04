import { createAction } from "../../utils/create-action";
import { createReducer, setStateValue } from "../../utils/create-reducer";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import { omitKey } from "../../utils/utils";
import type { McpServerInfo, McpServersState, WorkspaceMcpState } from "./mcp-servers-types";

// ============================================================================
// Initial State
// ============================================================================

export const emptyWorkspaceMcpState: WorkspaceMcpState = {
  enabledServers: {},
};

export const initialState: McpServersState = {
  servers: [],
  loading: false,
  error: null,
  serverErrors: {},
  byWorkspaceId: {},
};

// ============================================================================
// Actions
// ============================================================================

/** Trigger loading servers from main process */
export const loadMcpServers = createAction("mcpServers/loadServers");

/** Set loading state */
export const setMcpLoading = createAction<[loading: boolean]>(
  "mcpServers/setLoading"
);

/** Set loaded servers */
export const setMcpServersData = createAction<[servers: McpServerInfo[]]>(
  "mcpServers/setServersData"
);

/** Set error */
export const setMcpError = createAction<[error: string | null]>(
  "mcpServers/setError"
);

/** Clear server errors (on reload) */
export const clearMcpServerErrors = createAction(
  "mcpServers/clearServerErrors"
);

/** Set a per-server error */
export const setMcpServerError = createAction<[serverName: string, errorMessage: string]>(
  "mcpServers/setServerError"
);

/** Toggle a server's enabled state for a workspace */
export const toggleMcpServer = createAction<[workspaceId: string, serverName: string, enabled: boolean]>(
  "mcpServers/toggleServer"
);

/** Apply disabled servers list to a workspace (from storage/defaults) */
export const applyDisabledServers = createAction<[workspaceId: string, disabledNames: string[]]>(
  "mcpServers/applyDisabledServers"
);

// ============================================================================
// Reducer
// ============================================================================

export const mcpServersReducer = createReducer<McpServersState>(initialState)
  .with(setMcpLoading, (state, { payload: [loading] }) => setStateValue(state, "loading", loading))
  .with(setMcpServersData, (state, { payload: [servers] }) => setStateValue(state, "servers", servers))
  .with(setMcpError, (state, { payload: [error] }) => setStateValue(state, "error", error))
  .with(clearMcpServerErrors, (state) => ({
    ...state,
    serverErrors: {},
  }))
  .with(setMcpServerError, (state, { payload: [serverName, errorMessage] }) => ({
    ...state,
    serverErrors: { ...state.serverErrors, [serverName]: errorMessage },
  }))
  .with(toggleMcpServer, (state, { payload: [workspaceId, serverName, enabled] }) => {
    if (!workspaceId) return state;
    const wsState = state.byWorkspaceId[workspaceId] ?? { enabledServers: {} };
    return {
      ...state,
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: {
          ...wsState,
          enabledServers: { ...wsState.enabledServers, [serverName]: enabled },
        },
      },
    };
  })
  .with(applyDisabledServers, (state, { payload: [workspaceId, disabledNames] }) => {
    const enabledServers: Record<string, boolean> = {};
    for (const name of disabledNames) {
      enabledServers[name] = false;
    }
    return {
      ...state,
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: { enabledServers },
      },
    };
  })
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => {
    const byWorkspaceId = omitKey(state.byWorkspaceId, wsId);
    if (byWorkspaceId === state.byWorkspaceId) return state;
    return { ...state, byWorkspaceId };
  });


import { createSelector } from "../../utils/create-selector";

/** All configured MCP servers */
export const selectMcpServers = createSelector(
  (state) => state.mcpServers.servers
);

/** Whether servers are currently loading */
export const selectMcpLoading = createSelector(
  (state) => state.mcpServers.loading
);

/** Global error message */
export const selectMcpError = createSelector(
  (state) => state.mcpServers.error
);

/** Per-server error messages */
export const selectMcpServerErrors = createSelector(
  (state) => state.mcpServers.serverErrors
);

/** Check if a specific server is enabled in the current workspace */
export const selectIsMcpServerEnabled = createSelector(
  (state, serverName: string) => {
    const wsId = state.workspace.activeWorkspaceId;
    if (!wsId) return true;
    const wsState = state.mcpServers.byWorkspaceId[wsId];
    return wsState?.enabledServers[serverName] !== false;
  }
);

/** Get error message for a specific server */
export const selectMcpServerError = createSelector(
  (state, serverName: string) => {
    return state.mcpServers.serverErrors[serverName] as string | undefined;
  }
);

/** Get enabled servers for current workspace */
export const selectEnabledMcpServers = createSelector((state) => {
  const wsId = state.workspace.activeWorkspaceId;
  if (!wsId) return [];
  const wsState = state.mcpServers.byWorkspaceId[wsId];
  return state.mcpServers.servers.filter(
    (server) => wsState?.enabledServers[server.name] !== false
  );
});

/** Get disabled server names for current workspace */
export const selectDisabledMcpServerNames = createSelector((state) => {
  const wsId = state.workspace.activeWorkspaceId;
  if (!wsId) return [];
  const wsState = state.mcpServers.byWorkspaceId[wsId];
  if (!wsState) return [];
  return Object.entries(wsState.enabledServers)
    .filter(([, enabled]) => enabled === false)
    .map(([name]) => name);
});


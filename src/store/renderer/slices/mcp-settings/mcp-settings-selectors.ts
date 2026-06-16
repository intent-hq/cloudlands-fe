/**
 * MCP Settings Selectors
 */

import { store } from "../../store";
import type { McpServerStatus, McpServerConfig } from "./mcp-settings-types";
import type { McpServerWithStatus } from "$lib/components/settings/mcp/types";

const EMPTY_DISABLED_SERVERS: Record<string, true> = {};

/** Select raw server list */
export const selectMcpServers = store.createSelector(
  (state) => state.mcpSettings.servers as McpServerConfig[]
);

/** Select loading state */
export const selectMcpLoading = store.createSelector(
  (state) => state.mcpSettings.loading as boolean
);

/** Select global error */
export const selectMcpError = store.createSelector(
  (state) => state.mcpSettings.error as string | null
);

/** Select feature enabled */
export const selectMcpEnabled = store.createSelector(
  (state) => state.mcpSettings.enabled as boolean
);

/** Select disabled servers map */
export const selectMcpDisabledServers = store.createSelector(
  (state) => state.mcpSettings.disabledServers as Record<string, true>
);

/** Select status map */
export const selectMcpStatusMap = store.createSelector(
  (state) => state.mcpSettings.statusMap as Record<string, McpServerStatus>
);

/** Select tools map */
const selectMcpToolsMap = store.createSelector(
  (state) => state.mcpSettings.toolsMap as Record<string, import("./mcp-settings-types").McpTool[]>
);

/** Select error messages map */
export const selectMcpErrorMessages = store.createSelector(
  (state) => state.mcpSettings.errorMessages as Record<string, string>
);

/** Select workspace-specific disabled servers map by workspace id */
const selectWorkspaceMcpDisabledServersByWorkspaceId = store.createSelector(
  (state, workspaceId: string | null | undefined): Record<string, true> => {
    if (!workspaceId) return EMPTY_DISABLED_SERVERS;
    return state.mcpSettings.byWorkspaceId[workspaceId]?.disabledServers ?? EMPTY_DISABLED_SERVERS;
  }
);

/** Select disabled server names for a workspace */
export const selectWorkspaceDisabledMcpServerNamesByWorkspaceId = store.createSelector(
  (state, workspaceId: string | null | undefined): string[] => {
    return Object.keys(selectWorkspaceMcpDisabledServersByWorkspaceId.select(state, workspaceId));
  }
);

/** Select servers with status, tools, and disabled info attached */
export const selectMcpServersWithStatus = store.createSelector((state): McpServerWithStatus[] => {
  const servers = selectMcpServers.select(state);
  const statusMap = selectMcpStatusMap.select(state);
  const toolsMap = selectMcpToolsMap.select(state);
  const disabledServers = selectMcpDisabledServers.select(state);
  const errorMessages = selectMcpErrorMessages.select(state);

  return servers.map((server) => {
    const disabled = server.name in disabledServers;
    const tools = toolsMap[server.name] || [];
    let status: McpServerStatus = statusMap[server.name] || "disconnected";

    if (disabled) {
      status = "disabled";
    }

    return {
      ...server,
      disabled,
      status,
      tools,
      toolCount: tools.length,
      errorMessage: errorMessages[server.name],
    };
  });
});

/** Get error message for a specific server */
export const selectMcpServerErrorMessage = store.createSelector(
  (state, name: string): string | undefined => {
    return (state.mcpSettings.errorMessages as Record<string, string>)[name];
  }
);

/** Select the last imported count (set after JSON import completes) */
export const selectMcpLastImportedCount = store.createSelector(
  (state) => state.mcpSettings.lastImportedCount as number | null
);


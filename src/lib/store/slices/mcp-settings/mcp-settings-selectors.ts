/**
 * MCP Settings Selectors
 */

import { createSelector } from "../../utils/create-selector";
import type { McpServerStatus, McpServerConfig } from "./mcp-settings-types";
import type { McpServerWithStatus } from "$lib/components/settings/mcp/types";

const EMPTY_DISABLED_SERVERS: Record<string, true> = {};

/** Select raw server list */
export const selectMcpServers = createSelector(
  (state) => state.mcpSettings.servers as McpServerConfig[]
);

/** Select loading state */
export const selectMcpLoading = createSelector(
  (state) => state.mcpSettings.loading as boolean
);

/** Select global error */
export const selectMcpError = createSelector(
  (state) => state.mcpSettings.error as string | null
);

/** Select feature enabled */
export const selectMcpEnabled = createSelector(
  (state) => state.mcpSettings.enabled as boolean
);

/** Select disabled servers map */
export const selectMcpDisabledServers = createSelector(
  (state) => state.mcpSettings.disabledServers as Record<string, true>
);

/** Select status map */
export const selectMcpStatusMap = createSelector(
  (state) => state.mcpSettings.statusMap as Record<string, McpServerStatus>
);

/** Select tools map */
export const selectMcpToolsMap = createSelector(
  (state) => state.mcpSettings.toolsMap as Record<string, import("./mcp-settings-types").McpTool[]>
);

/** Select error messages map */
export const selectMcpErrorMessages = createSelector(
  (state) => state.mcpSettings.errorMessages as Record<string, string>
);

/** Select workspace-specific disabled servers map by workspace id */
export const selectWorkspaceMcpDisabledServersByWorkspaceId = createSelector(
  (state, workspaceId: string | null | undefined): Record<string, true> => {
    if (!workspaceId) return EMPTY_DISABLED_SERVERS;
    return state.mcpSettings.byWorkspaceId[workspaceId]?.disabledServers ?? EMPTY_DISABLED_SERVERS;
  }
);

/** Select workspace-specific disabled servers map for the active workspace */
export const selectWorkspaceMcpDisabledServers = createSelector((state): Record<string, true> => {
  return selectWorkspaceMcpDisabledServersByWorkspaceId.select(
    state,
    state.workspace.activeWorkspaceId
  );
});

/** Select disabled server names for a workspace */
export const selectWorkspaceDisabledMcpServerNamesByWorkspaceId = createSelector(
  (state, workspaceId: string | null | undefined): string[] => {
    return Object.keys(selectWorkspaceMcpDisabledServersByWorkspaceId.select(state, workspaceId));
  }
);

/** Select disabled server names for the active workspace */
export const selectWorkspaceDisabledMcpServerNames = createSelector((state): string[] => {
  return Object.keys(selectWorkspaceMcpDisabledServers.select(state));
});

/** Check if a server is enabled in the active workspace */
export const selectIsWorkspaceMcpServerEnabled = createSelector(
  (state, name: string): boolean => {
    return !(name in selectWorkspaceMcpDisabledServers.select(state));
  }
);

/** Select servers enabled in the active workspace */
export const selectEnabledMcpServers = createSelector((state): McpServerConfig[] => {
  const disabledServers = selectWorkspaceMcpDisabledServers.select(state);
  return selectMcpServers.select(state).filter((server) => !(server.name in disabledServers));
});

/** Select count of servers enabled in the active workspace */
export const selectEnabledMcpServerCount = createSelector((state): number => {
  return selectEnabledMcpServers.select(state).length;
});

/** Select servers with status, tools, and disabled info attached */
export const selectMcpServersWithStatus = createSelector((state): McpServerWithStatus[] => {
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

/** Check if a specific server is disabled */
export const selectIsServerDisabled = createSelector(
  (state, name: string): boolean => {
    return name in (state.mcpSettings.disabledServers as Record<string, true>);
  }
);

/** Get status for a specific server */
export const selectServerStatus = createSelector(
  (state, name: string): McpServerStatus => {
    if (name in (state.mcpSettings.disabledServers as Record<string, true>)) {
      return "disabled";
    }
    return (state.mcpSettings.statusMap as Record<string, McpServerStatus>)[name] || "disconnected";
  }
);

/** Get tool count for a specific server */
export const selectServerToolCount = createSelector(
  (state, name: string): number => {
    const tools = (state.mcpSettings.toolsMap as Record<string, import("./mcp-settings-types").McpTool[]>)[name];
    return tools?.length || 0;
  }
);

/** Get error message for a specific server */
export const selectMcpServerErrorMessage = createSelector(
  (state, name: string): string | undefined => {
    return (state.mcpSettings.errorMessages as Record<string, string>)[name];
  }
);

/** Select the last imported count (set after JSON import completes) */
export const selectMcpLastImportedCount = createSelector(
  (state) => state.mcpSettings.lastImportedCount as number | null
);


/**
 * MCP Settings Types
 *
 * Types for the mcp-settings Redux slice.
 * Safe to import from any process (no renderer dependencies).
 */

import type {
  McpServerConfig,
  McpServerStatus,
  McpTool,
} from "$lib/components/settings/mcp/types";

// Re-export for convenience
export type { McpServerConfig, McpServerStatus, McpTool };

/** Auth check result returned from IPC */
export type McpAuthInfo = {
  requiresAuth: boolean;
  hasAuth: boolean;
  providerName?: string;
  providerDisplayName?: string;
  authHint?: string;
};

/** Per-workspace MCP disabled server names. */
export type WorkspaceMcpSettingsState = {
  /** Server names disabled for this workspace. Absence means enabled. */
  disabledServers: Record<string, true>;
};

/** Redux-serializable MCP settings state */
export type McpSettingsState = {
  /** Server configurations loaded from settings */
  servers: McpServerConfig[];
  /** Server status map (name -> status) */
  statusMap: Record<string, McpServerStatus>;
  /** Server error messages (name -> error message) */
  errorMessages: Record<string, string>;
  /** Server tools map (name -> tools[]) */
  toolsMap: Record<string, McpTool[]>;
  /** Per-server disabled state (name -> true). Uses Record instead of Set for serializability. */
  disabledServers: Record<string, true>;
  /** Whether servers are currently being loaded */
  loading: boolean;
  /** Global error message */
  error: string | null;
  /** Whether the MCP feature is enabled */
  enabled: boolean;
  /** Number of servers imported in the last JSON import (for UI feedback) */
  lastImportedCount: number | null;
  /** Per-workspace disabled server names. */
  byWorkspaceId: Record<string, WorkspaceMcpSettingsState>;
};


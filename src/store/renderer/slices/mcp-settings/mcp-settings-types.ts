/**
 * MCP Settings Types
 *
 * Types for the mcp-settings Redux slice.
 * Safe to import from any process (no renderer dependencies).
 */

import type { McpServerConfig, McpServerStatus, McpTool } from '$lib/components/settings/mcp/types';

// Re-export for convenience
export type { McpServerConfig, McpServerStatus, McpTool };

/** Daemon-reported runtime state (PROTOCOL §5.22 `McpServerStatus.state`). */
type McpDaemonServerState = 'stopped' | 'starting' | 'running' | 'error' | 'auth_required';

/** Daemon runtime status read via `mcp.servers.getStatus` (PROTOCOL §5.22). */
export type McpServerRuntimeStatus = {
  serverId: string;
  state: McpDaemonServerState;
  lastError?: string;
};

/** Per-workspace MCP disabled server keys. */
export type WorkspaceMcpSettingsState = {
  /** Server keys disabled for this workspace. Absence means enabled. */
  disabledServers: Record<string, true>;
};

/** The user action whose validation or save failed. */
export type McpMutationAction = 'add' | 'update' | 'remove' | 'toggle' | 'import';

export type McpMutationError = {
  action: McpMutationAction;
  message: string;
};

/** Redux-serializable MCP settings state */
export type McpSettingsState = {
  /** Server configurations loaded from settings */
  servers: McpServerConfig[];
  /** Server status map (key -> status) */
  statusMap: Record<string, McpServerStatus>;
  /** Server error messages (key -> error message) */
  errorMessages: Record<string, string>;
  /** Server tools map (key -> tools[]) */
  toolsMap: Record<string, McpTool[]>;
  /** Per-server disabled state (key -> true). Uses Record instead of Set for serializability. */
  disabledServers: Record<string, true>;
  /** Whether servers are currently being loaded */
  loading: boolean;
  /** Load error: set only when reading the server list fails (drives the load diagnostic). */
  error: string | null;
  /** Failure of the last add/update/remove/toggle/import, shown next to that action. */
  mutationError: McpMutationError | null;
  /** Whether the MCP feature is enabled */
  enabled: boolean;
  /** Number of servers imported in the last JSON import (for UI feedback) */
  lastImportedCount: number | null;
  /** Advanced JSON editor save state (replace-all via the daemon seam) */
  advancedSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  /** Advanced JSON editor save error (set when advancedSaveStatus === "error") */
  advancedSaveError: string | null;
  /** Per-workspace disabled server keys. */
  byWorkspaceId: Record<string, WorkspaceMcpSettingsState>;
};

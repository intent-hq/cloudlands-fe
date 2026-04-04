/**
 * MCP Servers — Type definitions
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

/**
 * MCP Server configuration type (renderer-side mirror of main process types)
 */
export type McpServerInfo = {
  name: string;
  type: 'http' | 'sse' | 'command';
  url?: string;
  command?: string;
  error?: string;
};

/**
 * Per-workspace MCP server enable state
 */
export type WorkspaceMcpState = {
  /** Map of server name -> enabled state (defaults to true) */
  enabledServers: Record<string, boolean>;
};

/**
 * Root MCP servers state
 */
export type McpServersState = {
  /** Servers loaded from ~/.augment/settings.json */
  servers: McpServerInfo[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Per-server startup error messages */
  serverErrors: Record<string, string>;
  /** Per-workspace enable state */
  byWorkspaceId: Record<string, WorkspaceMcpState>;
};


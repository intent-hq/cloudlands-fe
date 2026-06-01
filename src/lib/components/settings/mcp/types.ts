/**
 * MCP Settings Types
 *
 * Types for MCP server configuration and UI state
 */

/** Server transport type */
export type McpTransportType = 'stdio' | 'http' | 'sse';

/** Auth type for remote MCP servers */
export type McpAuthType = 'oauth' | 'header' | 'none';

/** Server connection status */
export type McpServerStatus = 'connected' | 'configured' | 'disconnected' | 'error' | 'auth_required' | 'disabled' | 'stopped';

/** Card mode for add/edit/view states */
export type McpCardMode = 'view' | 'edit' | 'add' | 'addRemote' | 'addJson';

/** Tool definition from an MCP server */
export interface McpTool {
  name: string;
  description?: string;
  enabled?: boolean;
}

/** Full MCP server configuration */
export interface McpServerConfig {
  name: string;
  type: McpTransportType;
  // For stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For http/sse
  url?: string;
  headers?: Record<string, string>;
  // Auth
  authType?: McpAuthType;
  // State
  disabled?: boolean;
}

/** Server with status and tools */
export interface McpServerWithStatus extends McpServerConfig {
  status: McpServerStatus;
  tools: McpTool[];
  toolCount: number;
  errorMessage?: string;
}

/** Key-value entry for env vars and headers */
export interface KeyValueEntry {
  id: string;
  key: string;
  value: string;
}

/** Form state for adding/editing servers */
export interface McpServerFormState {
  name: string;
  type: McpTransportType;
  command: string;
  args: string;
  url: string;
  authType: McpAuthType;
  envPairs: KeyValueEntry[];
  headerPairs: KeyValueEntry[];
}

/** Initial form state */
export function createEmptyFormState(): McpServerFormState {
  return {
    name: '',
    type: 'stdio',
    command: '',
    args: '',
    url: '',
    authType: 'none',
    envPairs: [],
    headerPairs: [],
  };
}

/** Convert server config to form state */
export function serverToFormState(server: McpServerConfig): McpServerFormState {
  const envPairs: KeyValueEntry[] = server.env
    ? Object.entries(server.env).map(([key, value]) => ({
        id: crypto.randomUUID(),
        key,
        value,
      }))
    : [];

  const headerPairs: KeyValueEntry[] = server.headers
    ? Object.entries(server.headers).map(([key, value]) => ({
        id: crypto.randomUUID(),
        key,
        value,
      }))
    : [];

  return {
    name: server.name,
    type: server.type,
    command: server.command || '',
    args: server.args?.join(' ') || '',
    url: server.url || '',
    authType: server.authType || 'none',
    envPairs,
    headerPairs,
  };
}

/** Convert form state to server config */
export function formStateToServer(form: McpServerFormState): McpServerConfig {
  const env: Record<string, string> = {};
  form.envPairs.forEach((p) => {
    if (p.key.trim()) {
      env[p.key.trim()] = p.value;
    }
  });

  const headers: Record<string, string> = {};
  form.headerPairs.forEach((p) => {
    if (p.key.trim()) {
      headers[p.key.trim()] = p.value;
    }
  });

  const config: McpServerConfig = {
    name: form.name.trim(),
    type: form.type,
  };

  if (form.type === 'stdio') {
    config.command = form.command.trim();
    if (form.args.trim()) {
      config.args = form.args.trim().split(/\s+/);
    }
    if (Object.keys(env).length > 0) {
      config.env = env;
    }
  } else {
    config.url = form.url.trim();
    if (Object.keys(headers).length > 0) {
      config.headers = headers;
    }
    if (form.authType !== 'none') {
      config.authType = form.authType;
    }
  }

  return config;
}

/** Convert server config to JSON string for clipboard */
export function serverToJson(server: McpServerConfig): string {
  const { name, ...config } = server;
  return JSON.stringify({ [name]: config }, null, 2);
}

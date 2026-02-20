/**
 * User MCP Settings Utility
 *
 * Reads and parses user-defined MCP servers from ~/.augment/settings.json
 * and provides utilities to merge them with built-in MCP servers.
 * Also manages per-workspace disabled MCP servers.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { injectMcpAuth } from './mcp-auth-providers';

const logger = new Logger('UserMcpSettings');

// File name for storing disabled MCP servers per workspace
const DISABLED_MCP_SERVERS_FILE = 'mcp-disabled-servers.json';

/** Auth type for remote MCP servers */
export type McpAuthType = 'oauth' | 'header' | 'none';

/**
 * MCP Server configuration types supported by Auggie CLI
 */
export interface McpServerHttpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  authType?: McpAuthType;
}

export interface McpServerSseConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
  authType?: McpAuthType;
}

export interface McpServerCommandConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServerConfig = McpServerHttpConfig | McpServerSseConfig | McpServerCommandConfig;

export interface UserMcpSettings {
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Get the path to the Auggie CLI settings.json file
 */
export function getAugmentSettingsPath(): string {
  return path.join(os.homedir(), '.augment', 'settings.json');
}

/**
 * Parse JSON with lenient handling for common issues like trailing commas.
 * This makes the parser more resilient to hand-edited JSON files.
 *
 * @param content - The JSON string to parse
 * @returns Parsed object
 * @throws Error if JSON is still invalid after cleanup
 */
function parseLenientJson<T>(content: string): T {
  // First try standard JSON parse
  try {
    return JSON.parse(content) as T;
  } catch {
    // If that fails, try to fix common issues
  }

  // Remove trailing commas before ] or }
  // This regex handles: ,] ,} with optional whitespace/newlines between
  const cleaned = content.replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(cleaned) as T;
}

/**
 * Read and parse user MCP servers from ~/.augment/settings.json
 *
 * @returns User-defined MCP servers or null if file doesn't exist/is invalid
 */
export function readUserMcpServers(): Record<string, McpServerConfig> | null {
  const settingsPath = getAugmentSettingsPath();

  try {
    if (!fs.existsSync(settingsPath)) {
      logger.debug('Augment settings file not found', { path: settingsPath });
      return null;
    }

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = parseLenientJson<UserMcpSettings>(content);

    if (!settings.mcpServers || typeof settings.mcpServers !== 'object') {
      logger.debug('No mcpServers found in Augment settings');
      return null;
    }

    logger.info('Loaded user MCP servers from settings', {
      serverCount: Object.keys(settings.mcpServers).length,
      serverNames: Object.keys(settings.mcpServers),
    });

    return settings.mcpServers;
  } catch (error) {
    logger.warn('Failed to read user MCP settings', {
      error: error instanceof Error ? error.message : String(error),
      path: settingsPath,
    });
    return null;
  }
}

/**
 * Write MCP servers to ~/.augment/settings.json
 * Preserves other settings in the file
 *
 * @param mcpServers - The MCP servers to write
 * @returns Success status and optional error message
 */
export function writeUserMcpServers(mcpServers: Record<string, McpServerConfig>): {
  success: boolean;
  error?: string;
} {
  const settingsPath = getAugmentSettingsPath();
  const settingsDir = path.dirname(settingsPath);

  try {
    // Ensure directory exists
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }

    // Read existing settings to preserve other fields
    let existingSettings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        existingSettings = parseLenientJson<Record<string, unknown>>(content);
      } catch {
        // If existing file is invalid, start fresh
        logger.warn('Existing settings file is invalid, will overwrite');
      }
    }

    // Merge with existing settings
    const newSettings = {
      ...existingSettings,
      mcpServers,
    };

    fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf-8');

    logger.info('Wrote user MCP servers to settings', {
      serverCount: Object.keys(mcpServers).length,
      path: settingsPath,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to write user MCP settings', {
      error: errorMessage,
      path: settingsPath,
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * Read the entire ~/.augment/settings.json file
 */
export function readAugmentSettingsFile(): { content: string | null; error?: string } {
  const settingsPath = getAugmentSettingsPath();

  try {
    if (!fs.existsSync(settingsPath)) {
      return { content: null };
    }
    const content = fs.readFileSync(settingsPath, 'utf-8');
    return { content };
  } catch (error) {
    return { content: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Write the entire ~/.augment/settings.json file
 */
export function writeAugmentSettingsFile(content: string): { success: boolean; error?: string } {
  const settingsPath = getAugmentSettingsPath();
  const settingsDir = path.dirname(settingsPath);

  try {
    // Validate JSON before writing
    JSON.parse(content);

    // Ensure directory exists
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }

    fs.writeFileSync(settingsPath, content, 'utf-8');
    logger.info('Wrote Augment settings file', { path: settingsPath });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to write Augment settings file', { error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Reserved MCP server names that cannot be overridden by user config
 */
const RESERVED_SERVER_NAMES = ['workspace-mcp'];

/**
 * Merge user MCP servers with built-in servers
 *
 * @param builtInServers - Built-in MCP servers (e.g., workspace-mcp)
 * @param userServers - User-defined MCP servers from settings.json
 * @returns Merged MCP servers with conflict warnings
 */
export function mergeUserMcpServers(
  builtInServers: Record<string, unknown>,
  userServers: Record<string, McpServerConfig> | null,
): { servers: Record<string, unknown>; conflicts: string[] } {
  if (!userServers) {
    return { servers: builtInServers, conflicts: [] };
  }

  const conflicts: string[] = [];
  const mergedServers = { ...builtInServers };

  for (const [name, config] of Object.entries(userServers)) {
    // Check for reserved server names
    if (RESERVED_SERVER_NAMES.includes(name)) {
      conflicts.push(`Cannot override reserved MCP server: ${name}`);
      logger.warn('User tried to override reserved MCP server', { serverName: name });
      continue;
    }

    // Check for conflicts with existing servers
    if (name in mergedServers) {
      conflicts.push(`MCP server "${name}" already exists, skipping user config`);
      logger.warn('Skipping conflicting user MCP server', { serverName: name });
      continue;
    }

    // Add user server
    mergedServers[name] = config;
    logger.debug('Added user MCP server', { serverName: name });
  }

  if (Object.keys(userServers).length > 0) {
    logger.info('Merged user MCP servers', {
      userServerCount: Object.keys(userServers).length,
      totalServerCount: Object.keys(mergedServers).length,
      conflictCount: conflicts.length,
    });
  }

  return { servers: mergedServers, conflicts };
}

/**
 * Merge user MCP servers with built-in servers (async version with auth injection)
 *
 * This version injects authentication for known services like Sentry
 * based on credentials stored in our app's auth stores.
 *
 * @param builtInServers - Built-in MCP servers (e.g., workspace-mcp)
 * @param userServers - User-defined MCP servers from settings.json
 * @returns Merged MCP servers with conflict warnings
 */
export async function mergeUserMcpServersWithAuth(
  builtInServers: Record<string, unknown>,
  userServers: Record<string, McpServerConfig> | null,
): Promise<{ servers: Record<string, unknown>; conflicts: string[] }> {
  if (!userServers) {
    return { servers: builtInServers, conflicts: [] };
  }

  const conflicts: string[] = [];
  const mergedServers = { ...builtInServers };

  for (const [name, config] of Object.entries(userServers)) {
    // Check for reserved server names
    if (RESERVED_SERVER_NAMES.includes(name)) {
      conflicts.push(`Cannot override reserved MCP server: ${name}`);
      logger.warn('User tried to override reserved MCP server', { serverName: name });
      continue;
    }

    // Check for conflicts with existing servers
    if (name in mergedServers) {
      conflicts.push(`MCP server "${name}" already exists, skipping user config`);
      logger.warn('Skipping conflicting user MCP server', { serverName: name });
      continue;
    }

    // Inject authentication for known services (uses the generic auth provider system)
    const configWithAuth = await injectMcpAuth(config, name);

    // Add user server
    mergedServers[name] = configWithAuth;
    logger.debug('Added user MCP server', { serverName: name });
  }

  if (Object.keys(userServers).length > 0) {
    logger.info('Merged user MCP servers with auth injection', {
      userServerCount: Object.keys(userServers).length,
      totalServerCount: Object.keys(mergedServers).length,
      conflictCount: conflicts.length,
    });
  }

  return { servers: mergedServers, conflicts };
}

/**
 * Validate MCP server configuration
 */
export function validateMcpServerConfig(config: unknown): { valid: boolean; error?: string } {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Configuration must be an object' };
  }

  const cfg = config as Record<string, unknown>;

  // Check for HTTP/SSE type servers
  if ('type' in cfg) {
    if (cfg.type !== 'http' && cfg.type !== 'sse') {
      return { valid: false, error: `Invalid type: ${cfg.type}. Must be 'http' or 'sse'` };
    }
    if (!cfg.url || typeof cfg.url !== 'string') {
      return { valid: false, error: 'HTTP/SSE servers require a url string' };
    }
    if (cfg.headers && typeof cfg.headers !== 'object') {
      return { valid: false, error: 'headers must be an object' };
    }
    return { valid: true };
  }

  // Check for command-based servers
  if ('command' in cfg) {
    if (typeof cfg.command !== 'string' || !cfg.command) {
      return { valid: false, error: 'command must be a non-empty string' };
    }
    if (cfg.args && !Array.isArray(cfg.args)) {
      return { valid: false, error: 'args must be an array' };
    }
    if (cfg.env && typeof cfg.env !== 'object') {
      return { valid: false, error: 'env must be an object' };
    }
    return { valid: true };
  }

  return { valid: false, error: 'Server must have either type (http/sse) or command' };
}

/**
 * Get the path to the disabled MCP servers file for a workspace
 */
async function getWorkspaceDisabledMcpServersPath(workspaceId: string): Promise<string> {
  // Dynamic import to avoid circular dependency issues
  const { WorkspaceConfig } = await import('../../../shared/main/config');
  return path.join(WorkspaceConfig.paths.metadata(workspaceId), DISABLED_MCP_SERVERS_FILE);
}

/**
 * Get the list of disabled MCP servers for a workspace
 *
 * @param workspaceId - The workspace ID
 * @returns Array of disabled server names, empty array if none
 */
export async function getWorkspaceDisabledMcpServers(workspaceId: string): Promise<string[]> {
  const filePath = await getWorkspaceDisabledMcpServersPath(workspaceId);

  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (Array.isArray(data.disabledServers)) {
      return data.disabledServers;
    }

    return [];
  } catch (error) {
    logger.warn('Failed to read workspace disabled MCP servers', {
      error: error instanceof Error ? error.message : String(error),
      workspaceId,
      path: filePath,
    });
    return [];
  }
}

/**
 * Set the list of disabled MCP servers for a workspace
 *
 * @param workspaceId - The workspace ID
 * @param disabledServers - Array of server names to disable
 */
export async function setWorkspaceDisabledMcpServers(
  workspaceId: string,
  disabledServers: string[],
): Promise<void> {
  const filePath = await getWorkspaceDisabledMcpServersPath(workspaceId);
  const dirPath = path.dirname(filePath);

  try {
    // Ensure metadata directory exists
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const data = { disabledServers };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

    logger.info('Saved workspace disabled MCP servers', {
      workspaceId,
      disabledCount: disabledServers.length,
      disabledServers,
    });
  } catch (error) {
    logger.error('Failed to save workspace disabled MCP servers', {
      error: error instanceof Error ? error.message : String(error),
      workspaceId,
      path: filePath,
    });
  }
}


/**
 * Patch authType onto an existing MCP server entry in ~/.augment/settings.json.
 *
 * The Auggie CLI `mcp add` command doesn't support authType, so we write it
 * directly after the CLI has created the base server config.
 *
 * @param serverName - The name of the server to patch
 * @param authType - The auth type to set ('oauth' | 'header' | 'none')
 */
export function patchServerAuthType(serverName: string, authType: McpAuthType): void {
  const settingsPath = getAugmentSettingsPath();

  try {
    if (!fs.existsSync(settingsPath)) {
      logger.warn('Cannot patch authType: settings file does not exist', { serverName });
      return;
    }

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = parseLenientJson<Record<string, unknown>>(content);

    const mcpServers = settings.mcpServers as Record<string, Record<string, unknown>> | undefined;
    if (!mcpServers || !mcpServers[serverName]) {
      logger.warn('Cannot patch authType: server not found in settings', { serverName });
      return;
    }

    // Set or remove authType
    if (authType === 'none') {
      delete mcpServers[serverName].authType;
    } else {
      mcpServers[serverName].authType = authType;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    logger.info('Patched authType on MCP server', { serverName, authType });
  } catch (error) {
    logger.error('Failed to patch authType on MCP server', {
      serverName,
      authType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

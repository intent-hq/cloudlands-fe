/**
 * Shared constants for MCP server name validation and reserved names.
 *
 * These are used by:
 * - McpServerForm.svelte (UI form validation)
 * - mcp-settings-saga.ts (saga-level safety-net validation)
 * - user-mcp-settings.ts (server merge conflict detection)
 */

/** Reserved MCP server names that cannot be used by users */
export const RESERVED_MCP_SERVER_NAMES = ['workspace-mcp'] as const;

/** Regex for valid MCP server names (letters, numbers, dots, hyphens, underscores) */
export const MCP_SERVER_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

/** Maximum length for MCP server names */
export const MCP_SERVER_NAME_MAX_LENGTH = 64;


/**
 * MCP OAuth Flow
 *
 * Handles OAuth authentication for MCP servers by:
 * 1. Discovering OAuth metadata from the server
 * 2. Starting a local callback server
 * 3. Opening the browser for authentication
 * 4. Handling the callback and storing tokens
 */

import { Logger } from '$shared/logger';

const logger = new Logger('McpOAuth');

// Store OAuth tokens per MCP server (in-memory cache). Raw bags are held in
// memory only for the current process lifetime so `getMcpAuthHeaderAsync`
// can build Authorization headers; persistence is delegated to the daemon
// (PROTOCOL.md §5.22, `mcp.oauth.*`). Per §5.22.1 the daemon never echoes the
// raw bag back over the wire, so a restart drops the cache and the user must
// re-run the OAuth flow — matching the P3 canonical-persistence posture where
// electron-store is retired.
const tokenStore = new Map<string, OAuthTokens>();

/**
 * Drop a persisted bag on the daemon via `mcp.oauth.delete`. Idempotent on
 * the daemon side, so unknown servers succeed silently.
 */
async function deleteTokensOnDaemon(mcpName: string): Promise<void> {
  try {
    const { getBackendClient } = await import('../../backend/main/backend.ipc');
    await getBackendClient().request('mcp.oauth.delete', { serverId: mcpName });
  } catch (error) {
    logger.error('Failed to delete OAuth tokens on daemon:', error);
  }
}

/**
 * Clear OAuth tokens for an MCP server (in-memory cache + daemon store).
 * Used when the user disconnects an integration.
 */
export async function clearMcpOAuthTokens(mcpName: string): Promise<void> {
  logger.info('Clearing OAuth tokens for:', mcpName);
  tokenStore.delete(mcpName);
  await deleteTokensOnDaemon(mcpName);
}

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
}

/**
 * Get stored OAuth tokens for an MCP server. The daemon persists bags via
 * `mcp.oauth.*` but never echoes raw contents back (PROTOCOL.md §5.22.1), so
 * this only inspects the in-process memory cache populated by
 * `initiateMcpOAuth`. After a main-process restart callers must re-run the
 * OAuth flow. Kept `async` for call-site compat.
 */
export async function getMcpOAuthTokensAsync(mcpName: string): Promise<OAuthTokens | null> {
  return tokenStore.get(mcpName) ?? null;
}

/**
 * Get authorization header for an MCP server (async version that checks persistent storage)
 */
export async function getMcpAuthHeaderAsync(mcpName: string): Promise<string | null> {
  logger.info('getMcpAuthHeaderAsync called for:', mcpName);
  const tokens = await getMcpOAuthTokensAsync(mcpName);
  logger.info('getMcpAuthHeaderAsync tokens result:', {
    mcpName,
    hasTokens: !!tokens,
    tokenType: tokens?.token_type,
  });
  if (!tokens) return null;

  // Capitalize token type for Authorization header (OAuth servers may return "bearer" lowercase)
  const tokenType = tokens.token_type.toLowerCase() === 'bearer' ? 'Bearer' : tokens.token_type;
  const header = `${tokenType} ${tokens.access_token}`;
  logger.info('getMcpAuthHeaderAsync returning header:', {
    mcpName,
    headerPrefix: header.substring(0, 20),
  });
  return header;
}

/**
 * MCP Connection Test
 *
 * Tests connection to HTTP/SSE MCP servers to detect auth requirements.
 * Delegated to the daemon via `mcp.testConnection` (PROTOCOL §5.22.2, v7.3):
 * the probe runs from the daemon host so the FE never contacts MCP server
 * URLs directly. The daemon injects the stored `mcp.oauth.*` bag for
 * `serverName` when no explicit Authorization header is supplied.
 * Returns status: 'connected' | 'auth_required' | 'error'
 */

import { Logger } from '$shared/logger';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger('McpConnectionTest');

export interface McpConnectionTestResult {
  status: 'connected' | 'auth_required' | 'error';
  statusCode?: number;
  errorMessage?: string;
}

/**
 * Test connection to an HTTP/SSE MCP server via the daemon.
 *
 * @param url - The MCP server URL
 * @param headers - Optional headers to include in the request
 * @param serverName - Optional server name for the daemon's OAuth token lookup
 * @returns Connection test result with status
 */
export async function testMcpConnection(
  url: string,
  headers?: Record<string, string>,
  serverName?: string,
): Promise<McpConnectionTestResult> {
  logger.info('Testing MCP connection via daemon:', { url, serverName, hasHeaders: !!headers });

  try {
    const result = await getBackendClient().request<McpConnectionTestResult>('mcp.testConnection', {
      url,
      ...(headers ? { headers } : {}),
      ...(serverName ? { serverName } : {}),
    });
    logger.debug('MCP connection test result:', { url, status: result.status });
    return result;
  } catch (error) {
    // RPC-level failure (daemon unreachable, -32602, timeout) — probe outcomes
    // themselves are always success responses per PROTOCOL §5.22.2.
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('MCP connection test RPC failed:', { url, error: errorMessage });
    return {
      status: 'error',
      errorMessage,
    };
  }
}

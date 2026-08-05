/**
 * MCP Connection Test
 *
 * Tests connection to HTTP/SSE MCP servers to detect auth requirements.
 * Returns status: 'connected' | 'auth_required' | 'error'
 */

import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { getMcpAuthHeaderAsync } from './mcp-oauth';

const logger = new Logger('McpConnectionTest');

export interface McpConnectionTestResult {
  status: 'connected' | 'auth_required' | 'error';
  statusCode?: number;
  errorMessage?: string;
}

/**
 * Test connection to an HTTP/SSE MCP server.
 * Makes a simple request to detect if authentication is required.
 *
 * @param url - The MCP server URL
 * @param headers - Optional headers to include in the request
 * @param serverName - Optional server name for OAuth token lookup
 * @returns Connection test result with status
 */
export async function testMcpConnection(
  url: string,
  headers?: Record<string, string>,
  serverName?: string,
): Promise<McpConnectionTestResult> {
  logger.info('Testing MCP connection:', { url, serverName, hasHeaders: !!headers });

  try {
    // Build headers, including OAuth tokens if available
    const requestHeaders: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      ...headers,
    };

    // If we have OAuth tokens for this server, include them
    if (serverName && !requestHeaders.Authorization) {
      logger.info('Looking up OAuth token for server:', serverName);
      const oauthHeader = await getMcpAuthHeaderAsync(serverName);
      logger.info('OAuth token lookup result:', { serverName, hasToken: !!oauthHeader });
      if (oauthHeader) {
        logger.info('Including OAuth token in connection test', { serverName });
        requestHeaders.Authorization = oauthHeader;
      }
    } else {
      logger.info('Skipping OAuth lookup:', {
        serverName,
        hasExistingAuth: !!requestHeaders.Authorization,
      });
    }

    // Make a POST request to the server with a JSON-RPC initialize request
    // MCP uses JSON-RPC over HTTP, so we need to POST to properly test auth
    // Some servers (like Figma) allow GET but require auth for POST
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    // Send a minimal JSON-RPC request - servers will return auth error before processing
    const jsonRpcBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'connection-test', version: '1.0.0' },
      },
    });

    requestHeaders['Content-Type'] = 'application/json';

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: jsonRpcBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    logger.debug('MCP connection test response:', {
      url,
      status: response.status,
      statusText: response.statusText,
    });

    // Check for authentication errors
    if (response.status === 401 || response.status === 403) {
      return {
        status: 'auth_required',
        statusCode: response.status,
        errorMessage: m.mcp_connectionTest_authRequired_error({ status: response.status }),
      };
    }

    // Any 2xx or even some 4xx (like 404, 405) means the server is reachable
    // 404/405 might just mean the endpoint doesn't support GET, but server is up
    if (response.status >= 200 && response.status < 500) {
      return {
        status: 'connected',
        statusCode: response.status,
      };
    }

    // 5xx errors indicate server issues
    return {
      status: 'error',
      statusCode: response.status,
      errorMessage: m.mcp_connectionTest_serverError_error({ status: response.status }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('MCP connection test failed:', { url, error: errorMessage });

    // Check if it's an abort error (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        status: 'error',
        errorMessage: m.mcp_connectionTest_timeout_error(),
      };
    }

    return {
      status: 'error',
      errorMessage,
    };
  }
}

/**
 * CDP MCP Server Factory
 *
 * Creates and configures the CDP MCP Server with all CDP debugging tools.
 * Establishes CDP connection immediately on creation.
 */

import { MCPServer } from '../mcp/main/mcp/server';
import { CdpConnectionManager } from './cdp-connection';
import { HelloCdpTool } from './tools/hello-cdp-tool';
import { RunScriptTool } from './tools/run-script-tool';
import { GetDomTool } from './tools/get-dom-tool';
import { GetConsoleLogsTool } from './tools/get-console-logs-tool';

/**
 * Create and configure the CDP MCP Server
 *
 * @param port - CDP port to connect to (default: 9223)
 * @returns Configured MCPServer with CDP connection established
 * @throws Error if CDP connection fails
 */
export async function createCdpMCPServer(port: number = 9223): Promise<MCPServer> {
  const server = new MCPServer({
    name: 'CDP Debug MCP Server',
    version: '1.0.0',
  });

  // Create connection manager and connect immediately
  const connectionManager = new CdpConnectionManager(port);
  await connectionManager.connect();

  // Register CDP tools
  server.registerTool(new HelloCdpTool(connectionManager));
  server.registerTool(new RunScriptTool(connectionManager));
  server.registerTool(new GetDomTool(connectionManager));
  server.registerTool(new GetConsoleLogsTool(connectionManager));

  return server;
}

export { CdpConnectionManager };

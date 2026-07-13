/**
 * MCP (Model Context Protocol) Module
 *
 * Provides the workspace MCP server and tool exports.
 */

export * from './protocol';
export { BaseMCPTool as Tool } from './tool';
export type { IMCPTool } from './tool';
export * from './server';
export * from './workspace-file-tools';
export * from './tool-call-extractor';
export * from './agent-tool-executor';

import { MCPServer } from './server';
import { WorkspaceJsApiTool } from './workspace-js-api-tool';

/**
 * Create a workspace MCP server with the consolidated JavaScript workspace API.
 */
export async function createWorkspaceMCPServer(
  workspacePath: string,
  workspaceId: string,
  workspaceManager?: any,
  _timelineManager?: any,
  _workspaceMetadataPath?: string,
  eventEmitter?: any,
): Promise<MCPServer> {
  const server = new MCPServer({
    name: 'Workspace MCP Server',
    version: '1.0.0',
  });

  server.registerTool(
    new WorkspaceJsApiTool(workspacePath, workspaceId, workspaceManager, eventEmitter),
  );

  return server;
}
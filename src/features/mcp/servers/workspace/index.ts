/**
 * Workspace MCP Server
 *
 * Handles workspace-related MCP tools.
 */

import { BaseMcpServer } from '../base-server';
import {
  McpBridge,
  type BridgeCallContext,
} from '../../main/bridge/mcp-bridge';
import {
  WorkspaceGetSchema,
  WorkspaceUpdateSchema,
  WorkspaceListSessionsSchema,
  WorkspaceCreateSessionSchema,
} from '../../types/schemas';

export class WorkspaceMcpServer extends BaseMcpServer {
  private bridge: McpBridge;

  constructor() {
    super();
    this.bridge = new McpBridge();
  }

  protected async initialize(): Promise<void> {
    // Register workspace tools
    this.registerTool({
      name: 'workspace.get',
      description: 'Get workspace information',
      inputSchema: WorkspaceGetSchema,
    });

    this.registerTool({
      name: 'workspace.update',
      description: 'Update workspace metadata',
      inputSchema: WorkspaceUpdateSchema,
    });

    this.registerTool({
      name: 'workspace.listSessions',
      description: 'List agent sessions for a workspace',
      inputSchema: WorkspaceListSessionsSchema,
    });

    this.registerTool({
      name: 'workspace.createSession',
      description: 'Create a new agent session',
      inputSchema: WorkspaceCreateSessionSchema,
    });

    this.log('info', 'Workspace server initialized');
  }

  protected async handleToolCall(toolName: string, params: any): Promise<any> {
    const context: BridgeCallContext = {
      workspaceId: params.workspaceId || this.config.workspaceId || '',
      actor: {
        type: 'agent',
        id: 'workspace-server',
        name: 'Workspace Server',
      },
      requestId: params.requestId,
    };

    try {
      this.log('info', `Calling tool: ${toolName}`, params);

      const response = await this.bridge.invoke(toolName as any, params, context);

      if (!response.success) {
        throw new Error(response.error?.message || 'Unknown error');
      }

      // Forward any events from the bridge
      this.bridge.on('event', (event: any) => {
        this.emitEvent(event);
      });

      return response.data;
    } catch (error) {
      this.log('error', `Tool call failed: ${toolName}`, error);
      throw error;
    }
  }
}

// Start the server if run directly
if (require.main === module) {
  new WorkspaceMcpServer();
}

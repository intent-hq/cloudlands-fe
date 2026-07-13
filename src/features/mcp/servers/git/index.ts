/**
 * Git/FS MCP Server
 *
 * Handles git and file system MCP tools.
 */

import { BaseMcpServer } from '../base-server';
import {
  McpBridge,
  type BridgeCallContext,
} from '../../main/bridge/mcp-bridge';
import {
  GitStatusSchema,
  GitDiffSchema,
  GitCommitSchema,
  GitBranchSchema,
  FsReadSchema,
  FsWriteSchema,
  FsApplyPatchSchema,
} from '../../types/schemas';

export class GitMcpServer extends BaseMcpServer {
  private bridge: McpBridge;

  constructor() {
    super();
    this.bridge = new McpBridge();
  }

  protected async initialize(): Promise<void> {
    // Register git tools
    this.registerTool({
      name: 'git.status',
      description: 'Get git status for the workspace',
      inputSchema: GitStatusSchema,
    });

    this.registerTool({
      name: 'git.diff',
      description: 'Get git diff',
      inputSchema: GitDiffSchema,
    });

    this.registerTool({
      name: 'git.commit',
      description: 'Create a git commit',
      inputSchema: GitCommitSchema,
    });

    this.registerTool({
      name: 'git.branch',
      description: 'Manage git branches',
      inputSchema: GitBranchSchema,
    });

    // Register file system tools
    this.registerTool({
      name: 'fs.read',
      description: 'Read a file',
      inputSchema: FsReadSchema,
    });

    this.registerTool({
      name: 'fs.write',
      description: 'Write a file',
      inputSchema: FsWriteSchema,
    });

    this.registerTool({
      name: 'fs.applyPatch',
      description: 'Apply a patch to files',
      inputSchema: FsApplyPatchSchema,
    });

    this.log('info', 'Git/FS server initialized');
  }

  protected async handleToolCall(toolName: string, params: any): Promise<any> {
    const context: BridgeCallContext = {
      workspaceId: params.workspaceId || this.config.workspaceId || '',
      actor: {
        type: 'agent',
        id: 'git-server',
        name: 'Git Server',
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
  new GitMcpServer();
}

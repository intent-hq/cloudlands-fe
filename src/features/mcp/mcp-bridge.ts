import type { WorkspaceId } from '$shared/types/branded-ids';
/**
 * MCP Bridge
 *
 * Bridges MCP protocol to the tool service layer.
 * Provides backward compatibility for existing MCP tools.
 */

import type { ToolCall, ToolResult } from './main/mcp/protocol';
import { ToolService } from '../tools/main/tool.service';
import { executorManager } from '../tools/main/executor-manager';
import type { UserContext, ToolPermissions } from '../tools/types';
import type { ToolContext } from '../tools/main/types';
import { WorkspaceService } from '../workspace/main/workspace.service';
import { Logger } from '../../shared/logger';

const logger = new Logger('MCPBridge');

/**
 * MCP Bridge
 *
 * Adapts MCP tool calls to the tool service.
 */
export class MCPBridge {
  private toolService: ToolService;
  private workspaceService: WorkspaceService;

  constructor(toolService?: ToolService, workspaceService?: WorkspaceService) {
    this.toolService = toolService || new ToolService();
    this.workspaceService = workspaceService || new WorkspaceService();
  }

  /**
   * Execute MCP tool call through tool service
   */
  async executeToolCall(
    call: ToolCall,
    workspaceId: string,
    workspacePath: string,
    environmentConfig?: any,
  ): Promise<ToolResult> {
    logger.debug('Executing MCP tool call', {
      tool: call.name,
      workspaceId,
    });

    try {
      // Map MCP tool names to service tool names
      const toolName = this.mapMCPToolName(call.name);

      // Get workspace
      const workspaceResult = await this.workspaceService.getWorkspace(workspaceId as WorkspaceId);
      if (!workspaceResult.ok) {
        throw new Error(workspaceResult.error);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const workspace = workspaceResult.data;

      // Create/reuse executor via ExecutionManager (caching + retries)
      const remote =
        environmentConfig?.type === 'remote'
          ? {
              host: environmentConfig.host,
              port: environmentConfig.port || 22,
              username: environmentConfig.username,
              privateKey: environmentConfig.privateKey,
              password: environmentConfig.password,
              workspacePath,
            }
          : null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const executor = executorManager.getExecutor({ workspaceId, workspacePath, remote });

      // Map MCP arguments to tool arguments
      const args = this.mapMCPArguments(call.name, call.arguments);

      // Build context
      const context: ToolContext = {
        workspaceId,
        input: args, // Required by main process ToolContext
      };

      // Execute through tool service
      const result = await this.toolService.executeTool(toolName, args, context);

      // Convert to MCP result format
      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text:
                typeof result.data === 'string'
                  ? result.data
                  : JSON.stringify(result.data, null, 2),
            },
          ],
        };
      } else {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error: ${result.error || 'Unknown error'}`,
            },
          ],
        };
      }
    } catch (error) {
      logger.error('MCP tool execution failed', error as Error, { tool: call.name });

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error: ${(error as Error).message}`,
          },
        ],
      };
    }
  }

  /**
   * Map MCP tool name to service tool name
   */
  private mapMCPToolName(mcpName: string): string {
    // Most names map directly, but handle special cases
    const mappings: Record<string, string> = {
      read_file: 'readFile',
      write_file: 'writeFile',
      delete_file: 'deleteFile',
      list_files: 'listFiles',
      create_note: 'createNote',
      update_note: 'updateNote', // Legacy alias
      set_note_content: 'updateNote', // New name for update_note
      add_to_note: 'appendToNote', // New name for append_to_note
      append_to_note: 'appendToNote', // Legacy alias
      edit_note: 'editNote',
      edit_note_lines: 'editNoteLines',
      update_note_metadata: 'updateNoteMetadata',
      delete_note: 'deleteNote',
      list_notes: 'listNotes',
      read_note: 'readNote',
      get_workspace_info: 'getWorkspaceInfo',
      execute_command: 'executeCommand',
    };

    return mappings[mcpName] || mcpName;
  }

  /**
   * Map MCP arguments to service arguments
   */
  private mapMCPArguments(toolName: string, mcpArgs: any): any {
    // Handle special argument mappings
    switch (toolName) {
      case 'read_file':
      case 'write_file':
      case 'delete_file':
        return {
          path: mcpArgs.path || mcpArgs.file_path,
          content: mcpArgs.content,
        };

      case 'list_files':
        return {
          directory: mcpArgs.directory || mcpArgs.path || '.',
        };

      case 'create_note':
        return {
          title: mcpArgs.title,
          content: mcpArgs.content,
          tags: mcpArgs.tags || [],
          metadata: mcpArgs.metadata || {},
        };

      case 'update_note':
      case 'set_note_content':
        return {
          noteId: mcpArgs.note_id || mcpArgs.noteId,
          title: mcpArgs.title,
          content: mcpArgs.content,
          tags: mcpArgs.tags,
          metadata: mcpArgs.metadata,
          confirm_replacement: mcpArgs.confirm_replacement,
        };

      case 'add_to_note':
      case 'append_to_note':
        return {
          noteId: mcpArgs.note_id || mcpArgs.noteId,
          content: mcpArgs.content,
          heading: mcpArgs.heading,
          position: mcpArgs.position,
        };

      case 'edit_note':
        return {
          noteId: mcpArgs.note_id || mcpArgs.noteId,
          old_text: mcpArgs.old_text,
          new_text: mcpArgs.new_text,
        };

      case 'edit_note_lines':
        return {
          noteId: mcpArgs.note_id || mcpArgs.noteId,
          start_line: mcpArgs.start_line,
          end_line: mcpArgs.end_line,
          new_content: mcpArgs.new_content,
        };

      case 'update_note_metadata':
        return {
          noteId: mcpArgs.note_id || mcpArgs.noteId,
          title: mcpArgs.title,
          tags: mcpArgs.tags,
        };

      case 'delete_note':
      case 'read_note':
        return {
          noteId: mcpArgs.note_id || mcpArgs.noteId,
        };

      case 'execute_command':
        return {
          command: mcpArgs.command,
          options: {
            cwd: mcpArgs.cwd,
            env: mcpArgs.env,
            timeout: mcpArgs.timeout,
          },
        };

      default:
        return mcpArgs;
    }
  }

  /**
   * Get MCP user context
   */
  private getMCPUser(): UserContext {
    return {
      id: 'mcp',
      name: 'MCP Client',
      tier: 'pro',
    };
  }

  /**
   * Get MCP permissions
   */
  private getMCPPermissions(): ToolPermissions {
    return {
      allowedTools: [], // All tools allowed
      deniedTools: [],
      requireConfirmation: [],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      allowedPaths: [],
      deniedPaths: ['.git/objects', '.git/hooks', 'node_modules', '.env', '.ssh'],
      readOnly: false,
    };
  }

  /**
   * List available MCP tools
   */
  async listMCPTools(): Promise<any[]> {
    const tools = await this.toolService.listTools();

    // Convert to MCP format
    return tools.map((tool) => ({
      name: this.reverseMapToolName(tool.name),
      description: tool.description,
      inputSchema: tool.inputSchema || { type: 'object', properties: {}, required: [] },
    }));
  }

  /**
   * Reverse map service tool name to MCP name
   */
  private reverseMapToolName(serviceName: string): string {
    const mappings: Record<string, string> = {
      readFile: 'read_file',
      writeFile: 'write_file',
      deleteFile: 'delete_file',
      listFiles: 'list_files',
      createNote: 'create_note',
      updateNote: 'update_note',
      deleteNote: 'delete_note',
      listNotes: 'list_notes',
      readNote: 'read_note',
      getWorkspaceInfo: 'get_workspace_info',
      executeCommand: 'execute_command',
    };

    return mappings[serviceName] || serviceName;
  }
}

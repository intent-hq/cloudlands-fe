/**
 * Notes MCP Server
 *
 * Handles notes-related MCP tools.
 */

import { BaseMcpServer } from '../base-server';
import {
  McpBridge,
  type BridgeCallContext,
} from '../../main/bridge/mcp-bridge';
import {
  NotesListSchema,
  NotesGetSchema,
  NotesCreateSchema,
  NotesUpdateSchema,
  NotesAddCommentSchema,
  NotesListCommentsSchema,
  NotesDeleteSchema,
  NotesSuggestChangeSchema,
  NotesUpdateCommentStatusSchema,
} from '../../types/schemas';

export class NotesMcpServer extends BaseMcpServer {
  private bridge: McpBridge;

  constructor() {
    super();
    this.bridge = new McpBridge();

    // Forward note-comments-updated events from bridge to hub
    this.bridge.on('note-comments-updated', (data: any) => {
      this.log('info', 'Received note-comments-updated event from bridge', {
        workspaceId: data.workspaceId,
        noteId: data.noteId,
        action: data.action,
      });
      // Emit a custom event that the hub can handle
      const event = {
        type: 'note-comments-updated',
        data,
      };
      this.emitEvent(event);
      this.log('info', 'Event emitted to hub');
    });

    // Forward any other events from the bridge
    this.bridge.on('event', (event: any) => {
      this.emitEvent(event);
    });
  }

  protected async initialize(): Promise<void> {
    // Register notes tools
    this.registerTool({
      name: 'notes.list',
      description: 'List all notes in a workspace',
      inputSchema: NotesListSchema,
    });

    this.registerTool({
      name: 'notes.get',
      description: 'Get a specific note by ID',
      inputSchema: NotesGetSchema,
    });

    this.registerTool({
      name: 'notes.create',
      description: 'Create a new note',
      inputSchema: NotesCreateSchema,
    });

    this.registerTool({
      name: 'notes.update',
      description: 'Update an existing note',
      inputSchema: NotesUpdateSchema,
    });

    this.registerTool({
      name: 'notes.addComment',
      description: 'Add a comment to a note',
      inputSchema: NotesAddCommentSchema,
    });

    this.registerTool({
      name: 'notes.listComments',
      description: 'List comments for a note',
      inputSchema: NotesListCommentsSchema,
    });

    this.registerTool({
      name: 'notes.delete',
      description: 'Delete a note',
      inputSchema: NotesDeleteSchema,
    });

    this.registerTool({
      name: 'notes.suggestChange',
      description: 'Suggest a change to a note',
      inputSchema: NotesSuggestChangeSchema,
    });

    this.registerTool({
      name: 'notes.updateCommentStatus',
      description: 'Update the status of a comment on a note',
      inputSchema: NotesUpdateCommentStatusSchema,
    });

    this.log('info', 'Notes server initialized');
  }

  protected async handleToolCall(toolName: string, params: any): Promise<any> {
    const context: BridgeCallContext = {
      workspaceId: params.workspaceId || this.config.workspaceId || '',
      actor: {
        type: 'agent',
        id: 'notes-server',
        name: 'Notes Server',
      },
      requestId: params.requestId,
    };

    try {
      this.log('info', `Calling tool: ${toolName}`, params);

      const response = await this.bridge.invoke(toolName as any, params, context);

      if (!response.success) {
        throw new Error(response.error?.message || 'Unknown error');
      }

      return response.data;
    } catch (error) {
      this.log('error', `Tool call failed: ${toolName}`, error);
      throw error;
    }
  }
}

// Start the server if run directly
if (require.main === module) {
  new NotesMcpServer();
}

import { v4 as uuidv4 } from 'uuid';
import {
  NoteId as createNoteId,
  WorkspaceId as createWorkspaceId,
  AgentId as createAgentId,
} from '$shared/types/branded-ids';
import type { WorkspaceId } from '$shared/types/branded-ids';
/**
 * Protocol Adapter
 *
 * Unified entry point for all protocols (IPC, STDIO MCP, Hub MCP).
 * Routes requests to appropriate services and handles responses.
 *
 * This ensures all protocols use the same business logic and emit the same events.
 */

import { WorkspaceService } from '../../workspace/main/workspace.service';
import { NotesService } from '../../notes/main/notes.service';
import { ToolService } from '../../tools/main/tool.service';
import { ACPServer } from '../../acp-official/main/server/acp-server';
import type { ACPServerConfig } from '../../acp-official/main/server/acp-server';
import { Logger } from '$shared/logger';
import type { Result, PullRequestInfo } from '$shared/types';
import type { UserContext, ToolPermissions } from '../../tools/types';
import type { ToolContext } from '../../tools/main/types';
import { executorManager } from '../../tools/main/executor-manager';

const logger = new Logger('ProtocolAdapter');

/**
 * Protocol Adapter
 *
 * Provides a unified interface for all protocols to interact with services.
 */
export class ProtocolAdapter {
  private readonly toolService: ToolService;
  private acpServer?: ACPServer;

  constructor(
    private readonly workspaceService: WorkspaceService = new WorkspaceService(),
    private readonly notesService: NotesService = new NotesService(),
    toolService?: ToolService,
  ) {
    this.toolService = toolService || new ToolService(workspaceService, notesService);
  }

  /**
   * Initialize ACP server for a workspace
   */
  private initializeACPServer(
    workspaceId: string,
    workspacePath: string,
    scope?: string,
  ): ACPServer {
    if (!this.acpServer) {
      const config: ACPServerConfig = {
        clientInfo: {
          name: 'Intent',
          version: '1.0.0',
        },
        workspacePath,
        workspaceId,
        scope,
        capabilities: {
          fileSystem: true,
          terminal: true,
          permissions: true,
        },
      };
      this.acpServer = new ACPServer(config);
    }
    return this.acpServer;
  }

  // ============================================================================
  // Workspace Methods
  // ============================================================================

  async createWorkspace(params: {
    title?: string;
    statusMessage?: string;
    repositoryPath?: string;
    branch?: string;
    baseRef?: string;
    setupScript?: string;
    environmentConfig?: {
      type: 'local' | 'remote';
      ssh?: {
        host: string;
        port?: number;
        user: string;
        password?: string;
        key_path?: string;
        use_agent?: boolean;
        transport?: 'ssh' | 'websocket';
        ws_url?: string;
      };
      workspace_path?: string;
    };
    skipWorktree?: boolean;
    initialAgent?: any;
    githubUrl?: string;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: createWorkspace', {
      title: params.title,
      isRemote: params.environmentConfig?.type === 'remote',
    });
    return await this.workspaceService.createWorkspace(params);
  }

  async preflightCloneCheck(params: { githubUrl: string }): Promise<Result<null, string>> {
    logger.info('Protocol: preflightCloneCheck', { githubUrl: params.githubUrl });
    return await this.workspaceService.preflightCloneCheck(params.githubUrl);
  }

  async listWorkspaces(): Promise<Result<any[], string>> {
    // Default to lite mode for bulk workspace listings to avoid expensive eager enrichment.
    // Callers that truly need synchronous summaries should use listAllWorkspaces({ lite: false }).
    const result = await this.workspaceService.listWorkspaces({
      includeArchived: true,
      lite: true,
    });
    if (result.ok) {
      // Convert new format to old format for backward compatibility
      return { ok: true, data: result.data.workspaces };
    }
    return result as Result<any[], string>;
  }

  async listAllWorkspaces(options?: { includeArchived?: boolean; lite?: boolean }): Promise<Result<any[], string>> {
    // Include archived workspaces by default - frontend handles filtering via "Show archived" toggle
    const result = await this.workspaceService.listWorkspaces({
      includeArchived: options?.includeArchived ?? true,
      lite: options?.lite,
    });
    if (result.ok) {
      // Convert new format to old format for backward compatibility
      return { ok: true, data: result.data.workspaces };
    }
    return result as Result<any[], string>;
  }

  async getWorkspace(id: string | WorkspaceId): Promise<any> {
    // Removed debug log - too frequent

    // Validate id parameter
    if (!id) {
      logger.error('Protocol: getWorkspace called with undefined or null id');
      return null;
    }

    const result = await this.workspaceService.getWorkspace(id as WorkspaceId);

    // For MCP compatibility, return the data directly or null
    // IPC calls will still work as they check the result structure
    return result.ok ? result.data : null;
  }

  async getCurrentContext(workspaceId: string | WorkspaceId): Promise<any> {
    logger.debug('Protocol: getCurrentContext', { workspaceId });
    return await this.workspaceService.getCurrentContext(workspaceId as WorkspaceId);
  }

  async updateWorkspace(params: {
    id: string;
    title?: string;
    statusMessage?: string;
    branch?: string;
    baseRef?: string;
    status?: string;
    tags?: string[];
    prUrl?: string | null;
    prNumber?: number | null;
    prStatus?: string | null;
    activePullRequest?: PullRequestInfo | null;
    pullRequests?: PullRequestInfo[];
  }): Promise<Result<any, string>> {
    logger.info('Protocol: updateWorkspace', { workspaceId: params.id });
    return await this.workspaceService.updateWorkspace(params as any);
  }

  async deleteWorkspace(id: string): Promise<Result<void, string>> {
    logger.info('Protocol: deleteWorkspace', { workspaceId: id });
    return await this.workspaceService.deleteWorkspace(createWorkspaceId(id));
  }

  async archiveWorkspace(id: string): Promise<Result<any, string>> {
    logger.info('Protocol: archiveWorkspace', { workspaceId: id });
    return await this.workspaceService.archiveWorkspace(createWorkspaceId(id));
  }

  async unarchiveWorkspace(id: string): Promise<Result<any, string>> {
    logger.info('Protocol: unarchiveWorkspace', { workspaceId: id });
    return await this.workspaceService.unarchiveWorkspace(createWorkspaceId(id));
  }

  async duplicateWorkspace(params: {
    id: string;
    newTitle?: string;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: duplicateWorkspace', { workspaceId: params.id });
    return await this.workspaceService.duplicateWorkspace(
      createWorkspaceId(params.id),
      params.newTitle,
    );
  }

  async cleanupWorkspace(id: string): Promise<Result<void, string>> {
    logger.info('Protocol: cleanupWorkspace', { workspaceId: id });
    return await this.workspaceService.cleanupWorkspace(createWorkspaceId(id));
  }

  async migrateWorkspacesToCanonicalLocation(): Promise<{
    migrated: number;
    errors: number;
  }> {
    logger.info('Protocol: migrateWorkspacesToCanonicalLocation');
    return await this.workspaceService.migrateWorkspacesToCanonicalLocation();
  }

  async purgeDeletedWorkspaces(): Promise<Result<{ removed: number; orphans: number }, string>> {
    logger.info('Protocol: purgeDeletedWorkspaces');
    return await this.workspaceService.purgeDeletedWorkspaces();
  }

  async findRepositories(directory: string): Promise<Result<string[], string>> {
    logger.debug('Protocol: findRepositories', { directory });
    return await this.workspaceService.findRepositories(directory);
  }

  async updateCurrentContext(params: {
    workspaceId: string;
    context: any;
  }): Promise<Result<void, string>> {
    // Removed debug log - too frequent
    return await this.workspaceService.updateCurrentContext(
      createWorkspaceId(params.workspaceId),
      params.context,
    );
  }

  // ============================================================================
  // Note Methods
  // ============================================================================

  async createNote(
    workspaceIdOrParams:
      | string
      | {
          workspaceId: string;
          title: string;
          content: string;
          contentType?: string;
          tags?: string[];
          parentId?: string;
          visibility?: string;
          id?: string;
          isDefault?: boolean;
          isPinned?: boolean;
        },
    noteData?: any,
  ): Promise<any> {
    // Handle both call signatures for compatibility
    if (typeof workspaceIdOrParams === 'string') {
      // Called with (workspaceId, noteData) - MCP tools style
      const workspaceId = workspaceIdOrParams;
      logger.info('Protocol: createNote (MCP style)', {
        workspaceId,
        title: noteData?.title,
      });

      const result = await this.notesService.createNote({
        workspaceId,
        ...noteData,
      });

      // For MCP tools, return the data directly or null
      return result.ok ? result.data : null;
    } else {
      // Called with (params) - IPC style
      logger.info('Protocol: createNote (IPC style)', {
        workspaceId: workspaceIdOrParams.workspaceId,
        title: workspaceIdOrParams.title,
      });
      return await this.notesService.createNote(workspaceIdOrParams as any);
    }
  }

  async listNotes(workspaceId: string): Promise<any> {
    // Validate workspaceId
    if (!workspaceId) {
      logger.error('[ProtocolAdapter] listNotes called without workspaceId');
      return [];
    }

    const result = await this.notesService.listNotes(createWorkspaceId(workspaceId));

    // Check if this is being called from MCP (based on call stack or return type expectation)
    // For now, we'll return the data directly for MCP compatibility
    // IPC calls will still work as they check the result structure
    // Return just the notes array, not the full paginated response object
    return result.ok ? result.data.notes : [];
  }

  async getNote(
    workspaceIdOrParams: string | { workspaceId: string; noteId: string },
    noteId?: string,
  ): Promise<any> {
    // Handle both call signatures for compatibility
    let actualWorkspaceId: string;
    let actualNoteId: string;

    if (typeof workspaceIdOrParams === 'string') {
      // Called with (workspaceId, noteId) - MCP tools style
      actualWorkspaceId = workspaceIdOrParams;
      actualNoteId = noteId!;
    } else {
      // Called with ({ workspaceId, noteId }) - IPC style
      actualWorkspaceId = workspaceIdOrParams.workspaceId;
      actualNoteId = workspaceIdOrParams.noteId;
    }

    logger.debug('Protocol: getNote', {
      workspaceId: actualWorkspaceId,
      noteId: actualNoteId,
    });

    const result = await this.notesService.getNote(
      createWorkspaceId(actualWorkspaceId),
      createNoteId(actualNoteId),
    );

    // For MCP tools, return the data directly or null
    if (typeof workspaceIdOrParams === 'string') {
      return result.ok ? result.data : null;
    }

    // For IPC, return the Result object
    return result;
  }

  async updateNote(
    workspaceIdOrParams:
      | string
      | {
          id: string;
          workspaceId: string;
          title?: string;
          content?: string;
          tags?: string[];
          isPinned?: boolean;
          isArchived?: boolean;
          visibility?: string;
        },
    noteId?: string,
    updates?: any,
  ): Promise<any> {
    // Handle both call signatures for compatibility
    if (typeof workspaceIdOrParams === 'string') {
      // Called with (workspaceId, noteId, updates) - MCP tools style
      const workspaceId = workspaceIdOrParams;
      logger.info('Protocol: updateNote (MCP style)', {
        workspaceId,
        noteId,
      });

      const result = await this.notesService.updateNote({
        workspaceId,
        id: noteId!,
        ...updates,
      });

      // For MCP tools, return the data directly or false
      return result.ok ? result.data : false;
    } else {
      // Called with (params) - IPC style
      logger.info('Protocol: updateNote (IPC style)', {
        workspaceId: workspaceIdOrParams.workspaceId,
        noteId: workspaceIdOrParams.id,
      });
      return await this.notesService.updateNote(workspaceIdOrParams as any);
    }
  }

  async deleteNote(
    workspaceIdOrParams: string | { noteId: string; workspaceId: string },
    noteId?: string,
  ): Promise<any> {
    // Handle both call signatures for compatibility
    if (typeof workspaceIdOrParams === 'string') {
      // Called with (workspaceId, noteId) - MCP tools style
      const workspaceId = workspaceIdOrParams;
      logger.info('Protocol: deleteNote (MCP style)', {
        workspaceId,
        noteId,
      });

      const result = await this.notesService.deleteNote(
        createNoteId(noteId!),
        createWorkspaceId(workspaceId),
      );

      // For MCP tools, return true/false
      return result.ok;
    } else {
      // Called with (params) - IPC style
      logger.info('Protocol: deleteNote (IPC style)', {
        workspaceId: workspaceIdOrParams.workspaceId,
        noteId: workspaceIdOrParams.noteId,
      });
      return await this.notesService.deleteNote(
        createNoteId(workspaceIdOrParams.noteId),
        createWorkspaceId(workspaceIdOrParams.workspaceId),
      );
    }
  }

  // ============================================================================
  // Comment Methods
  // ============================================================================

  async addComment(params: {
    id?: string;
    workspaceId: string;
    noteId: string;
    content: string;
    type: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session';
    author: string;
    authorType: 'user' | 'agent';
    section?: string;
    lineStart?: number;
    lineEnd?: number;
    parentId?: string;
    threadId?: string;
    tags?: string[];
    from?: number;
    to?: number;
    markId?: string;
    agentId?: string;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: addComment', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      type: params.type,
    });
    return await this.notesService.addComment(params.workspaceId, params.noteId, params);
  }

  async listComments(params: {
    workspaceId: string;
    noteId: string;
    filters?: {
      status?: 'open' | 'resolved' | 'pending';
      type?: string;
      author?: string;
    };
  }): Promise<Result<any[], string>> {
    // Removed debug log - too frequent
    return await this.notesService.listComments(params.workspaceId, params.noteId, params.filters);
  }

  async updateCommentStatus(params: {
    workspaceId: string;
    noteId: string;
    commentId: string;
    status: 'open' | 'resolved' | 'pending';
  }): Promise<Result<any, string>> {
    logger.info('Protocol: updateCommentStatus', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      commentId: params.commentId,
      status: params.status,
    });
    return await this.notesService.updateCommentStatus(
      params.workspaceId,
      params.noteId,
      params.commentId,
      params.status,
    );
  }

  async deleteComment(params: {
    workspaceId: string;
    noteId: string;
    commentId: string;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: deleteComment', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      commentId: params.commentId,
    });
    return await this.notesService.deleteComment(
      params.workspaceId,
      params.noteId,
      params.commentId,
    );
  }

  async suggestChange(params: {
    workspaceId: string;
    noteId: string;
    description: string;
    original: string;
    proposed: string;
    author: string;
    authorType: 'user' | 'agent';
    lineStart?: number;
    lineEnd?: number;
    section?: string;
    reason?: string;
    tags?: string;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: suggestChange', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
    });
    return await this.notesService.suggestChange(params.workspaceId, params.noteId, params);
  }

  // ============================================================================
  // Task Management Methods (Phase 1C)
  // ============================================================================

  async markAsTask(params: {
    workspaceId: string;
    noteId: string;
    taskMetadata: any;
  }): Promise<Result<any, string>> {
    return this.notesService.markAsTask(
      createWorkspaceId(params.workspaceId),
      createNoteId(params.noteId),
      params.taskMetadata,
    );
  }

  async createPrerequisiteNote(params: {
    workspaceId: string;
    dependentNoteId: string;
    prerequisite: {
      title: string;
      content?: string;
      taskMetadata?: any;
      agentConfig?: {
        instruction?: string;
        model?: string;
        autoStart?: boolean;
      };
    };
  }): Promise<Result<any, string>> {
    logger.info('Protocol: createPrerequisiteNote', {
      workspaceId: params.workspaceId,
      dependentNoteId: params.dependentNoteId,
      withAgent: !!params.prerequisite.agentConfig,
    });
    const result = await this.notesService.createPrerequisiteNote(
      createWorkspaceId(params.workspaceId),
      createNoteId(params.dependentNoteId),
      {
        title: params.prerequisite.title,
        content: params.prerequisite.content,
        taskStatus: params.prerequisite.taskMetadata?.status,
        agentConfig: params.prerequisite.agentConfig,
      },
    );

    // Wrap the result to match expected format
    if (result.ok) {
      return {
        ok: true,
        data: {
          prerequisiteNote: result.data.note,
          agent: result.data.agent,
        },
      };
    }
    return result;
  }

  async assignAgentToTask(params: {
    workspaceId: string;
    noteId: string;
    agentId: string;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: assignAgentToTask', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      agentId: params.agentId,
    });
    return await this.notesService.assignAgentToTask(
      createWorkspaceId(params.workspaceId),
      createNoteId(params.noteId),
      createAgentId(params.agentId),
    );
  }

  /**
   * Update the task status of a Task Note
   * This updates the note's metadata taskStatus field (not_started, in_progress, complete, blocked)
   */
  async updateTaskStatus(
    workspaceId: string,
    noteId: string,
    status: string,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    logger.info('Protocol: updateTaskStatus', {
      workspaceId,
      noteId,
      status,
    });
    const result = await this.notesService.updateTaskStatus(
      createWorkspaceId(workspaceId),
      createNoteId(noteId),
      status as any, // TaskStatus type
    );
    if (result.ok) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Convert ```task blocks to linked Task Notes
   * Scans a note for ```task blocks and creates Task Notes for each,
   * then updates the note with links to the created Task Notes.
   */
  async convertTaskBlocks(params: {
    workspaceId: string;
    noteId: string;
  }): Promise<Result<{ convertedCount: number; createdNoteIds: string[] }, string>> {
    logger.info('Protocol: convertTaskBlocks', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
    });
    const result = await this.notesService.convertTaskBlocks(
      createWorkspaceId(params.workspaceId),
      params.noteId,
    );
    if (result.ok) {
      return {
        ok: true,
        data: {
          convertedCount: result.data.convertedCount,
          createdNoteIds: result.data.createdNoteIds,
        },
      };
    }
    return result;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Handle generic method call
   * Useful for dynamic routing from MCP servers
   */
  async call(method: string, params: any): Promise<Result<any, string>> {
    logger.debug('Protocol: call', { method, params });

    // Map method names to adapter methods
    const methodMap: Record<string, (params: any) => Promise<Result<any, string>>> = {
      // Workspace methods
      createWorkspace: (p) => this.createWorkspace(p),
      listWorkspaces: () => this.listWorkspaces(),
      getWorkspace: (p) => this.getWorkspace(p?.id || (p?.workspaceId as WorkspaceId)),
      updateWorkspace: (p) => this.updateWorkspace(p),
      deleteWorkspace: (p) => this.deleteWorkspace(p.id || p.workspaceId),
      archiveWorkspace: (p) => this.archiveWorkspace(p.id || p.workspaceId),
      unarchiveWorkspace: (p) => this.unarchiveWorkspace(p.id || p.workspaceId),
      duplicateWorkspace: (p) => this.duplicateWorkspace(p),
      cleanupWorkspace: (p) => this.cleanupWorkspace(p.id || p.workspaceId),
      updateCurrentContext: (p) => this.updateCurrentContext(p),

      // Note methods
      createNote: (p) => this.createNote(p),
      listNotes: (p) => this.listNotes(p.workspaceId),
      getNote: (p) => this.getNote(p),
      updateNote: (p) => this.updateNote(p),
      deleteNote: (p) => this.deleteNote(p),

      // Comment methods
      addComment: (p) => this.addComment(p),
      listComments: (p) => this.listComments(p),
      updateCommentStatus: (p) => this.updateCommentStatus(p),
      deleteComment: (p) => this.deleteComment(p),
      suggestChange: (p) => this.suggestChange(p),

      // Task management methods (Phase 1C)
      markAsTask: (p) => this.markAsTask(p),
      createPrerequisiteNote: (p) => this.createPrerequisiteNote(p),
      assignAgentToTask: (p) => this.assignAgentToTask(p),
      convertTaskBlocks: (p) => this.convertTaskBlocks(p),
    };

    const handler = methodMap[method];
    if (!handler) {
      logger.error('Unknown method', undefined, { method });
      return {
        ok: false,
        error: `Unknown method: ${method}`,
      };
    }

    return await handler(params);
  }

  // ============================================================================
  // ACP Methods
  // ============================================================================

  /**
   * Handle ACP request using the official ACP server
   */
  async handleACPRequest(request: any): Promise<any> {
    logger.debug('Protocol: handleACPRequest', { method: request.method });

    if (!this.acpServer) {
      throw new Error('No ACP server initialized');
    }

    // Convert to JSON-RPC 2.0 format if needed
    const jsonRpcRequest = {
      jsonrpc: '2.0' as const,
      method: request.method,
      params: request.params,
      id: request.id || uuidv4(),
    };

    const response = await this.acpServer.handleMessage(JSON.stringify(jsonRpcRequest));
    return response ? JSON.parse(response) : null;
  }

  /**
   * Handle ACP notification using the official ACP server
   */
  async handleACPNotification(notification: any): Promise<void> {
    logger.debug('Protocol: handleACPNotification', { method: notification.method });

    if (!this.acpServer) {
      return; // Silently ignore if no server
    }

    // Convert to JSON-RPC 2.0 notification format
    const jsonRpcNotification = {
      jsonrpc: '2.0' as const,
      method: notification.method,
      params: notification.params,
    };

    await this.acpServer.handleMessage(JSON.stringify(jsonRpcNotification));
  }

  /**
   * Create ACP session using the official ACP server
   */
  async createACPSession(params: {
    workspaceId: string;
    agentId?: string;
    agentName?: string;
    mode?: string;
    permissions?: any;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: createACPSession', { workspaceId: params.workspaceId });

    try {
      // Get workspace to get the path
      const workspaceResult = await this.workspaceService.getWorkspace(
        params.workspaceId as WorkspaceId,
      );
      if (!workspaceResult.ok) {
        return { ok: false, error: 'Workspace not found' };
      }

      // Initialize ACP server if not already done
      const acpServer = this.initializeACPServer(
        params.workspaceId,
        workspaceResult.data.worktreePath || workspaceResult.data.repositoryPath || '',
        workspaceResult.data.scope,
      );

      // Create session using JSON-RPC 2.0
      const request = {
        jsonrpc: '2.0' as const,
        method: 'session/new',
        params: {
          metadata: {
            workspaceId: params.workspaceId,
            agentId: params.agentId,
            agentName: params.agentName,
            mode: params.mode,
            permissions: params.permissions,
          },
        },
        id: uuidv4(),
      };

      const response = await acpServer.handleMessage(JSON.stringify(request));
      if (!response) {
        throw new Error('No response from ACP server');
      }

      const result = JSON.parse(response);
      if (result.error) {
        throw new Error(result.error.message);
      }

      return {
        ok: true,
        data: result.result,
      };
    } catch (error) {
      logger.error('Failed to create ACP session', error as Error);
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Destroy ACP session
   */
  async destroyACPSession(sessionId: string): Promise<Result<void, string>> {
    logger.info('Protocol: destroyACPSession', { sessionId });

    try {
      // Send session/cancel notification to the ACP server
      if (this.acpServer) {
        const notification = {
          jsonrpc: '2.0' as const,
          method: 'session/cancel',
          params: {
            sessionId,
          },
        };

        await this.acpServer.handleMessage(JSON.stringify(notification));
      }

      return {
        ok: true,
        data: undefined,
      };
    } catch (error) {
      logger.error('Failed to destroy ACP session', error as Error);
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * List ACP sessions
   */
  async listACPSessions(): Promise<Result<any[], string>> {
    logger.debug('Protocol: listACPSessions');

    try {
      // Collect sessions from all ACP servers
      const allSessions: any[] = [];

      if (this.acpServer) {
        // Get sessions from the server
        const sessions = (this.acpServer as any).getActiveSessions?.() || [];
        allSessions.push(
          ...sessions.map((session: any) => ({
            ...session,
          })),
        );
      }

      return {
        ok: true,
        data: allSessions,
      };
    } catch (error) {
      logger.error('Failed to list ACP sessions', error as Error);
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  }

  // ============================================================================
  // Tool Service Methods (Direct Access for Auggie)
  // ============================================================================

  /**
   * Execute tool directly (for Auggie's optimal path)
   */
  async executeTool(params: {
    workspaceId: string;
    tool: string;
    args: any;
    user?: UserContext;
    permissions?: ToolPermissions;
  }): Promise<Result<any, string>> {
    logger.debug('Protocol: executeTool', {
      workspaceId: params.workspaceId,
      tool: params.tool,
    });

    try {
      // Get workspace
      const workspaceResult = await this.workspaceService.getWorkspace(
        params.workspaceId as WorkspaceId,
      );
      if (!workspaceResult.ok) {
        return workspaceResult;
      }
      const workspace = workspaceResult.data;

      // Create/reuse executor via ExecutionManager (caching + retries)
      const workspacePath = workspace.worktreePath || workspace.repositoryPath || process.cwd();
      const remote =
        workspace.environmentConfig?.type === 'remote' && workspace.environmentConfig.ssh
          ? {
              host: workspace.environmentConfig.ssh.host,
              port: workspace.environmentConfig.ssh.port || 22,
              username: workspace.environmentConfig.ssh.user,
              privateKey: workspace.environmentConfig.ssh.key_path,
              password: workspace.environmentConfig.ssh.password,
              workspacePath,
              transport: workspace.environmentConfig.ssh.transport,
              wsUrl: workspace.environmentConfig.ssh.ws_url,
            }
          : null;
      executorManager.getExecutor({
        workspaceId: params.workspaceId,
        workspacePath,
        remote,
      });

      // Build context
      const context: ToolContext = {
        workspaceId: params.workspaceId,
        input: params.args, // Required by main process ToolContext
      };

      // Execute tool
      const result = await this.toolService.executeTool(params.tool, params.args, context);

      if (result.success) {
        return {
          ok: true,
          data: result.data,
        };
      } else {
        return {
          ok: false,
          error: result.error || 'Tool execution failed',
        };
      }
    } catch (error) {
      logger.error('Failed to execute tool', error as Error);
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<Result<any[], string>> {
    logger.debug('Protocol: listTools');

    try {
      const tools = await this.toolService.listTools();
      return {
        ok: true,
        data: tools,
      };
    } catch (error) {
      logger.error('Failed to list tools', error as Error);
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  }
}

/**
 * Export singleton instance for convenience
 */
export const protocolAdapter = new ProtocolAdapter();

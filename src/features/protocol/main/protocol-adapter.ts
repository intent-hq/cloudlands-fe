import { v4 as uuidv4 } from 'uuid';
import {
  WorkspaceId as createWorkspaceId,
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
import { ToolService } from '../../tools/main/tool.service';
import { ACPServer } from '../../acp-official/main/server/acp-server';
import type { ACPServerConfig } from '../../acp-official/main/server/acp-server';
import { getBackendClient } from '../../backend/main/backend.ipc';
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
    toolService?: ToolService,
  ) {
    this.toolService = toolService || new ToolService(workspaceService);
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

  // Workspace creation is owned by the daemon: the FE routes `workspace.create`
  // through `appClient.workspaces.create` (PROTOCOL §5.1); the legacy
  // protocol-adapter `createWorkspace` arm was retired with the daemon-direct
  // cut-over.

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
    const isMcpStyle = typeof workspaceIdOrParams === 'string';
    const workspaceId = isMcpStyle ? (workspaceIdOrParams as string) : workspaceIdOrParams.workspaceId;
    const payload = isMcpStyle ? { workspaceId, ...noteData } : workspaceIdOrParams;
    logger.info(`Protocol: createNote (${isMcpStyle ? 'MCP' : 'IPC'} style)`, {
      workspaceId,
      title: payload?.title,
    });

    try {
      const { title, content, tags, parentId } = payload as any;
      const result = await getBackendClient().request<{ note: any }>('note.create', {
        workspaceId,
        title,
        ...(content !== undefined ? { content } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      });
      const note = result?.note ?? null;
      return isMcpStyle ? note : { ok: true, data: note };
    } catch (error) {
      logger.error('Failed to create note', error as Error);
      return isMcpStyle
        ? null
        : { ok: false, error: (error as Error).message };
    }
  }

  async listNotes(workspaceId: string, _options?: { summariesOnly?: boolean }): Promise<any> {
    if (!workspaceId) {
      logger.error('[ProtocolAdapter] listNotes called without workspaceId');
      return [];
    }

    try {
      const result = await getBackendClient().request<{ notes: any[] }>('note.list', {
        workspaceId,
      });
      return Array.isArray(result?.notes) ? result.notes : [];
    } catch (error) {
      logger.error('Failed to list notes', error as Error);
      return [];
    }
  }

  async getNote(
    workspaceIdOrParams: string | { workspaceId: string; noteId: string; initializeCRDT?: boolean },
    noteId?: string,
  ): Promise<any> {
    const isMcpStyle = typeof workspaceIdOrParams === 'string';
    let actualWorkspaceId: string;
    let actualNoteId: string;

    if (isMcpStyle) {
      if (noteId === undefined) {
        throw new Error('noteId is required when calling getNote with a workspaceId string');
      }
      actualWorkspaceId = workspaceIdOrParams as string;
      actualNoteId = noteId;
    } else {
      actualWorkspaceId = workspaceIdOrParams.workspaceId;
      actualNoteId = workspaceIdOrParams.noteId;
    }

    logger.debug('Protocol: getNote', {
      workspaceId: actualWorkspaceId,
      noteId: actualNoteId,
    });

    try {
      const result = await getBackendClient().request<{ note: any }>('note.get', {
        workspaceId: actualWorkspaceId,
        noteId: actualNoteId,
      });
      const note = result?.note ?? null;
      return isMcpStyle ? note : { ok: true, data: note };
    } catch (error) {
      logger.error('Failed to get note', error as Error, {
        workspaceId: actualWorkspaceId,
        noteId: actualNoteId,
      });
      return isMcpStyle
        ? null
        : { ok: false, error: (error as Error).message };
    }
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
    const isMcpStyle = typeof workspaceIdOrParams === 'string';
    let workspaceId: string;
    let actualNoteId: string;
    let patch: any;

    if (isMcpStyle) {
      if (noteId === undefined) {
        throw new Error('noteId is required when calling updateNote with a workspaceId string');
      }
      workspaceId = workspaceIdOrParams as string;
      actualNoteId = noteId;
      patch = updates ?? {};
    } else {
      workspaceId = workspaceIdOrParams.workspaceId;
      actualNoteId = workspaceIdOrParams.id;
      patch = workspaceIdOrParams;
    }

    logger.info(`Protocol: updateNote (${isMcpStyle ? 'MCP' : 'IPC'} style)`, {
      workspaceId,
      noteId: actualNoteId,
    });

    const { title, content, tags } = patch;
    const daemonParams: Record<string, unknown> = { workspaceId, noteId: actualNoteId };
    if (content !== undefined) daemonParams.content = content;
    if (title !== undefined) daemonParams.title = title;
    if (tags !== undefined) daemonParams.tags = tags;

    try {
      const result = await getBackendClient().request<{ note: any }>('note.update', daemonParams);
      const note = result?.note ?? null;
      return isMcpStyle ? (note ?? true) : { ok: true, data: note };
    } catch (error) {
      logger.error('Failed to update note', error as Error, { workspaceId, noteId: actualNoteId });
      return isMcpStyle ? false : { ok: false, error: (error as Error).message };
    }
  }

  async deleteNote(
    workspaceIdOrParams: string | { noteId: string; workspaceId: string },
    noteId?: string,
  ): Promise<any> {
    const isMcpStyle = typeof workspaceIdOrParams === 'string';
    let workspaceId: string;
    let actualNoteId: string;

    if (isMcpStyle) {
      if (noteId === undefined) {
        throw new Error('noteId is required when calling deleteNote with a workspaceId string');
      }
      workspaceId = workspaceIdOrParams as string;
      actualNoteId = noteId;
    } else {
      workspaceId = workspaceIdOrParams.workspaceId;
      actualNoteId = workspaceIdOrParams.noteId;
    }

    logger.info(`Protocol: deleteNote (${isMcpStyle ? 'MCP' : 'IPC'} style)`, {
      workspaceId,
      noteId: actualNoteId,
    });

    try {
      await getBackendClient().request<{ ok: boolean; noteId: string; deleted: boolean }>(
        'note.delete',
        { workspaceId, noteId: actualNoteId },
      );
      return isMcpStyle ? true : { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to delete note', error as Error, { workspaceId, noteId: actualNoteId });
      return isMcpStyle ? false : { ok: false, error: (error as Error).message };
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
    searchContext?: string;
    commentTarget?: string;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: addComment', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      type: params.type,
    });
    try {
      const daemonParams: Record<string, unknown> = {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        comment: params.content,
      };
      if (params.searchContext !== undefined) daemonParams.searchContext = params.searchContext;
      if (params.commentTarget !== undefined) daemonParams.commentTarget = params.commentTarget;
      if (params.type !== undefined) daemonParams.type = params.type;
      if (params.author !== undefined) daemonParams.author = params.author;
      if (params.authorType !== undefined) daemonParams.authorType = params.authorType;
      if (params.threadId !== undefined) daemonParams.threadId = params.threadId;
      if (params.parentId !== undefined) daemonParams.parentId = params.parentId;
      if (params.tags !== undefined) daemonParams.tags = params.tags;
      const result = await getBackendClient().request<any>('comment.add', daemonParams);
      return { ok: true, data: result };
    } catch (error) {
      logger.error('Failed to add comment', error as Error);
      return { ok: false, error: (error as Error).message };
    }
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
    try {
      const daemonParams: Record<string, unknown> = {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        includeComments: true,
      };
      if (params.filters?.status !== undefined) daemonParams.status = params.filters.status;
      if (params.filters?.author !== undefined) daemonParams.author = params.filters.author;
      const result = await getBackendClient().request<{ threads: any[] }>(
        'comment.list',
        daemonParams,
      );
      const threads = Array.isArray(result?.threads) ? result.threads : [];
      const comments: any[] = [];
      for (const thread of threads) {
        const threadComments = Array.isArray(thread?.comments) ? thread.comments : [];
        for (const comment of threadComments) {
          comments.push(comment);
        }
      }
      return { ok: true, data: comments };
    } catch (error) {
      logger.error('Failed to list comments', error as Error);
      return { ok: false, error: (error as Error).message };
    }
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
    try {
      const result = await getBackendClient().request<any>('comment.resolveThread', {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        commentId: params.commentId,
        resolved: params.status === 'resolved',
      });
      return { ok: true, data: result };
    } catch (error) {
      logger.error('Failed to update comment status', error as Error);
      return { ok: false, error: (error as Error).message };
    }
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
    try {
      const result = await getBackendClient().request<any>('comment.delete', {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        commentId: params.commentId,
      });
      return { ok: true, data: result };
    } catch (error) {
      logger.error('Failed to delete comment', error as Error);
      return { ok: false, error: (error as Error).message };
    }
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
    searchContext?: string;
    commentTarget?: string;
  }): Promise<Result<any, string>> {
    logger.info('Protocol: suggestChange', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
    });
    try {
      const daemonParams: Record<string, unknown> = {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        comment: params.description,
        type: 'suggestion',
        author: params.author,
        authorType: params.authorType,
        suggestionOriginal: params.original,
        suggestionProposed: params.proposed,
      };
      if (params.searchContext !== undefined) daemonParams.searchContext = params.searchContext;
      if (params.commentTarget !== undefined) daemonParams.commentTarget = params.commentTarget;
      const result = await getBackendClient().request<any>('comment.add', daemonParams);
      return { ok: true, data: result };
    } catch (error) {
      logger.error('Failed to suggest change', error as Error);
      return { ok: false, error: (error as Error).message };
    }
  }

  // ============================================================================
  // Task Management Methods (Phase 1C)
  // ============================================================================

  async markAsTask(params: {
    workspaceId: string;
    noteId: string;
    taskMetadata: any;
  }): Promise<Result<any, string>> {
    const meta = params.taskMetadata ?? {};
    const daemonParams: Record<string, unknown> = {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      status: meta.status ?? 'not_started',
    };
    if (meta.acceptanceCriteria !== undefined) daemonParams.acceptanceCriteria = meta.acceptanceCriteria;
    if (meta.effort !== undefined) daemonParams.effort = meta.effort;
    try {
      const result = await getBackendClient().request<any>('task.markAsTask', daemonParams);
      return { ok: true, data: result };
    } catch (error) {
      logger.error('Failed to mark as task', error as Error);
      return { ok: false, error: (error as Error).message };
    }
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
    const daemonParams: Record<string, unknown> = {
      workspaceId: params.workspaceId,
      dependentNoteId: params.dependentNoteId,
      title: params.prerequisite.title,
    };
    if (params.prerequisite.content !== undefined) daemonParams.content = params.prerequisite.content;
    if (params.prerequisite.taskMetadata?.status !== undefined)
      daemonParams.status = params.prerequisite.taskMetadata.status;
    try {
      const result = await getBackendClient().request<any>('task.createPrerequisite', daemonParams);
      return {
        ok: true,
        data: {
          prerequisiteNote: result?.note ?? result?.prerequisiteNote ?? result,
          agent: result?.agent,
        },
      };
    } catch (error) {
      logger.error('Failed to create prerequisite note', error as Error);
      return { ok: false, error: (error as Error).message };
    }
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
    try {
      const result = await getBackendClient().request<any>('task.assignAgent', {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        agentId: params.agentId,
      });
      return { ok: true, data: result };
    } catch (error) {
      logger.error('Failed to assign agent to task', error as Error);
      return { ok: false, error: (error as Error).message };
    }
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
    try {
      const result = await getBackendClient().request<any>('task.updateNoteStatus', {
        workspaceId,
        noteId,
        status,
      });
      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to update task status', error as Error);
      return { success: false, error: (error as Error).message };
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
    try {
      const result = await getBackendClient().request<{
        convertedCount: number;
        createdNoteIds: string[];
      }>('task.convertBlocks', {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
      });
      return {
        ok: true,
        data: {
          convertedCount: result?.convertedCount ?? 0,
          createdNoteIds: result?.createdNoteIds ?? [],
        },
      };
    } catch (error) {
      logger.error('Failed to convert task blocks', error as Error);
      return { ok: false, error: (error as Error).message };
    }
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

      // Create/reuse executor via ExecutionManager (caching + retries).
      const workspacePath = workspace.worktreePath || workspace.repositoryPath || process.cwd();
      executorManager.getExecutor({
        workspaceId: params.workspaceId,
        workspacePath,
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
 * Export singleton instance for convenience.
 *
 * Keep construction lazy: several main-process modules import protocolAdapter
 * while WorkspaceService is still initializing. Eager construction here can
 * observe a circular-import placeholder instead of the real WorkspaceService
 * class under Vitest/ESM and crash before tests even collect.
 */
let protocolAdapterInstance: ProtocolAdapter | undefined;

export function getProtocolAdapter(): ProtocolAdapter {
  protocolAdapterInstance ??= new ProtocolAdapter();
  return protocolAdapterInstance;
}

export const protocolAdapter: ProtocolAdapter = new Proxy({} as ProtocolAdapter, {
  get(_target, property, receiver) {
    const instance = getProtocolAdapter();
    const value = Reflect.get(instance, property, receiver);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

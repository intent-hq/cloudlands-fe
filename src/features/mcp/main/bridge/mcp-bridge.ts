/**
 * MCP Bridge
 *
 * Bridges MCP server calls to feature services.
 * Handles versioning, security, and event emission.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';
import * as path from 'path';
import * as fs from 'fs/promises';
import { protocolAdapter } from '../../../protocol/main/protocol-adapter';
import { getBackendClient } from '../../../backend/main/backend.ipc';
import { GitService } from '../../../git/main/git.service';
import { Logger } from '../../../../shared/logger';
import { WorkspaceConfig } from '../../../../shared/main/config.js';
import {
  createWorkspaceUpdatedEvent,
  type McpActor,
} from '../../types/events';
import type { ToolName } from '../../types/schemas';
import { createHash, randomUUID } from 'crypto';
import { emitAgentFileChange } from '../mcp/workspace-file-tools';
import { hostExec } from '../../../../shared/main/host-exec';
import { assertAgentCommitAllowed } from '$features/workspace/main/workspace-settings.service';

const logger = new Logger('McpBridge');

/**
 * Safely broadcast an IPC message to windows viewing a specific workspace.
 * Falls back to all windows if workspaceId is not provided.
 */
function safeBroadcastToWindows(channel: string, data: unknown, workspaceId?: string): void {
  try {
    sendToWorkspaceWindows(workspaceId, channel, data);
  } catch (error) {
    logger.warn('Failed to broadcast IPC message', {
      channel,
      error: (error as Error).message,
    });
  }
}

export interface BridgeCallContext {
  workspaceId: string;
  actor: McpActor;
  requestId?: string;
}

export interface BridgeResponse {
  success: boolean;
  data?: any;
  version?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export class McpBridge extends EventEmitter {
  private gitService: GitService;
  private idempotencyStore: Map<string, { response: BridgeResponse; timestamp: number }> =
    new Map();
  private versionStore: Map<string, string> = new Map();
  private idempotencyCleanupInterval: NodeJS.Timeout | null = null;
  private idempotencyTTL = 60000; // 1 minute

  constructor() {
    super();

    // Initialize services
    // Workspace and Notes services are accessed via protocolAdapter for unified event handling
    this.gitService = new GitService();

    // Cleanup old idempotency entries periodically
    this.idempotencyCleanupInterval = setInterval(
      () => this.cleanupIdempotencyStore(),
      this.idempotencyTTL,
    );
  }

  /**
   * Invoke a bridge method
   */
  async invoke(method: ToolName, params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    try {
      // Check idempotency
      if (params.requestId) {
        const cached = this.idempotencyStore.get(params.requestId);
        if (cached) {
          logger.info(`Returning cached response for request ${params.requestId}`);
          return cached.response;
        }
      }

      // Validate workspace path security
      if (params.path) {
        this.validatePath(context.workspaceId, params.path);
      }

      // Route to appropriate handler
      let response: BridgeResponse;

      switch (method) {
        // Workspace methods
        case 'workspace.get':
          response = await this.handleWorkspaceGet(params, context);
          break;
        case 'workspace.update':
          response = await this.handleWorkspaceUpdate(params, context);
          break;
        case 'workspace.listSessions':
          response = await this.handleWorkspaceListSessions(params, context);
          break;
        case 'workspace.createSession':
          response = await this.handleWorkspaceCreateSession(params, context);
          break;

        // Notes methods
        case 'notes.list':
          response = await this.handleNotesList(params, context);
          break;
        case 'notes.get':
          response = await this.handleNotesGet(params, context);
          break;
        case 'notes.create':
          response = await this.handleNotesCreate(params, context);
          break;
        case 'notes.update':
          response = await this.handleNotesUpdate(params, context);
          break;
        case 'notes.addComment':
          response = await this.handleNotesAddComment(params, context);
          break;
        case 'notes.listComments':
          response = await this.handleNotesListComments(params, context);
          break;
        case 'notes.delete':
          response = await this.handleNotesDelete(params, context);
          break;
        case 'notes.suggestChange':
          response = await this.handleNotesSuggestChange(params, context);
          break;
        case 'notes.updateCommentStatus':
          response = await this.handleNotesUpdateCommentStatus(params, context);
          break;

        // Task management methods (Phase 1C)
        case 'tasks.getMyTask':
          response = await this.handleTasksGetMyTask(params, context);
          break;
        case 'tasks.markAsTask':
          response = await this.handleTasksMarkAsTask(params, context);
          break;
        case 'tasks.createPrerequisite':
          response = await this.handleTasksCreatePrerequisite(params, context);
          break;
        case 'tasks.assignAgent':
          response = await this.handleTasksAssignAgent(params, context);
          break;

        // Git methods
        case 'git.status':
          response = await this.handleGitStatus(params, context);
          break;
        case 'git.diff':
          response = await this.handleGitDiff(params, context);
          break;
        case 'git.commit':
          response = await this.handleGitCommit(params, context);
          break;
        case 'git.branch':
          response = await this.handleGitBranch(params, context);
          break;

        // File system methods
        case 'fs.read':
          response = await this.handleFsRead(params, context);
          break;
        case 'fs.write':
          response = await this.handleFsWrite(params, context);
          break;
        case 'fs.applyPatch':
          response = await this.handleFsApplyPatch(params, context);
          break;
        case 'fs.delete':
          response = await this.handleFsDelete(params, context);
          break;
        case 'fs.rename':
          response = await this.handleFsRename(params, context);
          break;
        case 'fs.mkdir':
          response = await this.handleFsMkdir(params, context);
          break;

        default:
          throw new Error(`Unknown method: ${method}`);
      }

      // Store for idempotency
      if (params.requestId && response.success) {
        this.idempotencyStore.set(params.requestId, {
          response,
          timestamp: Date.now(),
        });
      }

      return response;
    } catch (error) {
      logger.error(`Bridge invoke failed for ${method}:`, error as Error);

      const bridgeError = error as {
        code?: string;
        message?: string;
        currentVersion?: number;
        currentState?: unknown;
        details?: unknown;
      };

      // Check if it's a version conflict
      if (bridgeError.code === 'VERSION_CONFLICT') {
        return {
          success: false,
          error: {
            code: 'CONFLICT',
            message: bridgeError.message || 'Version conflict',
            details: {
              currentVersion: bridgeError.currentVersion,
              currentState: bridgeError.currentState,
            },
          },
        };
      }

      return {
        success: false,
        error: {
          code: bridgeError.code || 'INTERNAL_ERROR',
          message: bridgeError.message || (error as Error).message,
          details: bridgeError.details,
        },
      };
    }
  }

  // ============================================================================
  // Workspace Handlers
  // ============================================================================

  private async handleWorkspaceGet(
    params: any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const result = await protocolAdapter.getWorkspace(params.workspaceId);

    if (!result) {
      throw new Error(`Workspace ${params.workspaceId} not found`);
    }

    return {
      success: true,
      data: result,
      version: this.generateVersion(result),
    };
  }

  private async handleWorkspaceUpdate(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    // Check version
    await this.checkVersion('workspace', params.workspaceId, params.version);

    // Update workspace
    const result = await protocolAdapter.updateWorkspace({
      id: params.workspaceId,
      title: params.title,
    });

    if (!result.ok) {
      throw new Error(result.error || 'Failed to update workspace');
    }

    const newVersion = this.generateVersion(result.data);

    // Emit event
    const event = createWorkspaceUpdatedEvent(
      params.workspaceId,
      'workspace',
      'update',
      newVersion,
      context.actor,
    );
    this.emit('event', event);

    return {
      success: true,
      data: result.data,
      version: newVersion,
    };
  }

  private async handleWorkspaceListSessions(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    params: any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    // NOTE: Agent sessions are managed client-side via renderer agent APIs
    // This MCP tool returns an empty list as sessions are not accessible from main process
    // Future: Consider moving agent session storage to main process for MCP access
    return {
      success: true,
      data: {
        sessions: [],
      },
    };
  }

  private async handleWorkspaceCreateSession(
    params: any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    // NOTE: Agent sessions are managed client-side via renderer agent APIs
    // This MCP tool returns a mock session for compatibility
    // Actual session creation should be done through client-side agent APIs
    const sessionId = `session_${randomUUID()}`;

    return {
      success: true,
      data: {
        id: sessionId,
        workspaceId: params.workspaceId,
        name: params.agentName || `Session ${new Date().toLocaleTimeString()}`,
        createdAt: new Date().toISOString(),
      },
    };
  }

  // ============================================================================
  // Notes Handlers
  // ============================================================================

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async handleNotesList(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    const result = await protocolAdapter.listNotes(params.workspaceId);

    if (!Array.isArray(result)) {
      throw new Error('Failed to list notes');
    }

    return {
      success: true,
      data: result,
    };
  }

  private async handleNotesGet(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    const workspaceId = params.workspaceId || context.workspaceId;
    if (!workspaceId) {
      throw new Error('workspaceId is required');
    }

    const noteId = params.noteId || params.id;
    if (!noteId) {
      throw new Error('noteId is required');
    }

    const result = await protocolAdapter.getNote({ workspaceId, noteId });

    if (!result || !result.ok) {
      throw new Error(result?.error || `Failed to get note ${noteId}`);
    }

    // Extract and embed images from note content for agents
    const noteData = result.data;
    const embeddedImages = await this.extractAndEmbedImages(noteData.content, workspaceId);

    // If images were found, include them in the response
    if (embeddedImages.length > 0) {
      noteData.embeddedImages = embeddedImages;
      logger.info('Embedded images in note response for agent', {
        noteId,
        imageCount: embeddedImages.length,
      });
    }

    return {
      success: true,
      data: noteData,
      version: this.generateVersion(noteData),
    };
  }

  /**
   * Extract workspace-asset:// URLs from content and convert to base64 data
   * This allows agents to "see" images in notes
   */
  private async extractAndEmbedImages(
    content: string,
    workspaceId: string,
  ): Promise<Array<{ url: string; data: string; mimeType: string; alt?: string }>> {
    if (!content) return [];

    const images: Array<{ url: string; data: string; mimeType: string; alt?: string }> = [];

    // Match markdown image syntax with workspace-asset:// URLs
    // ![alt text](workspace-asset://workspaceId/assetId)
    const imageRegex = /!\[([^\]]*)\]\((workspace-asset:\/\/[^)]+)\)/g;
    let match;

    while ((match = imageRegex.exec(content)) !== null) {
      const alt = match[1];
      const url = match[2];

      try {
        // Parse the workspace-asset:// URL
        // Format: workspace-asset://{workspaceId}/{assetId}
        const urlMatch = url.match(/workspace-asset:\/\/([^/]+)\/(.+)/);
        if (!urlMatch) continue;

        const assetWorkspaceId = urlMatch[1];
        const assetId = urlMatch[2];

        // Only resolve assets from the same workspace for security
        if (assetWorkspaceId !== workspaceId) {
          logger.warn('Skipping cross-workspace asset reference', {
            noteWorkspaceId: workspaceId,
            assetWorkspaceId,
            assetId,
          });
          continue;
        }

        // Read the asset via the daemon (PROTOCOL.md §5.2 `note.readAsset`).
        const asset = await getBackendClient().request<{
          data?: string;
          mimeType?: string;
        }>('note.readAsset', { workspaceId, asset: assetId });
        if (asset?.data && asset?.mimeType) {
          images.push({
            url,
            data: asset.data,
            mimeType: asset.mimeType,
            alt: alt || undefined,
          });
        }
      } catch (error) {
        logger.warn('Failed to embed image from note', {
          url,
          error: (error as Error).message,
        });
      }
    }

    return images;
  }

  private async handleNotesCreate(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const result = await protocolAdapter.createNote({
      workspaceId: params.workspaceId,
      title: params.title,
      content: params.content,
      tags: params.tags || [],
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Failed to create note');
    }

    const version = this.generateVersion(result.data);

    // Emit event
    const event = createWorkspaceUpdatedEvent(
      params.workspaceId,
      'note',
      'create',
      version,
      context.actor,
      result.data.id,
    );
    this.emit('event', event);

    return {
      success: true,
      data: result.data,
      version,
    };
  }

  private async handleNotesUpdate(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    // CRITICAL: Require workspaceId for update operations
    const workspaceId = params.workspaceId || context.workspaceId;
    if (!workspaceId) {
      throw new Error('[MCPBridge] CRITICAL: notes.update called without workspaceId');
    }

    // Check version
    await this.checkVersion('note', params.noteId, params.version);

    // CRITICAL: Prevent empty content updates for spec note from agents
    // The spec should never be empty from agent updates - if content is provided, it must be non-empty
    // Allow user actions to clear spec content
    if (params.noteId === 'spec' && params.content !== undefined && !params.isUserAction) {
      const trimmedContent = String(params.content).trim();
      if (trimmedContent.length === 0) {
        logger.error(
          '[MCPBridge] Attempted to update spec with empty content from agent',
          undefined,
          {
            workspaceId,
            noteId: params.noteId,
            contentLength: params.content?.length,
          },
        );
        throw new Error(
          'Cannot update spec with empty content from agent. User actions can clear spec content.',
        );
      }
    }

    const result = await protocolAdapter.updateNote({
      id: params.noteId,
      workspaceId,
      title: params.title,
      content: params.content,
      tags: params.tags,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Failed to update note');
    }

    const newVersion = this.generateVersion(result.data);

    // Emit event
    const event = createWorkspaceUpdatedEvent(
      workspaceId,
      'note',
      'update',
      newVersion,
      context.actor,
      params.noteId,
    );
    this.emit('event', event);

    // Emit real-time content change event for UI streaming
    safeBroadcastToWindows(`note:content-changed:${workspaceId}`, {
      noteId: params.noteId,
      content: params.content,
      source: context.actor?.type || 'agent',
      workspaceId,
    }, workspaceId);

    return {
      success: true,
      data: result.data,
      version: newVersion,
    };
  }

  private async handleNotesAddComment(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    logger.debug('handleNotesAddComment called', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
    });

    // Extract comment data from params - support both nested and flat structure
    const commentData = params.comment || {};

    // Use flat params structure first, fall back to nested comment structure
    const result = await protocolAdapter.addComment({
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      content: params.content || commentData.text || commentData.content || '',
      type: params.type || commentData.type || 'comment',
      author: params.author || commentData.author || context.actor.name || 'Unknown',
      authorType:
        params.authorType ||
        commentData.authorType ||
        (context.actor.type === 'agent' ? 'agent' : 'user'),
      section: params.section || commentData.section,
      lineStart: params.lineStart || commentData.lineStart,
      lineEnd: params.lineEnd || commentData.lineEnd,
      parentId: params.parentId || commentData.parentId,
      threadId: params.threadId || commentData.threadId,
      tags: params.tags || commentData.tags,
    });

    logger.debug('NotesService.addComment result', { ok: result.ok });

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Failed to add comment');
    }

    // Emit event (use 'update' for comment since it updates the note)
    const event = createWorkspaceUpdatedEvent(
      params.workspaceId,
      'note',
      'update',
      this.generateVersion(result.data),
      context.actor,
      params.noteId,
    );
    this.emit('event', event);

    // Also emit note-comments-updated event for UI updates
    const eventData = {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      comment: result.data,
      action: 'added',
    };
    logger.debug('Emitting note-comments-updated event', {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      action: 'added',
    });
    this.emit('note-comments-updated', eventData);

    return {
      success: true,
      data: result.data,
    };
  }

  private async handleNotesListComments(
    params: any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const result = await protocolAdapter.listComments({
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      filters: {
        status: params.status,
        type: params.type,
        author: params.author,
      },
    });

    if (!result.ok) {
      throw new Error('Failed to list comments');
    }

    return {
      success: true,
      data: { comments: result.data },
    };
  }

  private async handleNotesDelete(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    // CRITICAL: Require workspaceId for delete operations
    const workspaceId = params.workspaceId || context.workspaceId;
    if (!workspaceId) {
      throw new Error('[MCPBridge] CRITICAL: notes.delete called without workspaceId');
    }

    const result = await protocolAdapter.deleteNote(params.noteId, workspaceId);

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Failed to delete note');
    }

    // Emit event
    const event = createWorkspaceUpdatedEvent(
      workspaceId,
      'note',
      'delete',
      '',
      context.actor,
      params.noteId,
    );
    this.emit('event', event);

    // Emit real-time deletion event for UI streaming
    safeBroadcastToWindows(`note:deleted:${workspaceId}`, {
      noteId: params.noteId,
      source: context.actor?.type || 'agent',
      workspaceId,
    }, workspaceId);

    return {
      success: true,
      data: { deleted: true },
    };
  }

  private async handleNotesSuggestChange(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const result = await protocolAdapter.suggestChange({
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      description: params.description,
      original: params.original,
      proposed: params.proposed,
      lineStart: params.lineStart,
      lineEnd: params.lineEnd,
      author: params.author,
      authorType: params.authorType,
      section: params.section,
      reason: params.reason,
      tags: params.tags,
    });

    if (!result.ok) {
      throw new Error(result.error || 'Failed to suggest change');
    }

    // Emit workspace updated event
    const event = createWorkspaceUpdatedEvent(
      params.workspaceId,
      'note',
      'update',
      this.generateVersion(result.data),
      context.actor,
      params.noteId,
    );
    this.emit('event', event);

    // Also emit note-comments-updated event for UI updates
    const eventData = {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      comment: result.data,
      action: 'added',
    };
    this.emit('note-comments-updated', eventData);

    return {
      success: true,
      data: result.data,
    };
  }

  private async handleNotesUpdateCommentStatus(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const result = await protocolAdapter.updateCommentStatus({
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      commentId: params.commentId,
      status: params.status,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Failed to update comment status');
    }

    // Emit workspace updated event
    const event = createWorkspaceUpdatedEvent(
      params.workspaceId,
      'note',
      'update',
      this.generateVersion(result.data),
      context.actor,
      params.noteId,
    );
    this.emit('event', event);

    // Also emit note-comments-updated event for UI updates
    const eventData = {
      workspaceId: params.workspaceId,
      noteId: params.noteId,
      comment: result.data,
      action: 'updated',
    };
    this.emit('note-comments-updated', eventData);

    return {
      success: true,
      data: result.data,
    };
  }

  // ============================================================================
  // Task Management Handlers (Phase 1C)
  // ============================================================================

  private async handleTasksGetMyTask(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const workspaceId = params.workspaceId || context.workspaceId;
    if (!workspaceId) {
      throw new Error('workspaceId is required');
    }

    const taskNoteId = params.taskNoteId;
    if (!taskNoteId) {
      throw new Error('taskNoteId is required');
    }

    const result = await protocolAdapter.getNote(taskNoteId, workspaceId);

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Task note not found');
    }

    // Verify it's a task
    if (!result.data.metadata?.task) {
      throw new Error('Note is not a task');
    }

    return {
      success: true,
      data: result.data,
    };
  }

  private async handleTasksMarkAsTask(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const workspaceId = params.workspaceId || context.workspaceId;
    if (!workspaceId) {
      throw new Error('workspaceId is required');
    }

    const result = await protocolAdapter.markAsTask({
      workspaceId,
      noteId: params.noteId,
      taskMetadata: params.taskMetadata,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Failed to mark as task');
    }

    // Emit workspace updated event
    const event = createWorkspaceUpdatedEvent(
      workspaceId,
      'note',
      'update',
      this.generateVersion(result.data),
      context.actor,
      params.noteId,
    );
    this.emit('event', event);

    return {
      success: true,
      data: result.data,
    };
  }

  private async handleTasksCreatePrerequisite(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const workspaceId = params.workspaceId || context.workspaceId;
    if (!workspaceId) {
      throw new Error('workspaceId is required');
    }

    const result = await protocolAdapter.createPrerequisiteNote({
      workspaceId,
      dependentNoteId: params.dependentNoteId,
      prerequisite: params.prerequisite,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Failed to create prerequisite');
    }

    // Emit workspace updated event
    const event = createWorkspaceUpdatedEvent(
      workspaceId,
      'note',
      'create',
      this.generateVersion(result.data.prerequisiteNote),
      context.actor,
      result.data.prerequisiteNote.id,
    );
    this.emit('event', event);

    return {
      success: true,
      data: result.data,
    };
  }

  private async handleTasksAssignAgent(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    const workspaceId = params.workspaceId || context.workspaceId;
    if (!workspaceId) {
      throw new Error('workspaceId is required');
    }

    const result = await protocolAdapter.assignAgentToTask({
      workspaceId,
      noteId: params.noteId,
      agentId: params.agentId,
    });

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Failed to assign agent');
    }

    // Emit workspace updated event
    const event = createWorkspaceUpdatedEvent(
      workspaceId,
      'note',
      'update',
      this.generateVersion(result.data),
      context.actor,
      params.noteId,
    );
    this.emit('event', event);

    return {
      success: true,
      data: result.data,
    };
  }

  // ============================================================================
  // Git Handlers
  // ============================================================================

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async handleGitStatus(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    const result = await this.gitService.getStatus(params.workspaceId);

    if (!result.ok) {
      throw new Error(result.error || 'Failed to get git status');
    }

    return {
      success: true,
      data: result.data,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async handleGitDiff(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    const result = await this.gitService.getDiff(params.workspaceId, params.paths || []);

    if (!result.ok) {
      throw new Error(result.error || 'Failed to get diff');
    }

    return {
      success: true,
      data: result.data,
    };
  }

  private async handleGitCommit(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    // Check auto-commit setting using centralized guard
    const workspaceId = params.workspaceId || context.workspaceId;
    if (workspaceId) {
      const commitCheck = assertAgentCommitAllowed(workspaceId);
      if (!commitCheck.allowed) {
        return {
          success: false,
          error: {
            code: 'AUTO_COMMIT_DISABLED',
            message: commitCheck.reason,
          },
        };
      }
    }

    const result = await this.gitService.commit(
      params.workspaceId,
      params.message,
      params.paths || [],
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to commit');
    }

    // Emit event (use 'update' for commit since it updates the git state)
    const event = createWorkspaceUpdatedEvent(
      params.workspaceId,
      'git',
      'update',
      result.data.sha || '',
      context.actor,
    );
    this.emit('event', event);

    return {
      success: true,
      data: result.data,
    };
  }

  private async handleGitBranch(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    try {
      // Get workspace info to check if remote
      const workspace = await protocolAdapter.getWorkspace(params.workspaceId);
      const isRemote = workspace?.isRemote && workspace?.environmentConfig?.ssh;
      const workspacePath = isRemote
        ? workspace?.worktreePath || workspace?.path || ''
        : this.getWorkspacePath(params.workspaceId);

      // Helper to execute git commands via the daemon's host.exec seam;
      // locality (local/remote) is decided by workspaceId — the FE no longer
      // branches on remote vs. local transports itself.
      const execGitCommand = async (
        command: string,
      ): Promise<{ stdout: string; stderr: string }> => {
        const result = await hostExec('/bin/sh', {
          args: ['-c', command],
          cwd: workspacePath,
          workspaceId: params.workspaceId,
          timeoutMs: 60000,
        });
        return { stdout: result.stdout, stderr: result.stderr };
      };

      // Determine the operation
      const { operation, branchName, baseBranch } = params;

      let result: any = {};

      switch (operation) {
        case 'create':
          // Create new branch
          const createCmd = baseBranch
            ? `git checkout -b ${branchName} ${baseBranch}`
            : `git checkout -b ${branchName}`;

          await execGitCommand(createCmd);
          result = {
            branch: branchName,
            message: `Created and switched to branch ${branchName}`,
          };
          break;

        case 'switch':
          // Switch to existing branch
          await execGitCommand(`git checkout ${branchName}`);
          result = {
            branch: branchName,
            message: `Switched to branch ${branchName}`,
          };
          break;

        case 'list':
          // List all branches
          const { stdout } = await execGitCommand('git branch -a');
          const branches = stdout
            .split('\n')
            .map((b: string) => b.trim())
            .filter((b: string) => b.length > 0)
            .map((b: string) => ({
              name: b.replace(/^[*+]?\s*/, ''), // Remove current branch marker (*) and worktree marker (+)
              current: b.startsWith('*'),
              remote: b.includes('remotes/'),
            }));

          result = { branches };
          break;

        case 'delete':
          // Delete branch
          const force = params.force ? '-D' : '-d';
          await execGitCommand(`git branch ${force} ${branchName}`);
          result = {
            message: `Deleted branch ${branchName}`,
          };
          break;

        default:
          throw new Error(`Unknown branch operation: ${operation}`);
      }

      // Emit event for branch operations that change state
      if (operation !== 'list') {
        const event = createWorkspaceUpdatedEvent(
          params.workspaceId,
          'git',
          operation === 'delete' ? 'delete' : 'update',
          branchName,
          context.actor,
        );
        this.emit('event', event);
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('Git branch operation failed:', error as Error);
      return {
        success: false,
        error: {
          code: 'GIT_ERROR',
          message: (error as Error).message,
        },
      };
    }
  }

  // ============================================================================
  // File System Handlers
  // ============================================================================

  private async handleFsRead(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    try {
      // Validate and resolve path
      const fullPath = this.resolvePath(context.workspaceId, params.path);
      this.validatePath(context.workspaceId, fullPath);

      // Read file content
      const content = await fs.readFile(fullPath, 'utf-8');

      // Generate version hash
      const version = this.generateVersion(content);

      return {
        success: true,
        data: {
          content,
          path: params.path,
          version,
        },
      };
    } catch (error) {
      logger.error(`Failed to read file ${params.path}:`, error as Error);
      const errnoError = error as NodeJS.ErrnoException;
      return {
        success: false,
        error: {
          code: errnoError.code === 'ENOENT' ? 'NOT_FOUND' : 'READ_ERROR',
          message: (error as Error).message,
        },
      };
    }
  }

  private async handleFsWrite(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    try {
      // Validate and resolve path
      const fullPath = this.resolvePath(context.workspaceId, params.path);
      this.validatePath(context.workspaceId, fullPath);

      // Check version if provided
      if (params.version) {
        try {
          const currentContent = await fs.readFile(fullPath, 'utf-8');
          const currentVersion = this.generateVersion(currentContent);

          if (currentVersion !== params.version) {
            return {
              success: false,
              error: {
                code: 'CONFLICT',
                message: 'File has been modified since last read',
                details: {
                  currentVersion,
                  providedVersion: params.version,
                },
              },
            };
          }
        } catch (error) {
          // File doesn't exist yet, which is fine for new files
          const errnoError = error as NodeJS.ErrnoException;
          if (errnoError.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      // Ensure directory exists
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });

      // Write file
      await fs.writeFile(fullPath, params.content, 'utf-8');

      // Generate new version
      const newVersion = this.generateVersion(params.content);

      // Emit event
      const event = createWorkspaceUpdatedEvent(
        context.workspaceId,
        'file',
        params.version ? 'update' : 'create',
        params.path,
        context.actor,
      );
      this.emit('event', event);

      // Emit real-time content change event for UI streaming
      safeBroadcastToWindows('file:content-changed', {
        path: params.path,
        content: params.content,
        source: context.actor?.type || 'agent',
        workspaceId: context.workspaceId,
      }, context.workspaceId);

      // Emit agent file change event to trigger immediate CodeChangesPanel update
      emitAgentFileChange(context.workspaceId, params.path);

      return {
        success: true,
        data: {
          path: params.path,
          version: newVersion,
        },
      };
    } catch (error) {
      logger.error(`Failed to write file ${params.path}:`, error as Error);
      return {
        success: false,
        error: {
          code: 'WRITE_ERROR',
          message: (error as Error).message,
        },
      };
    }
  }

  private async handleFsApplyPatch(
    params: any,
    context: BridgeCallContext,
  ): Promise<BridgeResponse> {
    try {
      // Validate and resolve path
      const fullPath = this.resolvePath(context.workspaceId, params.path);
      this.validatePath(context.workspaceId, fullPath);

      // Read current content
      const currentContent = await fs.readFile(fullPath, 'utf-8');

      // Check version if provided
      if (params.version) {
        const currentVersion = this.generateVersion(currentContent);
        if (currentVersion !== params.version) {
          return {
            success: false,
            error: {
              code: 'CONFLICT',
              message: 'File has been modified since last read',
              details: {
                currentVersion,
                providedVersion: params.version,
              },
            },
          };
        }
      }

      // Apply patch (simple line-based replacement for now)
      let newContent = currentContent;
      const lines = currentContent.split('\n');

      if (params.patch.type === 'replace') {
        const { startLine, endLine, content } = params.patch;
        const newLines = [
          ...lines.slice(0, startLine - 1),
          ...content.split('\n'),
          ...lines.slice(endLine),
        ];
        newContent = newLines.join('\n');
      } else {
        throw new Error(`Unsupported patch type: ${params.patch.type}`);
      }

      // Write updated content
      await fs.writeFile(fullPath, newContent, 'utf-8');

      // Generate new version
      const newVersion = this.generateVersion(newContent);

      // Emit event
      const event = createWorkspaceUpdatedEvent(
        context.workspaceId,
        'file',
        'update',
        params.path,
        context.actor,
      );
      this.emit('event', event);

      // Emit real-time content change event for UI streaming
      safeBroadcastToWindows('file:content-changed', {
        path: params.path,
        content: newContent,
        source: context.actor?.type || 'agent',
        workspaceId: context.workspaceId,
      }, context.workspaceId);

      // Emit agent file change event to trigger immediate CodeChangesPanel update
      emitAgentFileChange(context.workspaceId, params.path);

      return {
        success: true,
        data: {
          path: params.path,
          version: newVersion,
        },
      };
    } catch (error) {
      logger.error(`Failed to apply patch to ${params.path}:`, error as Error);
      const errnoError = error as NodeJS.ErrnoException;
      return {
        success: false,
        error: {
          code: errnoError.code === 'ENOENT' ? 'NOT_FOUND' : 'PATCH_ERROR',
          message: (error as Error).message,
        },
      };
    }
  }

  private async handleFsDelete(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    try {
      // Validate and resolve path
      const fullPath = this.resolvePath(context.workspaceId, params.path);
      this.validatePath(context.workspaceId, fullPath);

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `File not found: ${params.path}`,
          },
        };
      }

      // Check if it's a file (not a directory)
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        return {
          success: false,
          error: {
            code: 'IS_DIRECTORY',
            message: `Cannot delete directory with this method: ${params.path}`,
          },
        };
      }

      // Delete the file
      await fs.unlink(fullPath);

      // Emit event
      const event = createWorkspaceUpdatedEvent(
        context.workspaceId,
        'file',
        'delete',
        this.generateVersion({ path: params.path }),
        context.actor,
        params.path,
      );
      this.emit('event', event);

      // Emit real-time deletion event for UI streaming
      safeBroadcastToWindows(`file:deleted:${context.workspaceId}`, {
        path: params.path,
        source: context.actor?.type || 'agent',
        workspaceId: context.workspaceId,
      }, context.workspaceId);

      // Emit agent file change event to trigger immediate CodeChangesPanel update
      emitAgentFileChange(context.workspaceId, params.path);

      return {
        success: true,
        data: {
          path: params.path,
          deleted: true,
        },
      };
    } catch (error) {
      logger.error(`Failed to delete file ${params.path}:`, error as Error);
      return {
        success: false,
        error: {
          code: 'DELETE_ERROR',
          message: (error as Error).message,
        },
      };
    }
  }

  private async handleFsRename(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    try {
      // Validate and resolve paths
      const fullOldPath = this.resolvePath(context.workspaceId, params.oldPath);
      const fullNewPath = this.resolvePath(context.workspaceId, params.newPath);
      this.validatePath(context.workspaceId, fullOldPath);
      this.validatePath(context.workspaceId, fullNewPath);

      // Check if source exists
      try {
        await fs.access(fullOldPath);
      } catch {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Source file not found: ${params.oldPath}`,
          },
        };
      }

      // Check if destination already exists
      try {
        await fs.access(fullNewPath);
        return {
          success: false,
          error: {
            code: 'ALREADY_EXISTS',
            message: `Destination already exists: ${params.newPath}`,
          },
        };
      } catch {
        // Destination doesn't exist, good to proceed
      }

      // Create destination directory if needed
      const newDir = path.dirname(fullNewPath);
      await fs.mkdir(newDir, { recursive: true });

      // Check if source is a directory
      const stats = await fs.stat(fullOldPath);
      const isDirectory = stats.isDirectory();

      // Read content before moving (for streaming) - only for files, not directories
      let content: string | null = null;
      if (!isDirectory) {
        content = await fs.readFile(fullOldPath, 'utf-8');
      }

      // Rename/move the file or directory
      await fs.rename(fullOldPath, fullNewPath);

      // Emit events - always use 'file' as resource type (the valid types are 'workspace' | 'note' | 'file' | 'git')
      const deleteEvent = createWorkspaceUpdatedEvent(
        context.workspaceId,
        'file',
        'delete',
        this.generateVersion({ path: params.oldPath }),
        context.actor,
        params.oldPath,
      );
      this.emit('event', deleteEvent);

      const createEvent = createWorkspaceUpdatedEvent(
        context.workspaceId,
        'file',
        'create',
        this.generateVersion({ path: params.newPath }),
        context.actor,
        params.newPath,
      );
      this.emit('event', createEvent);

      // Emit real-time events for UI streaming
      if (isDirectory) {
        // For directories, emit directory events
        safeBroadcastToWindows(`directory:deleted:${context.workspaceId}`, {
          path: params.oldPath,
          source: context.actor?.type || 'agent',
          workspaceId: context.workspaceId,
        }, context.workspaceId);
        safeBroadcastToWindows(`directory:created:${context.workspaceId}`, {
          path: params.newPath,
          source: context.actor?.type || 'agent',
          workspaceId: context.workspaceId,
        }, context.workspaceId);
      } else {
        // For files, emit file events with content
        safeBroadcastToWindows(`file:deleted:${context.workspaceId}`, {
          path: params.oldPath,
          source: context.actor?.type || 'agent',
          workspaceId: context.workspaceId,
        }, context.workspaceId);
        safeBroadcastToWindows('file:content-changed', {
          path: params.newPath,
          content,
          source: context.actor?.type || 'agent',
          workspaceId: context.workspaceId,
        }, context.workspaceId);
      }

      // Emit agent file change event to trigger immediate CodeChangesPanel update
      // For directories, this triggers a git sync which will detect all file changes
      emitAgentFileChange(context.workspaceId, params.newPath);

      return {
        success: true,
        data: {
          oldPath: params.oldPath,
          newPath: params.newPath,
          renamed: true,
        },
      };
    } catch (error) {
      logger.error('Failed to rename file:', error as Error);
      return {
        success: false,
        error: {
          code: 'RENAME_ERROR',
          message: (error as Error).message,
        },
      };
    }
  }

  private async handleFsMkdir(params: any, context: BridgeCallContext): Promise<BridgeResponse> {
    try {
      // Validate and resolve path
      const fullPath = this.resolvePath(context.workspaceId, params.path);
      this.validatePath(context.workspaceId, fullPath);

      // Check if already exists
      try {
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          return {
            success: true,
            data: {
              path: params.path,
              existed: true,
            },
          };
        } else {
          return {
            success: false,
            error: {
              code: 'EXISTS_NOT_DIR',
              message: `Path exists but is not a directory: ${params.path}`,
            },
          };
        }
      } catch {
        // Directory doesn't exist, proceed with creation
      }

      // Create the directory
      await fs.mkdir(fullPath, { recursive: params.recursive !== false });

      // Emit event
      const event = createWorkspaceUpdatedEvent(
        context.workspaceId,
        'file',
        'create',
        this.generateVersion({ path: params.path }),
        context.actor,
        params.path,
      );
      this.emit('event', event);

      // Emit real-time event for UI streaming
      safeBroadcastToWindows(`directory:created:${context.workspaceId}`, {
        path: params.path,
        source: context.actor?.type || 'agent',
        workspaceId: context.workspaceId,
      }, context.workspaceId);

      return {
        success: true,
        data: {
          path: params.path,
          created: true,
        },
      };
    } catch (error) {
      logger.error(`Failed to create directory ${params.path}:`, error as Error);
      return {
        success: false,
        error: {
          code: 'MKDIR_ERROR',
          message: (error as Error).message,
        },
      };
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private generateVersion(data: any): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex').substring(0, 8);
  }

  private async checkVersion(
    resourceType: string,
    resourceId: string,
    providedVersion?: string,
  ): Promise<void> {
    if (!providedVersion) {
      return; // No version check requested
    }

    const key = `${resourceType}:${resourceId}`;
    const currentVersion = this.versionStore.get(key);

    if (currentVersion && currentVersion !== providedVersion) {
      const error: any = new Error('Version conflict: Resource has been modified since last read');
      error.code = 'VERSION_CONFLICT';
      error.currentVersion = currentVersion;
      throw error;
    }
  }

  private updateVersion(resourceType: string, resourceId: string, version: string): void {
    const key = `${resourceType}:${resourceId}`;
    this.versionStore.set(key, version);

    // Clean up old versions periodically (keep last 1000)
    if (this.versionStore.size > 1000) {
      const entries = Array.from(this.versionStore.entries());
      const toDelete = entries.slice(0, entries.length - 1000);
      toDelete.forEach(([key]) => this.versionStore.delete(key));
    }
  }

  private validatePath(workspaceId: string, requestedPath: string): void {
    const workspacePath = this.getWorkspacePath(workspaceId);

    // Normalize and resolve the full path
    const normalizedPath = path.normalize(requestedPath);
    const resolvedPath = path.resolve(workspacePath, normalizedPath);

    // Check if path is within workspace boundaries
    if (!resolvedPath.startsWith(workspacePath)) {
      throw new Error(`Path traversal not allowed: ${requestedPath} resolves outside workspace`);
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /\.\.[\\/]/, // Path traversal
      /^[\\/]/, // Absolute paths (outside workspace)
      /~[\\/]/, // Home directory reference
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(requestedPath)) {
        throw new Error(`Invalid path pattern: ${requestedPath}`);
      }
    }
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.idempotencyCleanupInterval) {
      clearInterval(this.idempotencyCleanupInterval);
      this.idempotencyCleanupInterval = null;
    }
  }

  private cleanupIdempotencyStore(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    // Find entries older than TTL
    for (const [key, entry] of this.idempotencyStore) {
      if (now - entry.timestamp > this.idempotencyTTL) {
        entriesToDelete.push(key);
      }
    }

    // Delete old entries
    if (entriesToDelete.length > 0) {
      entriesToDelete.forEach((key) => this.idempotencyStore.delete(key));
      logger.debug(`Cleaned up ${entriesToDelete.length} old idempotency entries`);
    }
  }

  private resolvePath(workspaceId: string, filePath: string): string {
    const workspacePath = this.getWorkspacePath(workspaceId);
    return path.resolve(workspacePath, filePath);
  }

  private getWorkspacePath(workspaceId: string): string {
    return WorkspaceConfig.paths.workspace(workspaceId);
  }

}

import type { WorkspaceId } from '$shared/types/branded-ids';
/**
 * Tool Service
 *
 * Main service for executing workspace tools.
 * Protocol-agnostic implementation of all tool operations.
 */

import type {
  IToolService,
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolOperation,
  FileInfo,
  NoteData,
  Note,
  WorkspaceInfo,
  ExecuteOptions,
} from './types';
import {
  ToolCategory,
  ToolError,
  Tool,
} from './types';
import type { CommandResult } from '../types';
import { WorkspaceService } from '../../workspace/main/workspace.service';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { Logger } from '../../../shared/logger';
import { executionManager } from './execution-manager';
import * as path from 'path';
import * as fs from 'fs/promises';

const logger = new Logger('ToolService');

export class ToolService implements IToolService {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(
    private workspaceService: WorkspaceService = new WorkspaceService(),
  ) {
    this.registerBuiltinTools();
  }

  /**
   * Register built-in tool definitions
   */
  private registerBuiltinTools(): void {
    // File tools
    this.registerTool({
      id: 'readFile',
      name: 'readFile',
      description: 'Read the contents of a file',
      category: ToolCategory.FILE,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: null }),
      config: {
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace' },
          },
          required: ['path'],
        },
      },
      permissions: {
        requiresWrite: false,
      },
    });

    this.registerTool({
      id: 'writeFile',
      name: 'writeFile',
      description: 'Write content to a file',
      category: ToolCategory.FILE,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: null }),
      config: {
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace' },
            content: { type: 'string', description: 'File content' },
          },
          required: ['path', 'content'],
        },
      },
      permissions: {
        requiresWrite: true,
      },
    });

    this.registerTool({
      id: 'deleteFile',
      name: 'deleteFile',
      description: 'Delete a file',
      category: ToolCategory.FILE,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: null }),
      config: {
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace' },
          },
          required: ['path'],
        },
      },
      permissions: {
        requiresWrite: true,
      },
    });

    this.registerTool({
      id: 'listFiles',
      name: 'listFiles',
      description: 'List files in a directory',
      category: ToolCategory.FILE,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: [] }),
      config: {
        inputSchema: {
          type: 'object',
          properties: {
            directory: { type: 'string', description: 'Directory path relative to workspace' },
          },
          required: ['directory'],
        },
      },
    });

    // Note tools
    this.registerTool({
      id: 'createNote',
      name: 'createNote',
      description: 'Create a new note in the workspace',
      category: ToolCategory.NOTE,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: { id: 'note-1' } }),
      config: {
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'content'],
        },
      },
      permissions: {
        requiresWrite: true,
      },
    });

    this.registerTool({
      id: 'updateNote',
      name: 'updateNote',
      description: 'Update an existing note',
      category: ToolCategory.NOTE,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: { updated: true } }),
      config: {
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['noteId'],
        },
      },
      permissions: {
        requiresWrite: true,
      },
    });

    this.registerTool({
      id: 'listNotes',
      name: 'listNotes',
      description: 'List all notes in the workspace',
      category: ToolCategory.NOTE,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: [] }),
    });

    // Workspace tools
    this.registerTool({
      id: 'getWorkspaceInfo',
      name: 'getWorkspaceInfo',
      description: 'Get information about the current workspace',
      category: ToolCategory.WORKSPACE,
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: { workspaceId: context.workspaceId } }),
    });

    this.registerTool({
      id: 'executeCommand',
      name: 'executeCommand',
      description: 'Execute a shell command in the workspace',
      category: ToolCategory.TERMINAL,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (context: ToolContext) =>
        // Implementation would go here
        ({ success: true, data: { output: '' } }),
      config: {
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeout: { type: 'number' },
          },
          required: ['command'],
        },
      },
      permissions: {
        requiresWrite: false,
      },
    });

    logger.info('Registered built-in tools', { count: this.tools.size });
  }

  /**
   * Register a tool definition
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Check if operation is permitted
   */
  private checkPermissions(context: ToolContext, tool: ToolDefinition, args?: any): void {
    const permissions = context.permissions;

    logger.debug('checkPermissions called', {
      toolName: tool.name,
      hasPermissions: !!permissions,
      readOnly: permissions?.readOnly,
      requiresWrite: tool.permissions?.requiresWrite,
    });

    // Check if tool is denied
    if (permissions?.deniedTools?.includes(tool.name)) {
      throw new Error(`Tool ${tool.name} is denied`);
    }

    // Check if tool is allowed (if allowlist is specified)
    if (
      permissions?.allowedTools &&
      permissions.allowedTools.length > 0 &&
      !permissions.allowedTools.includes(tool.name)
    ) {
      throw new Error(`Tool ${tool.name} is not allowed`);
    }

    // Check read-only mode
    if (permissions?.readOnly && tool.permissions?.requiresWrite) {
      logger.debug('Throwing read-only error', {
        toolName: tool.name,
        readOnly: permissions.readOnly,
        requiresWrite: tool.permissions.requiresWrite,
      });
      throw new Error(`Cannot use ${tool.name} in read-only mode`);
    }

    // Check path restrictions for file operations
    if (tool.category === 'file' && args?.path) {
      const filePath = args.path;

      // Check denied paths
      if (permissions?.deniedPaths) {
        for (const deniedPath of permissions.deniedPaths) {
          if (filePath.startsWith(deniedPath)) {
            throw new Error(`Access denied to path: ${filePath}`);
          }
        }
      }

      // Check allowed paths (if specified)
      if (permissions?.allowedPaths && permissions.allowedPaths.length > 0) {
        let allowed = false;
        for (const allowedPath of permissions.allowedPaths) {
          if (filePath.startsWith(allowedPath)) {
            allowed = true;
            break;
          }
        }
        if (!allowed) {
          throw new Error(`Path not in allowed list: ${filePath}`);
        }
      }
    }
  }

  /**
   * Look up a registered tool definition, throwing if it is missing.
   */
  private getToolOrThrow(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`${name} tool not found`);
    }
    return tool;
  }

  /**
   * Get the executor from a tool context, throwing if it is not provided.
   */
  private getExecutorOrThrow(context: ToolContext): NonNullable<ToolContext['executor']> {
    if (!context.executor) {
      throw new Error('No executor provided in context');
    }
    return context.executor;
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  async readFile(context: ToolContext, filePath: string): Promise<string> {
    this.checkPermissions(context, this.getToolOrThrow('readFile'), { path: filePath });

    logger.debug('Reading file', {
      workspaceId: context.workspaceId as WorkspaceId,
      path: filePath,
    });

    const executor = this.getExecutorOrThrow(context);
    return await executionManager.executeWithRetry(() => executor.readFile(filePath));
  }

  async writeFile(context: ToolContext, filePath: string, content: string): Promise<void> {
    const tool = this.tools.get('writeFile');
    if (!tool) {
      throw new Error('writeFile tool not found');
    }

    // Check permissions first - this should throw if in read-only mode
    this.checkPermissions(context, tool, { path: filePath });

    // Check file size limit
    if (context.permissions?.maxFileSize && content.length > context.permissions.maxFileSize) {
      throw new Error(`File size exceeds limit of ${context.permissions.maxFileSize} bytes`);
    }

    // Check if executor exists
    const executor = this.getExecutorOrThrow(context);

    logger.debug('Writing file', {
      workspaceId: context.workspaceId as WorkspaceId,
      path: filePath,
      size: content.length,
    });

    await executionManager.executeWithRetry(() => executor.writeFile(filePath, content));
  }

  async deleteFile(context: ToolContext, filePath: string): Promise<void> {
    this.checkPermissions(context, this.getToolOrThrow('deleteFile'), { path: filePath });

    logger.debug('Deleting file', {
      workspaceId: context.workspaceId as WorkspaceId,
      path: filePath,
    });

    const executor = this.getExecutorOrThrow(context);
    await executionManager.executeWithRetry(() => executor.deleteFile(filePath));
  }

  async listFiles(context: ToolContext, directory: string): Promise<FileInfo[]> {
    this.checkPermissions(context, this.getToolOrThrow('listFiles'), { path: directory });

    logger.debug('Listing files', {
      workspaceId: context.workspaceId as WorkspaceId,
      directory,
    });

    const executor = this.getExecutorOrThrow(context);
    const files = await executionManager.executeWithRetry(() =>
      executor.listFiles(directory),
    );
    return files.map((file: string) => ({
      name: file,
      path: file,
      type: 'file' as const,
    }));
  }

  // ============================================================================
  // Note Operations
  // ============================================================================

  async createNote(context: ToolContext, noteData: NoteData): Promise<Note> {
    this.checkPermissions(context, this.getToolOrThrow('createNote'));

    logger.debug('Creating note', {
      workspaceId: context.workspaceId,
      title: noteData.title,
    });

    let created: any;
    try {
      const result = await getBackendClient().request<{ note: any }>('note.create', {
        workspaceId: context.workspaceId,
        title: noteData.title || 'Untitled Note',
        ...(noteData.content !== undefined ? { content: noteData.content } : {}),
      });
      created = result?.note ?? null;
    } catch (error) {
      throw new Error((error as Error).message);
    }
    if (!created) {
      throw new Error('Failed to create note');
    }

    return {
      ...created,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }
  async updateNote(
    context: ToolContext,
    noteId: string,
    updates: Partial<NoteData>,
  ): Promise<Note> {
    this.checkPermissions(context, this.getToolOrThrow('updateNote'));

    logger.debug('Updating note', {
      workspaceId: context.workspaceId,
      noteId,
    });

    // Filter out id from updates to avoid type conflicts

    const { id: _, ...updateFields } = updates;

    const daemonParams: Record<string, unknown> = {
      workspaceId: context.workspaceId,
      noteId,
    };
    if ((updateFields as any).title !== undefined) daemonParams.title = (updateFields as any).title;
    if ((updateFields as any).content !== undefined) daemonParams.content = (updateFields as any).content;
    if ((updateFields as any).tags !== undefined) daemonParams.tags = (updateFields as any).tags;

    let updated: any;
    try {
      const result = await getBackendClient().request<{ note: any }>('note.update', daemonParams);
      updated = result?.note ?? null;
    } catch (error) {
      throw new Error((error as Error).message);
    }
    if (!updated) {
      throw new Error('Failed to update note');
    }

    return {
      ...updated,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteNote(context: ToolContext, noteId: string): Promise<void> {
    this.checkPermissions(context, this.getToolOrThrow('deleteNote'));

    logger.debug('Deleting note', {
      workspaceId: context.workspaceId as WorkspaceId,
      noteId,
    });

    try {
      await getBackendClient().request('note.delete', {
        workspaceId: context.workspaceId,
        noteId,
      });
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }

  async listNotes(context: ToolContext): Promise<Note[]> {
    this.checkPermissions(context, this.getToolOrThrow('listNotes'));

    logger.debug('Listing notes', {
      workspaceId: context.workspaceId,
    });

    let notes: any[];
    try {
      const result = await getBackendClient().request<{ notes: any[] }>('note.list', {
        workspaceId: context.workspaceId,
      });
      notes = Array.isArray(result?.notes) ? result.notes : [];
    } catch (error) {
      throw new Error((error as Error).message);
    }

    return notes.map((note: any) => ({
      ...note,
      createdAt: new Date(note.createdAt),
      updatedAt: new Date(note.updatedAt),
    }));
  }

  async readNote(context: ToolContext, noteId: string): Promise<Note> {
    this.checkPermissions(context, this.getToolOrThrow('readNote'));

    logger.debug('Reading note', {
      workspaceId: context.workspaceId,
      noteId,
    });

    let note: any;
    try {
      const result = await getBackendClient().request<{ note: any }>('note.get', {
        workspaceId: context.workspaceId,
        noteId,
      });
      note = result?.note ?? null;
    } catch (error) {
      throw new Error((error as Error).message);
    }
    if (!note) {
      throw new Error('Note not found');
    }

    return {
      ...note,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async countFiles(dirPath: string): Promise<number> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      let count = 0;

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip hidden files and common ignore patterns
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'build'
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          count += await this.countFiles(fullPath);
        } else if (entry.isFile()) {
          count++;
        }
      }

      return count;
    } catch (error) {
      logger.debug('Error counting files', { dirPath, error });
      return 0;
    }
  }

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      let totalSize = 0;

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip hidden files and common ignore patterns
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'build'
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
          } catch {
            // Ignore files we can't stat
          }
        }
      }

      return totalSize;
    } catch (error) {
      logger.debug('Error calculating directory size', { dirPath, error });
      return 0;
    }
  }

  // ============================================================================
  // Workspace Operations
  // ============================================================================

  async getWorkspaceInfo(context: ToolContext): Promise<WorkspaceInfo> {
    this.checkPermissions(context, this.getToolOrThrow('getWorkspaceInfo'));

    logger.debug('Getting workspace info', {
      workspaceId: context.workspaceId as WorkspaceId,
    });

    const result = await this.workspaceService.getWorkspace(context.workspaceId as WorkspaceId);

    if (!result.ok) {
      throw new Error(result.error);
    }

    const workspace = result.data;
    const workspacePath = workspace.worktreePath || workspace.repositoryPath || '';

    // Get file count and size
    let fileCount = 0;
    let totalSize = 0;
    if (workspacePath) {
      fileCount = await this.countFiles(workspacePath);
      totalSize = await this.calculateDirectorySize(workspacePath);
    }

    // Get note count
    let noteCount = 0;
    try {
      const result = await getBackendClient().request<{ notes: any[] }>('note.list', {
        workspaceId: context.workspaceId,
      });
      noteCount = Array.isArray(result?.notes) ? result.notes.length : 0;
    } catch (error) {
      logger.debug('Error getting note count', { error });
    }

    return {
      id: workspace.id,
      name: workspace.name || workspace.id,
      path: workspacePath,
      repositoryPath: workspace.repositoryPath,
      branch: workspace.branch,
      isRemote: workspace.environmentConfig?.type === 'remote',
      status: (workspace.status as any) || 'active',
      fileCount,
      noteCount,
      totalSize,
    };
  }

  async executeCommand(
    context: ToolContext,
    command: string,
    options?: ExecuteOptions,
  ): Promise<CommandResult> {
    this.checkPermissions(context, this.getToolOrThrow('executeCommand'));

    logger.debug('Executing command', {
      workspaceId: context.workspaceId as WorkspaceId,
      command: command.substring(0, 100),
    });

    const executor = this.getExecutorOrThrow(context);
    return await executionManager.executeWithRetry(() =>
      executor.execute(command, options),
    );
  }

  // ============================================================================
  // Tool Management
  // ============================================================================

  async listTools(): Promise<ToolDefinition[]> {
    return Array.from(this.tools.values());
  }

  async getTool(name: string): Promise<ToolDefinition | null> {
    return this.tools.get(name) || null;
  }

  getAvailableTools(): Tool[] {
    return Array.from(this.tools.values()).map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      enabled: true,
    }));
  }

  async executeTool(name: string, args: any, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      // Check permissions
      this.checkPermissions(context, tool, args);

      // Execute tool based on name
      let result: any;

      switch (name) {
        case 'readFile':
          result = await this.readFile(context, args.path);
          break;
        case 'writeFile':
          await this.writeFile(context, args.path, args.content);
          result = { success: true };
          break;
        case 'deleteFile':
          await this.deleteFile(context, args.path);
          result = { success: true };
          break;
        case 'listFiles':
          result = await this.listFiles(context, args.directory || '.');
          break;
        case 'createNote':
          result = await this.createNote(context, args);
          break;
        case 'updateNote':
          result = await this.updateNote(context, args.noteId, args);
          break;
        case 'deleteNote':
          await this.deleteNote(context, args.noteId);
          result = { success: true };
          break;
        case 'listNotes':
          result = await this.listNotes(context);
          break;
        case 'readNote':
          result = await this.readNote(context, args.noteId);
          break;
        case 'getWorkspaceInfo':
          result = await this.getWorkspaceInfo(context);
          break;
        case 'executeCommand':
          result = await this.executeCommand(context, args.command, args.options);
          break;
        default:
          throw new Error(`Tool ${name} not implemented`);
      }

      return {
        success: true,
        data: result,
        metadata: {
          executionTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      logger.error(`Tool execution failed: ${name}`, error as Error);

      const err = error as Error & { code?: string };
      const toolError = new ToolError(err.message || 'Unknown error', err.code || 'TOOL_ERROR');

      return {
        success: false,
        error: toolError.message || 'Unknown error',
        metadata: {
          executionTime: Date.now() - startTime,
        },
      };
    }
  }

  async executeBatch(operations: ToolOperation[], context: ToolContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const operation of operations) {
      // Merge operation context with base context
      const opContext = {
        ...context,
        ...operation.context,
      };

      const result = await this.executeTool(operation.tool, operation.args, opContext);

      results.push(result);

      // Stop on error if not configured to continue
      if (!result.success) {
        break;
      }
    }

    return results;
  }
}

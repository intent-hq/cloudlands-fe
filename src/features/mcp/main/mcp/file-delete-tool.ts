/**
 * File deletion tool for workspace MCP.
 * Supports both local and remote workspaces via the IFileSystemAdapter interface.
 */

import * as Diff from 'diff';
import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';
import { ToolCall, ToolResult } from './protocol';
import { Logger } from '../../../../shared/logger';
import { trackFileOperation, emitAgentFileChange } from './workspace-tools';
import { type IFileSystemAdapter, LocalFileSystemAdapter } from './file-system-adapter';

const logger = new Logger('DeleteFileTool');

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

/**
 * Tool to delete a file from the workspace.
 * Supports both local and remote workspaces via the IFileSystemAdapter interface.
 */
export class DeleteFileTool extends BaseMCPTool {
  private workspaceId: string;
  private fsAdapter: IFileSystemAdapter;

  constructor(workspacePath: string, workspaceId: string, fsAdapter?: IFileSystemAdapter) {
    super(
      'delete_file',
      'Delete a file from the workspace. Use with caution - this permanently removes the file.',
      createInputSchema(
        {
          path: stringProperty('The path to the file to delete (relative to workspace root)'),
          confirm: stringProperty("Type 'DELETE' to confirm the deletion"),
        },
        ['path', 'confirm'],
      ),
    );
    this.workspaceId = workspaceId;
    this.fsAdapter = fsAdapter || new LocalFileSystemAdapter(workspacePath);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const filePath = call.arguments.path as string;
      const confirm = call.arguments.confirm as string;

      if (!filePath) {
        return this.error('File path is required');
      }

      // Optional safety check - require confirmation
      if (confirm !== 'DELETE') {
        return this.error(
          "Deletion not confirmed. Set 'confirm' to 'DELETE' to proceed with file deletion.",
        );
      }

      // Use the adapter for path validation
      if (!this.fsAdapter.isWithinWorkspace(filePath)) {
        return this.error('Access denied: path outside workspace');
      }

      // Check if file exists
      const exists = await this.fsAdapter.exists(filePath);
      if (!exists) {
        return this.error(`File not found: ${filePath}`);
      }

      // Check if it's a file (not a directory)
      const isDir = await this.fsAdapter.isDirectory(filePath);
      if (isDir) {
        return this.error(`Cannot delete directory with this tool: ${filePath}`);
      }

      // Read file content before deleting so we can generate a diff for the activity log
      let oldContent = '';
      try {
        oldContent = await this.fsAdapter.readFile(filePath);
      } catch {
        // If we can't read content, proceed without diff
      }

      // Delete the file
      await this.fsAdapter.deleteFile(filePath);

      // Track this file operation for provenance
      trackFileOperation(this.workspaceId, filePath, 'delete');

      // Emit real-time deletion event for UI streaming
      safeBroadcastToWindows(`file:deleted:${this.workspaceId}`, {
        path: filePath,
        source: 'agent',
        workspaceId: this.workspaceId,
      }, this.workspaceId);

      // Emit agent file change event to trigger immediate CodeChangesPanel update
      emitAgentFileChange(this.workspaceId, filePath);

      // Emit file:deleted event to activity log with diff data
      try {
        const { getWorkspaceEventService } = await import('../../../events/main');
        const eventService = getWorkspaceEventService(this.workspaceId);
        const agentInfo = (call as any).metadata?.agent || { id: 'agent', name: 'Agent' };

        // Generate unified diff showing all lines removed
        let patch: string | undefined;
        let deletionCount = 0;
        try {
          patch = Diff.createPatch(filePath, oldContent, '', '', '', { context: 3 });
          for (const line of patch.split('\n')) {
            if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) continue;
            if (line.startsWith('-')) deletionCount++;
          }
        } catch {
          // If diff generation fails, emit without diff
        }

        eventService.emitFileChange(filePath, 'delete', {
          diff: patch,
          additions: 0,
          deletions: deletionCount,
          actor: {
            type: 'agent' as const,
            id: agentInfo.id || 'agent',
            name: agentInfo.name || 'Agent',
          },
        });
      } catch (err) {
        logger.warn('Failed to emit file delete to activity log', { error: err });
      }

      return this.success(`File deleted successfully: ${filePath}`, {
        path: filePath,
        deleted: true,
      });
    } catch (error) {
      return this.error(`Failed to delete file: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to create a directory in the workspace.
 * Supports both local and remote workspaces via the IFileSystemAdapter interface.
 */
export class CreateDirectoryTool extends BaseMCPTool {
  private workspaceId: string;
  private fsAdapter: IFileSystemAdapter;

  constructor(workspacePath: string, workspaceId: string, fsAdapter?: IFileSystemAdapter) {
    super(
      'create_directory',
      'Create a directory in the workspace',
      createInputSchema(
        {
          path: stringProperty('The path to the directory to create (relative to workspace root)'),
          recursive: stringProperty("Create parent directories if they don't exist (true/false)", {
            default: 'true',
          }),
        },
        ['path'],
      ),
    );
    this.workspaceId = workspaceId;
    this.fsAdapter = fsAdapter || new LocalFileSystemAdapter(workspacePath);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const dirPath = call.arguments.path as string;

      if (!dirPath) {
        return this.error('Directory path is required');
      }

      // Use the adapter for path validation
      if (!this.fsAdapter.isWithinWorkspace(dirPath)) {
        return this.error('Access denied: path outside workspace');
      }

      // Check if directory already exists
      const exists = await this.fsAdapter.exists(dirPath);
      if (exists) {
        const isDir = await this.fsAdapter.isDirectory(dirPath);
        if (isDir) {
          return this.success(`Directory already exists: ${dirPath}`, {
            path: dirPath,
            existed: true,
          });
        } else {
          return this.error(`Path exists but is not a directory: ${dirPath}`);
        }
      }

      // Create the directory (adapter handles recursive creation)
      await this.fsAdapter.createDirectory(dirPath);

      // Emit real-time directory creation event for UI streaming
      safeBroadcastToWindows(`directory:created:${this.workspaceId}`, {
        path: dirPath,
        source: 'agent',
        workspaceId: this.workspaceId,
      }, this.workspaceId);

      return this.success(`Directory created successfully: ${dirPath}`, {
        path: dirPath,
        created: true,
      });
    } catch (error) {
      return this.error(`Failed to create directory: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to rename/move a file in the workspace.
 * Supports both local and remote workspaces via the IFileSystemAdapter interface.
 */
export class RenameFileTool extends BaseMCPTool {
  private workspaceId: string;
  private fsAdapter: IFileSystemAdapter;

  constructor(workspacePath: string, workspaceId: string, fsAdapter?: IFileSystemAdapter) {
    super(
      'rename_file',
      'Rename or move a file within the workspace',
      createInputSchema(
        {
          oldPath: stringProperty('The current path of the file (relative to workspace root)'),
          newPath: stringProperty('The new path for the file (relative to workspace root)'),
        },
        ['oldPath', 'newPath'],
      ),
    );
    this.workspaceId = workspaceId;
    this.fsAdapter = fsAdapter || new LocalFileSystemAdapter(workspacePath);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const oldPath = call.arguments.oldPath as string;
      const newPath = call.arguments.newPath as string;

      if (!oldPath || !newPath) {
        return this.error('Both oldPath and newPath are required');
      }

      // Use the adapter for path validation
      if (
        !this.fsAdapter.isWithinWorkspace(oldPath) ||
        !this.fsAdapter.isWithinWorkspace(newPath)
      ) {
        return this.error('Access denied: path outside workspace');
      }

      // Check if source file exists
      const sourceExists = await this.fsAdapter.exists(oldPath);
      if (!sourceExists) {
        return this.error(`Source file not found: ${oldPath}`);
      }

      // Check if destination already exists
      const destExists = await this.fsAdapter.exists(newPath);
      if (destExists) {
        return this.error(`Destination already exists: ${newPath}`);
      }

      // Check if source is a directory
      const isDirectory = await this.fsAdapter.isDirectory(oldPath);

      // Read the file content before moving (only for files, not directories)
      let content: string | null = null;
      if (!isDirectory) {
        content = await this.fsAdapter.readFile(oldPath);
      }

      // Rename/move the file or directory using the adapter
      await this.fsAdapter.renameFile(oldPath, newPath);

      // Track file operations for provenance
      trackFileOperation(this.workspaceId, oldPath, 'delete');
      trackFileOperation(this.workspaceId, newPath, 'write');

      // Emit real-time events for UI streaming
      if (isDirectory) {
        // For directories, emit directory events
        safeBroadcastToWindows(`directory:deleted:${this.workspaceId}`, {
          path: oldPath,
          source: 'agent',
          workspaceId: this.workspaceId,
        }, this.workspaceId);
        safeBroadcastToWindows(`directory:created:${this.workspaceId}`, {
          path: newPath,
          source: 'agent',
          workspaceId: this.workspaceId,
        }, this.workspaceId);
      } else {
        // For files, emit file events with content
        safeBroadcastToWindows(`file:deleted:${this.workspaceId}`, {
          path: oldPath,
          source: 'agent',
          workspaceId: this.workspaceId,
        }, this.workspaceId);
        safeBroadcastToWindows(`file:content-changed:${this.workspaceId}`, {
          path: newPath,
          content,
          source: 'agent',
          workspaceId: this.workspaceId,
        }, this.workspaceId);
      }

      // Emit agent file change event to trigger immediate CodeChangesPanel update
      // For directories, this triggers a git sync which will detect all file changes
      emitAgentFileChange(this.workspaceId, newPath);

      // Emit file:renamed event to activity log
      try {
        const { getWorkspaceEventService } = await import('../../../events/main');
        const eventService = getWorkspaceEventService(this.workspaceId);
        const agentInfo = (call as any).metadata?.agent || { id: 'agent', name: 'Agent' };
        eventService.emitFileChange(newPath, 'rename', {
          oldPath,
          actor: {
            type: 'agent' as const,
            id: agentInfo.id || 'agent',
            name: agentInfo.name || 'Agent',
          },
        });
      } catch (err) {
        logger.warn('Failed to emit rename to activity log', { error: err });
      }

      const itemType = isDirectory ? 'Directory' : 'File';
      return this.success(`${itemType} renamed successfully: ${oldPath} -> ${newPath}`, {
        oldPath,
        newPath,
        renamed: true,
        isDirectory,
      });
    } catch (error) {
      return this.error(`Failed to rename file: ${(error as Error).message}`);
    }
  }
}

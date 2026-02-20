/**
 * Workspace file operation + file IO MCP tools.
 *
 * Split out of workspace-tools.ts to keep that module focused on notes/tasks/etc.
 * Supports both local and remote workspaces via the IFileSystemAdapter interface.
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import * as fs from 'fs/promises';
import * as Diff from 'diff';
import { Logger } from '../../../../shared/logger';
import { ToolCall, ToolResult } from './protocol';
import { getAttributionEngine } from '$features/workspace/main/provenance/attribution-engine';
import { type IFileSystemAdapter, LocalFileSystemAdapter } from './file-system-adapter';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';

const logger = new Logger('WorkspaceTools');

// Track file operations for agent provenance
export interface FileOperation {
  path: string;
  operation: 'write' | 'delete';
  timestamp: string;
}

// Store pending file operations per workspace
const pendingFileOperations = new Map<string, FileOperation[]>();

export function trackFileOperation(
  workspaceId: string,
  filePath: string,
  operation: 'write' | 'delete',
) {
  if (!pendingFileOperations.has(workspaceId)) {
    pendingFileOperations.set(workspaceId, []);
  }
  pendingFileOperations.get(workspaceId)!.push({
    path: filePath,
    operation,
    timestamp: new Date().toISOString(),
  });
}

export function getPendingFileOperations(workspaceId: string): FileOperation[] {
  return pendingFileOperations.get(workspaceId) || [];
}

export function clearPendingFileOperations(workspaceId: string) {
  pendingFileOperations.delete(workspaceId);
}

/**
 * Emit agent file change event to trigger immediate UI update in CodeChangesPanel.
 * This is called after agent file operations to make the UI feel snappy.
 */
export function emitAgentFileChange(workspaceId: string, filePath: string) {
  try {
    sendToWorkspaceWindows(workspaceId, 'file-tracking:agent-file-changed', {
      workspaceId,
      filePath,
      source: 'agent',
    });
  } catch (error) {
    logger.warn('Failed to emit agent file change event', { error: (error as Error).message });
  }
}

/**
 * Tool to read a file from the workspace.
 */
export class ReadFileTool extends BaseMCPTool {
  private fsAdapter: IFileSystemAdapter;

  constructor(workspacePath: string, fsAdapter?: IFileSystemAdapter) {
    super(
      'read_file',
      "Read the contents of a file in the workspace project directory. NOTE: This reads actual project files (like .js, .tsx, etc), NOT workspace metadata. For reading the spec, use read_spec. For reading notes, use read_note. DO NOT use this for spec.md - it doesn't exist.",
      createInputSchema(
        {
          path: stringProperty(
            "The path to the PROJECT file (relative to workspace root). Examples: 'src/App.tsx', 'package.json', 'README.md'. NOT for spec.md or notes.",
          ),
        },
        ['path'],
      ),
    );
    this.fsAdapter = fsAdapter || new LocalFileSystemAdapter(workspacePath);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const filePath = call.arguments.path as string;
      if (!filePath) {
        return this.error('File path is required');
      }

      // Use the adapter for path validation and file reading
      if (!this.fsAdapter.isWithinWorkspace(filePath)) {
        return this.error('Access denied: path outside workspace');
      }

      const content = await this.fsAdapter.readFile(filePath);
      return this.success(content, { path: filePath, size: content.length });
    } catch (error) {
      return this.error(`Failed to read file: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to write a file to the workspace.
 */
export class WriteFileTool extends BaseMCPTool {
  private workspaceId: string;
  private workspacePath: string;
  private fsAdapter: IFileSystemAdapter;

  constructor(workspacePath: string, workspaceId: string, fsAdapter?: IFileSystemAdapter) {
    super(
      'write_file',
      'Write contents to a file in the workspace',
      createInputSchema(
        {
          path: stringProperty('The path to the file (relative to workspace root)'),
          content: stringProperty('The content to write to the file'),
        },
        ['path', 'content'],
      ),
    );
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
    this.fsAdapter = fsAdapter || new LocalFileSystemAdapter(workspacePath);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const filePath = call.arguments.path as string;
    const content = call.arguments.content as string;

    if (!filePath || content === undefined) {
      return this.error('File path and content are required');
    }

    // Use the adapter for path validation
    if (!this.fsAdapter.isWithinWorkspace(filePath)) {
      return this.error('Access denied: path outside workspace');
    }

    try {
      // Read old content before writing so we can generate a diff for the activity log
      let oldContent = '';
      let fileExisted = false;
      try {
        fileExisted = await this.fsAdapter.exists(filePath);
        if (fileExisted) {
          oldContent = await this.fsAdapter.readFile(filePath);
        }
      } catch {
        // If we can't read old content, proceed without diff
      }

      // Write file using the adapter (handles directory creation internally)
      await this.fsAdapter.writeFile(filePath, content);

      // Record the agent write for content-based attribution
      // This stores the content hash so we can match it when the file watcher detects the change
      const attributionEngine = getAttributionEngine();
      const agentInfo = (call as any).metadata?.agent || { id: 'agent', name: 'Agent' };
      // Pass workspacePath and workspaceId for path normalization and persistence
      attributionEngine.recordAgentWrite(
        {
          agentId: agentInfo.id || 'agent',
          agentName: agentInfo.name || 'Agent',
          sessionId: (call as any).metadata?.sessionId,
          turnNumber: (call as any).metadata?.turnNumber,
          messageId: `msg-${Date.now()}`,
        },
        filePath,
        content,
        this.workspacePath,
        this.workspaceId,
      );

      // Track this file operation for provenance
      trackFileOperation(this.workspaceId, filePath, 'write');

      // Emit real-time content change event for UI streaming
      sendToWorkspaceWindows(this.workspaceId, `file:content-changed:${this.workspaceId}`, {
        path: filePath,
        content,
        source: 'agent',
        workspaceId: this.workspaceId,
      });

      // Emit agent file change event to trigger immediate CodeChangesPanel update
      emitAgentFileChange(this.workspaceId, filePath);

      // Emit file:changed event to activity log with diff data
      try {
        const { getWorkspaceEventService } = await import('../../../events/main');
        const eventService = getWorkspaceEventService(this.workspaceId);

        // Generate unified diff for the activity log
        let patch: string | undefined;
        let additions = 0;
        let deletions = 0;
        try {
          patch = Diff.createPatch(filePath, oldContent, content, '', '', { context: 3 });
          // Count additions and deletions from the patch
          for (const line of patch.split('\n')) {
            if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) continue;
            if (line.startsWith('+')) additions++;
            else if (line.startsWith('-')) deletions++;
          }
        } catch {
          // If diff generation fails, emit without diff
        }

        eventService.emitFileChange(filePath, fileExisted ? 'modify' : 'create', {
          diff: patch,
          additions,
          deletions,
          actor: {
            type: 'agent' as const,
            id: agentInfo.id || 'agent',
            name: agentInfo.name || 'Agent',
          },
        });
      } catch (err) {
        // Don't fail the tool if activity log emission fails
        logger.warn('Failed to emit file change to activity log', { error: err });
      }

      return this.success(`File written successfully: ${filePath}`, {
        path: filePath,
        size: content.length,
      });
    } catch (error) {
      return this.error(`Failed to write file: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to list files in a directory.
 */
export class ListFilesTool extends BaseMCPTool {
  private fsAdapter: IFileSystemAdapter;

  constructor(workspacePath: string, fsAdapter?: IFileSystemAdapter) {
    super(
      'list_files',
      'List files in a directory within the workspace',
      createInputSchema(
        {
          path: stringProperty('The directory path (relative to workspace root, defaults to root)'),
        },
        [],
      ),
    );
    this.fsAdapter = fsAdapter || new LocalFileSystemAdapter(workspacePath);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const dirPath = (call.arguments.path as string) || '.';

      // Use the adapter for path validation
      if (!this.fsAdapter.isWithinWorkspace(dirPath)) {
        return this.error('Access denied: path outside workspace');
      }

      // For local adapter, we can get file types; for remote, we just get names
      if (this.fsAdapter.isRemote) {
        const fileNames = await this.fsAdapter.listFiles(dirPath);
        const files = fileNames.map((name) => ({ name, type: 'unknown' }));
        return this.success(JSON.stringify(files, null, 2), {
          path: dirPath,
          count: files.length,
        });
      }

      // Local: use fs.readdir with withFileTypes for better info
      const fullPath = this.fsAdapter.resolvePath(dirPath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const files = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
      return this.success(JSON.stringify(files, null, 2), {
        path: dirPath,
        count: files.length,
      });
    } catch (error) {
      return this.error(`Failed to list files: ${(error as Error).message}`);
    }
  }
}

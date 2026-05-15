/**
 * Editor IPC
 *
 * IPC layer for editor operations.
 */

import {
  ipcMain,
  shell,
} from 'electron';
import { spawn } from 'child_process';
import { join } from 'path';
import * as fs from 'fs/promises';
import { EDITOR_INTEGRATION_CHANNELS } from '$shared/ipc/channels';
import { workspaceService } from '../../workspace/main/workspace.service';
import { createWorkspaceId } from '$shared/types/branded-ids';
import { Logger } from '$shared/logger';

const logger = new Logger('editor-ipc');

export function setupEditorIPC() {
  // Open file in editor (external - VS Code, etc.)
  ipcMain.handle(
    EDITOR_INTEGRATION_CHANNELS.OPEN,
    async (
      _,
      { workspaceId, filePath, line }: { workspaceId: string; filePath: string; line?: number },
    ) => {
      try {
        logger.info('Opening file in editor', { workspaceId, filePath, line });

        // Get workspace path - prefer worktreePath (actual repo) over path (storage folder)
        let basePath: string;
        if (workspaceId) {
          const result = await workspaceService.getWorkspace(createWorkspaceId(workspaceId));
          if (!result.ok) {
            throw new Error(`Workspace not found: ${workspaceId}`);
          }
          // worktreePath or repositoryPath is the actual code location
          // path is the workspace storage folder (~/intent/{id}/)
          basePath = result.data.worktreePath || result.data.repositoryPath || '';
          if (!basePath) {
            throw new Error(`Workspace has no worktree or repository path: ${workspaceId}`);
          }
        } else {
          throw new Error('workspaceId is required');
        }

        // Construct full path
        const fullPath = filePath.startsWith('/') ? filePath : join(basePath, filePath);

        // Try to open in VS Code with line number
        const args = line ? ['--goto', `${fullPath}:${line}`] : [fullPath];

        // Try 'code' command (VS Code)
        logger.info('Spawning VS Code', { command: 'code', args });

        const child = spawn('code', args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });

        child.on('error', (err) => {
          logger.warn('Failed to open in VS Code, falling back to system default', {
            error: err.message,
          });
          // Fall back to system default
          shell.openPath(fullPath);
        });

        child.on('spawn', () => {
          logger.info('VS Code spawned successfully');
        });

        child.unref();

        return { success: true, data: { path: fullPath } };
      } catch (error) {
        logger.error('Failed to open file in editor', { error: (error as Error).message });
        return { success: false, error: (error as Error).message };
      }
    },
  );

  // Save file from editor
  ipcMain.handle(EDITOR_INTEGRATION_CHANNELS.SAVE, async (_, { path: filePath, content }) => {
    try {
      await fs.writeFile(filePath, content, 'utf-8');

      return { success: true, data: undefined };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Get editor settings
  ipcMain.handle(EDITOR_INTEGRATION_CHANNELS.SETTINGS, async () => {
    try {
      return {
        success: true,
        data: {
          fontSize: 14,
          theme: 'vs-dark',
          wordWrap: true,
          lineNumbers: true,
          tabSize: 2,
          insertSpaces: true,
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

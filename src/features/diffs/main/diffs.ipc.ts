/**
 * Diffs IPC
 *
 * Thin IPC layer for diff operations.
 * Handles communication between renderer and main process.
 */

import { ipcMain } from 'electron';
import type { CommandResponse, Result } from '../../../shared/types';
import { LineType } from '../../../shared/types';
import { WorkspaceId } from '../../../shared/types/branded-ids';
import { diffsService } from '../diffs.service';
import { Logger } from '../../../shared/logger';
import { DIFFS_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getWorkspaceGitInfo } from '../../git/main/git-router';
import {
  DiffsListSchema,
  DiffsCreateSchema,
  DiffsUpdateSchema,
  DiffsGetSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('Diffs-IPC');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert Result type to CommandResponse type for IPC
 */
function resultToCommandResponse<T>(result: Result<T, string>): CommandResponse<T> {
  if (result.ok) {
    return {
      success: true,
      data: result.data,
    };
  } else {
    return {
      success: false,
      error: result.error,
    };
  }
}

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupDiffsIPC() {
  // List diffs for a workspace
  ipcMain.handle(
    DIFFS_CHANNELS.LIST,
    createSafeValidatedHandler(
      DiffsListSchema,
      async (_, validated) => {
        const result = await diffsService.listDiffs(validated.workspaceId);
        return resultToCommandResponse(result);
      },
      DIFFS_CHANNELS.LIST,
    ),
  );

  // Create a diff
  ipcMain.handle(
    DIFFS_CHANNELS.CREATE,
    createSafeValidatedHandler(
      DiffsCreateSchema,
      async (_, validated) => {
        const result = await diffsService.createDiff(
          validated.workspaceId as WorkspaceId,
          validated.diff,
        );
        return resultToCommandResponse(result);
      },
      DIFFS_CHANNELS.CREATE,
    ),
  );

  // Update a diff
  ipcMain.handle(
    DIFFS_CHANNELS.UPDATE,
    createSafeValidatedHandler(
      DiffsUpdateSchema,
      async (_, validated) => {
        const result = await diffsService.updateDiff(
          validated.workspaceId as WorkspaceId,
          validated.diff,
        );
        return resultToCommandResponse(result);
      },
      DIFFS_CHANNELS.UPDATE,
    ),
  );

  // Get a specific diff
  ipcMain.handle(
    DIFFS_CHANNELS.GET,
    createSafeValidatedHandler(
      DiffsGetSchema,
      async (_, validated) => {
        const { workspaceId, filePath, staged } = validated;

        try {
          // Remote diff retired in P3-5.1; return an error for
          // remote-configured workspaces instead of routing through the
          // legacy remote stack.
          const gitInfo = await getWorkspaceGitInfo(workspaceId);
          if (gitInfo?.isRemote) {
            return {
              success: false,
              error: 'Diff is not supported for remote workspaces',
            };
          }

          // Import git service to get the diff (local workspace)
          const { gitService } = await import('../../git/main/git.service');

          // Get the diff for this specific file
          // staged parameter: true = staged diff, false = unstaged diff, undefined = all changes
          const result = await gitService.getDiff(WorkspaceId(workspaceId), [filePath], staged);

          if (!result.ok) {
            return {
              success: false,
              error: result.error,
            };
          }

          // Parse the diff chunks to extract old and new content
          const diffChunks = result.data;
          let oldContent = '';
          let newContent = '';

          // Check if we have full file content from the git service
          if (diffChunks.length > 0 && (diffChunks[0] as any).oldContent !== undefined) {
            oldContent = (diffChunks[0] as any).oldContent || '';
            newContent = (diffChunks[0] as any).newContent || '';
          } else if (diffChunks.length > 0) {
            // Fall back to reconstructing from diff chunks

            // Extract content from diff chunks
            for (const diffChunk of diffChunks) {
              // Each diffChunk has a chunks array
              for (const chunk of diffChunk.chunks) {
                // Each chunk has a lines array
                for (const line of chunk.lines) {
                  if (line.type === LineType.Addition) {
                    newContent += `${line.content}\n`;
                  } else if (line.type === LineType.Deletion) {
                    oldContent += `${line.content}\n`;
                  } else if (line.type === LineType.Context) {
                    // Context lines appear in both old and new
                    oldContent += `${line.content}\n`;
                    newContent += `${line.content}\n`;
                  }
                }
              }
            }
          }

          // Calculate additions and deletions
          const oldLines = oldContent.trimEnd().split('\n');
          const newLines = newContent.trimEnd().split('\n');

          let additions = 0;
          let deletions = 0;

          // Simple diff: count lines that are different
          const maxLen = Math.max(oldLines.length, newLines.length);
          for (let i = 0; i < maxLen; i++) {
            if (i >= oldLines.length) {
              additions++;
            } else if (i >= newLines.length) {
              deletions++;
            } else if (oldLines[i] !== newLines[i]) {
              deletions++;
              additions++;
            }
          }

          return {
            success: true,
            data: {
              fileName: filePath.split('/').pop() || filePath,
              filePath,
              oldContent: oldContent.trimEnd(),
              newContent: newContent.trimEnd(),
              additions,
              deletions,
            },
          };
        } catch (error) {
          logger.error(
            'Error getting diff',
            error instanceof Error ? error : new Error(String(error)),
            { filePath: validated.filePath },
          );
          return {
            success: false,
            error: (error as Error).message || 'Failed to get diff',
          };
        }
      },
      DIFFS_CHANNELS.GET,
    ),
  );
}

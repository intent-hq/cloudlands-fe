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
import {
  DIFFS_CHANNELS,
  LINE_CHANGES_CHANNELS,
} from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  getWorkspaceGitInfo,
  getRemoteGitManager,
} from '../../git/main/git-router';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import {
  DiffsListSchema,
  DiffsCreateSchema,
  DiffsUpdateSchema,
  DiffsGetSchema,
  LineChangesMarkAgentActiveSchema,
  LineChangesGetCurrentSchema,
  LineChangesStartAgentExecutionSchema,
  LineChangesStopAgentExecutionSchema,
  LineChangesMarkAgentModifiedFilesSchema,
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

  // Mark agent as active
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.MARK_AGENT_ACTIVE,
    createSafeValidatedHandler(
      LineChangesMarkAgentActiveSchema,
      async (_, validated) => {
        const result = await diffsService.markAgentActive(
          validated.workspaceId,
          validated.agentName,
          validated.durationMs || 30000, // Default to 30 seconds
        );
        return resultToCommandResponse(result);
      },
      LINE_CHANGES_CHANNELS.MARK_AGENT_ACTIVE,
    ),
  );

  // Get current changes
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.GET_CURRENT,
    createSafeValidatedHandler(
      LineChangesGetCurrentSchema,
      async (_, validated) => {
        // Handle both string workspaceId and object with workspaceId property
        const workspaceId = typeof validated === 'string' ? validated : validated?.workspaceId;
        const result = await diffsService.getCurrentChanges(workspaceId);
        return resultToCommandResponse(result);
      },
      LINE_CHANGES_CHANNELS.GET_CURRENT,
    ),
  );

  // Start agent execution tracking
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.START_AGENT_EXECUTION,
    createSafeValidatedHandler(
      LineChangesStartAgentExecutionSchema,
      async (_, validated) => {
        const result = await diffsService.startAgentExecution(
          validated.workspaceId,
          validated.agentName,
          validated.sessionId,
          validated.turnNumber,
        );
        return resultToCommandResponse(result);
      },
      LINE_CHANGES_CHANNELS.START_AGENT_EXECUTION,
    ),
  );

  // Stop agent execution tracking
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.STOP_AGENT_EXECUTION,
    createSafeValidatedHandler(
      LineChangesStopAgentExecutionSchema,
      async (_, validated) => {
        const result = await diffsService.stopAgentExecution(validated.workspaceId);
        return resultToCommandResponse(result);
      },
      LINE_CHANGES_CHANNELS.STOP_AGENT_EXECUTION,
    ),
  );

  // Mark files as modified by agent
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.MARK_AGENT_MODIFIED_FILES,
    createSafeValidatedHandler(
      LineChangesMarkAgentModifiedFilesSchema,
      async (_, validated) => {
        try {
          logger.debug(
            `Marking ${validated.files?.length || 0} files as modified by agent in workspace ${
              validated.workspaceId
            }`,
            { files: validated.files },
          );
          return { success: true, data: undefined };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      LINE_CHANGES_CHANNELS.MARK_AGENT_MODIFIED_FILES,
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
          // Check if this is a remote workspace
          const gitInfo = await getWorkspaceGitInfo(workspaceId);
          if (gitInfo?.isRemote) {
            try {
              const remoteGit = getRemoteGitManager(
                workspaceId,
                gitInfo.repositoryPath || gitInfo.worktreePath,
              );
              const worktreePath = gitInfo.worktreePath;

              // Fetch full file contents (same approach as git:diff handler)
              let oldContent = '';
              let newContent = '';
              const rpcClient = await remoteRPCManager.getClient(workspaceId);

              if (staged === true) {
                // Staged: old = HEAD version, new = index (staged) version
                const oldResult = await remoteGit.showFile(filePath, 'HEAD', worktreePath);
                oldContent = oldResult.ok ? oldResult.data : '';

                const newResult = await remoteGit.showFile(filePath, ':0', worktreePath);
                newContent = newResult.ok ? newResult.data : '';
              } else {
                // Unstaged: old = index version, new = working tree file
                const oldResult = await remoteGit.showFile(filePath, ':0', worktreePath);
                oldContent = oldResult.ok ? oldResult.data : '';

                // Read working tree file via RPC
                try {
                  const fullPath = worktreePath ? `${worktreePath}/${filePath}` : filePath;
                  const readResult = await rpcClient.readFile({ path: fullPath });
                  newContent = readResult.content;
                } catch {
                  // File might be deleted
                  newContent = '';
                }
              }

              // Count additions and deletions from the diff
              let additions = 0;
              let deletions = 0;
              const rawDiff = await remoteGit.getDiff(
                [filePath],
                staged || false,
                worktreePath,
              );
              if (rawDiff) {
                for (const line of rawDiff.split('\n')) {
                  if (line.startsWith('+') && !line.startsWith('+++')) {
                    additions++;
                  } else if (line.startsWith('-') && !line.startsWith('---')) {
                    deletions++;
                  }
                }
              }

              return {
                success: true,
                data: {
                  fileName: filePath.split('/').pop() || filePath,
                  filePath,
                  oldContent,
                  newContent,
                  additions,
                  deletions,
                },
              };
            } catch (error) {
              logger.error('Failed to get diff on remote', error instanceof Error ? error : new Error(String(error)), {
                workspaceId,
                filePath,
              });
              return {
                success: false,
                error: (error as Error).message || 'Failed to get remote diff',
              };
            }
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

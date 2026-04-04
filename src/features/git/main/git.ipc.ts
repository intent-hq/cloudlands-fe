/**
 * Git IPC Handlers
 *
 * Registers IPC handlers for git operations.
 * These handlers bridge the renderer process to the GitService.
 * Supports both local and remote workspaces.
 */

import { ipcMain } from 'electron';
import { GitService } from './git.service.js';
import { Logger } from '../../../shared/logger.js';
import { IPC_CHANNELS } from '../../../shared/ipc-registry.js';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware.js';
import { z } from 'zod';
import { restoreWorkspaceId, type WorkspaceId } from '../../../shared/types/index.js';
import { LineType } from '../../../shared/types';
import type { DiffChunk } from '../../../shared/types';
import { GitGetBranchesSchema, GitRenameBranchSchema } from '../../../main/ipc-schemas.js';
import { getWorkspaceGitInfo, getRemoteGitManager, validatePathsInScope } from './git-router.js';
import { execAsync, execFileAsync } from '../../../shared/git/git-env';
import { getAutoCommitStatuses } from '../../agent/main/auto-commit.service';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import { trackMain } from '$lib/services/analytics/main';

const logger = new Logger('GitIPC');
const gitService = new GitService();

// Validation schemas
const WorkspaceIdSchema = z.object({
  workspaceId: z.string(),
});

const PushSchema = z.object({
  workspaceId: z.string(),
  branch: z.string().optional(),
  force: z.boolean().optional(),
});

const StageFilesSchema = z.object({
  workspaceId: z.string(),
  paths: z.array(z.string()),
});

const CommitSchema = z.object({
  workspaceId: z.string(),
  message: z.string(),
});

const DiffSchema = z.object({
  workspaceId: z.string(),
  paths: z.array(z.string()).optional(),
  staged: z.boolean().optional(),
});

const HistorySchema = z.object({
  workspaceId: z.string(),
  limit: z.number().optional(),
  since: z.string().optional(),
  baseRef: z.string().optional(),
  baseCommitSha: z.string().optional(),
});

const GetBranchesSchema = z.object({
  workspaceId: z.string(),
  includeRemote: z.boolean().optional(),
});

const StageHunkSchema = z.object({
  workspaceId: z.string(),
  filePath: z.string(),
  hunkPatch: z.string(),
});

/**
 * Parse raw git diff output into DiffChunk[] structure.
 * Mirrors the parseDiff logic from GitService.
 */
function parseDiffOutput(diffOutput: string): DiffChunk[] {
  const chunks: DiffChunk[] = [];

  if (!diffOutput.trim()) {
    return chunks;
  }

  // Split by file headers (lines starting with "diff --git")
  const fileSections = diffOutput.split(/^diff --git/m).slice(1);

  for (const section of fileSections) {
    const lines = section.split('\n');

    // Parse file header to get file path
    // Format: " a/path/to/file b/path/to/file"
    const headerMatch = lines[0]?.match(/a\/(.+?)\s+b\/(.+?)$/);
    if (!headerMatch) continue;

    const filePath = headerMatch[1];
    const chunk: DiffChunk = {
      file: filePath,
      chunks: [],
    };

    // Parse hunks (sections starting with @@)
    let currentHunk: {
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<{ type: LineType; content: string }>;
    } | null = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // Check for hunk header
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (hunkMatch) {
        // Save previous hunk if exists
        if (currentHunk) {
          chunk.chunks.push(currentHunk);
        }

        // Start new hunk
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newLines: parseInt(hunkMatch[4] || '1', 10),
          lines: [],
        };
        continue;
      }

      // Skip file metadata lines
      if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        continue;
      }

      // Parse diff lines
      if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        let type: LineType;
        const content = line.substring(1);

        if (line.startsWith('+')) {
          type = LineType.Addition;
        } else if (line.startsWith('-')) {
          type = LineType.Deletion;
        } else {
          type = LineType.Context;
        }

        currentHunk.lines.push({ type, content });
      }
    }

    // Don't forget the last hunk
    if (currentHunk) {
      chunk.chunks.push(currentHunk);
    }

    if (chunk.chunks.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * Setup git IPC handlers
 */
export function setupGitIPC() {
  logger.info('Setting up git IPC handlers');

  // Get git status
  ipcMain.handle(
    IPC_CHANNELS.GIT.STATUS,
    createSafeValidatedHandler(
      WorkspaceIdSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            const status = await remoteGit.getStatus(gitInfo.worktreePath);
            // Convert RemoteGitManager status to GitService format
            return {
              success: true,
              data: {
                branch: status.branch,
                ahead: status.ahead,
                behind: status.behind,
                diverged: status.diverged,
                files: [
                  ...status.staged.map((f: string) => ({ path: f, status: 'staged' as const })),
                  ...status.modified.map((f: string) => ({ path: f, status: 'modified' as const })),
                  ...status.untracked.map((f: string) => ({
                    path: f,
                    status: 'untracked' as const,
                  })),
                  ...status.deleted.map((f: string) => ({ path: f, status: 'deleted' as const })),
                ],
              },
            };
          } catch (error) {
            logger.error('Failed to get remote git status', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        // Local workspace - use GitService
        const result = await gitService.getStatus(workspaceId as WorkspaceId);
        if (result.ok) {
          logger.info('IPC returning git status', { workspaceId, diverged: result.data.diverged });
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.STATUS,
    ),
  );

  // Stage files
  ipcMain.handle(
    IPC_CHANNELS.GIT.STAGE,
    createSafeValidatedHandler(
      StageFilesSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (!gitInfo) {
          return { success: false, error: 'Failed to get workspace git info' };
        }

        // Validate that all paths are within scope
        const scopeError = validatePathsInScope(
          validated.paths,
          gitInfo.scope,
          gitInfo.worktreePath,
        );
        if (scopeError) {
          logger.warn('Attempted to stage files outside scope', {
            workspaceId,
            scope: gitInfo.scope,
          });
          return { success: false, error: scopeError };
        }

        if (gitInfo.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            await remoteGit.stageFiles(validated.paths, gitInfo.worktreePath);
            return { success: true, data: undefined };
          } catch (error) {
            logger.error('Failed to stage files on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.stageFiles(workspaceId as WorkspaceId, validated.paths);
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.STAGE,
    ),
  );

  // Unstage files
  ipcMain.handle(
    IPC_CHANNELS.GIT.UNSTAGE,
    createSafeValidatedHandler(
      StageFilesSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (!gitInfo) {
          return { success: false, error: 'Failed to get workspace git info' };
        }

        // Validate that all paths are within scope
        const scopeError = validatePathsInScope(
          validated.paths,
          gitInfo.scope,
          gitInfo.worktreePath,
        );
        if (scopeError) {
          logger.warn('Attempted to unstage files outside scope', {
            workspaceId,
            scope: gitInfo.scope,
          });
          return { success: false, error: scopeError };
        }

        if (gitInfo.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            await remoteGit.unstageFiles(validated.paths, gitInfo.worktreePath);
            return { success: true, data: undefined };
          } catch (error) {
            logger.error('Failed to unstage files on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.unstageFiles(workspaceId as WorkspaceId, validated.paths);
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.UNSTAGE,
    ),
  );

  // Stage a specific hunk (partial staging)
  ipcMain.handle(
    IPC_CHANNELS.GIT.STAGE_HUNK,
    createSafeValidatedHandler(
      StageHunkSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Note: Remote hunk staging not supported yet
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (!gitInfo) {
          return { success: false, error: 'Failed to get workspace git info' };
        }

        if (gitInfo.isRemote) {
          return { success: false, error: 'Hunk staging not supported for remote workspaces' };
        }

        // Validate that the file path is within scope
        const scopeError = validatePathsInScope(
          [validated.filePath],
          gitInfo.scope,
          gitInfo.worktreePath,
        );
        if (scopeError) {
          logger.warn('Attempted to stage hunk outside scope', {
            workspaceId,
            scope: gitInfo.scope,
          });
          return { success: false, error: scopeError };
        }

        const result = await gitService.stageHunk(
          workspaceId as WorkspaceId,
          validated.filePath,
          validated.hunkPatch,
        );
        if (result.ok) {
          // Invalidate the ChangeDetector's git status cache so the next poll gets fresh status
          const gitIntegration = global.gitIntegrations?.get(workspaceId);
          if (gitIntegration) {
            gitIntegration.invalidateGitStatusCache();
          }
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.STAGE_HUNK,
    ),
  );

  // Unstage a specific hunk (partial unstaging)
  ipcMain.handle(
    IPC_CHANNELS.GIT.UNSTAGE_HUNK,
    createSafeValidatedHandler(
      StageHunkSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Note: Remote hunk unstaging not supported yet
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (!gitInfo) {
          return { success: false, error: 'Failed to get workspace git info' };
        }

        if (gitInfo.isRemote) {
          return { success: false, error: 'Hunk unstaging not supported for remote workspaces' };
        }

        // Validate that the file path is within scope
        const scopeError = validatePathsInScope(
          [validated.filePath],
          gitInfo.scope,
          gitInfo.worktreePath,
        );
        if (scopeError) {
          logger.warn('Attempted to unstage hunk outside scope', {
            workspaceId,
            scope: gitInfo.scope,
          });
          return { success: false, error: scopeError };
        }

        const result = await gitService.unstageHunk(
          workspaceId as WorkspaceId,
          validated.filePath,
          validated.hunkPatch,
        );
        if (result.ok) {
          // Invalidate the ChangeDetector's git status cache so the next poll gets fresh status
          const gitIntegration = global.gitIntegrations?.get(workspaceId);
          if (gitIntegration) {
            gitIntegration.invalidateGitStatusCache();
          }
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.UNSTAGE_HUNK,
    ),
  );

  // Discard unstaged changes
  ipcMain.handle(
    IPC_CHANNELS.GIT.DISCARD,
    createSafeValidatedHandler(
      StageFilesSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            await remoteGit.discardChanges(validated.paths, gitInfo.worktreePath);
            return { success: true, data: undefined };
          } catch (error) {
            logger.error('Failed to discard changes on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.discardChanges(workspaceId as WorkspaceId, validated.paths);
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.DISCARD,
    ),
  );

  // Commit changes
  ipcMain.handle(
    IPC_CHANNELS.GIT.COMMIT,
    createSafeValidatedHandler(
      CommitSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        let commitHash: string | undefined;

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            commitHash = await remoteGit.commit(validated.message, gitInfo.worktreePath);
          } catch (error) {
            logger.error('Failed to commit on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        } else {
          const result = await gitService.commit(workspaceId as WorkspaceId, validated.message);
          if (!result.ok) {
            return { success: false, error: result.error };
          }
          commitHash = result.data?.hash;
        }

        // After successful commit, handle the post-commit transition
        try {
          logger.info('Handling post-commit transition', {
            workspaceId,
            commitHash,
          });

          // Get git integration from global storage
          const gitIntegration = global.gitIntegrations?.get(validated.workspaceId);
          if (gitIntegration) {
            // Handle post-commit transition (staged -> committed)
            await gitIntegration.handlePostCommit(commitHash);

            // Then sync the current state
            await gitIntegration.syncCurrentState(true); // Force sync
            logger.info('Post-commit transition and sync complete', { workspaceId });
          } else {
            logger.warn('No git integration found for workspace after commit', { workspaceId });
          }
        } catch (syncError) {
          logger.error('Failed to sync file tracking after commit', syncError as Error);
          // Don't fail the commit response, just log the error
        }

        // Track commit event
        trackMain('Committed Changes', {
          workspace_id: workspaceId,
          success: true,
        });

        return { success: true, data: { hash: commitHash } };
      },
      IPC_CHANNELS.GIT.COMMIT,
    ),
  );

  // Push changes
  ipcMain.handle(
    IPC_CHANNELS.GIT.PUSH,
    createSafeValidatedHandler(
      PushSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        const force = validated.force ?? false;

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            await remoteGit.push(gitInfo.worktreePath, { setUpstream: true, force });
            // Track push event for remote workspace
            trackMain('Pushed Changes', {
              workspace_id: workspaceId,
              success: true,
            });
            return { success: true, data: undefined };
          } catch (error) {
            logger.error('Failed to push on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.push(workspaceId as WorkspaceId, force);
        if (result.ok) {
          // Track push event
          trackMain('Pushed Changes', {
            workspace_id: workspaceId,
            success: true,
          });
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.PUSH,
    ),
  );

  // Pull changes
  ipcMain.handle(
    IPC_CHANNELS.GIT.PULL,
    createSafeValidatedHandler(
      WorkspaceIdSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            await remoteGit.pull(gitInfo.worktreePath);
            return { success: true, data: undefined };
          } catch (error) {
            logger.error('Failed to pull on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        // Pass the workspace's target branch so pull knows which remote branch to use
        const result = await gitService.pull(workspaceId as WorkspaceId, gitInfo?.branch);
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.PULL,
    ),
  );

  // Fetch remote changes without merging
  ipcMain.handle(
    IPC_CHANNELS.GIT.FETCH,
    createSafeValidatedHandler(
      WorkspaceIdSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            await remoteGit.fetch(gitInfo.worktreePath);
            return { success: true, data: undefined };
          } catch (error) {
            logger.error('Failed to fetch on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.fetch(workspaceId as WorkspaceId);
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.FETCH,
    ),
  );

  // Get diff
  ipcMain.handle(
    IPC_CHANNELS.GIT.DIFF,
    createSafeValidatedHandler(
      DiffSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            const rawDiff = await remoteGit.getDiff(
              validated.paths || [],
              validated.staged || false,
              gitInfo.worktreePath,
            );

            // Parse raw diff into DiffChunk[] structure
            const chunks = parseDiffOutput(rawDiff);

            // For each file in the diff, fetch oldContent and newContent
            const staged = validated.staged;
            const worktreePath = gitInfo.worktreePath;
            const rpcClient = await remoteRPCManager.getClient(workspaceId);

            for (const chunk of chunks) {
              try {
                let oldFileContent = '';
                let newFileContent = '';

                if (staged === true) {
                  // Staged: old = HEAD version, new = index (staged) version
                  const oldResult = await remoteGit.showFile(chunk.file, 'HEAD', worktreePath);
                  oldFileContent = oldResult.ok ? oldResult.data : '';

                  const newResult = await remoteGit.showFile(chunk.file, ':0', worktreePath);
                  newFileContent = newResult.ok ? newResult.data : '';
                } else {
                  // Unstaged: old = index version, new = working tree file
                  const oldResult = await remoteGit.showFile(chunk.file, ':0', worktreePath);
                  oldFileContent = oldResult.ok ? oldResult.data : '';

                  // Read working tree file via RPC
                  try {
                    const filePath = worktreePath
                      ? `${worktreePath}/${chunk.file}`
                      : chunk.file;
                    const readResult = await rpcClient.readFile({ path: filePath });
                    newFileContent = readResult.content;
                  } catch {
                    // File might be deleted
                    newFileContent = '';
                  }
                }

                chunk.oldContent = oldFileContent;
                chunk.newContent = newFileContent;
              } catch (err) {
                logger.warn('Could not get full file content for remote diff', {
                  file: chunk.file,
                  error: err,
                });
              }
            }

            return { success: true, data: chunks };
          } catch (error) {
            logger.error('Failed to get diff on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.getDiff(
          workspaceId as WorkspaceId,
          validated.paths,
          validated.staged,
        );
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.DIFF,
    ),
  );

  // Get history
  ipcMain.handle(
    IPC_CHANNELS.GIT.HISTORY,
    createSafeValidatedHandler(
      HistorySchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            const commits = await remoteGit.getHistory(validated.limit || 50, gitInfo.worktreePath);
            return { success: true, data: commits };
          } catch (error) {
            logger.error('Failed to get history on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.getHistory(
          workspaceId as WorkspaceId,
          validated.limit,
          validated.since,
          validated.baseRef,
          validated.baseCommitSha,
        );
        if (result.ok) {
          return { success: true, data: result.data.commits };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.HISTORY,
    ),
  );

  // Get log (alias for history, returns commit list)
  ipcMain.handle(
    IPC_CHANNELS.GIT.LOG,
    createSafeValidatedHandler(
      HistorySchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            const commits = await remoteGit.getHistory(validated.limit || 50, gitInfo.worktreePath);
            // Map to expected format with 'sha' field for compatibility
            const mappedCommits = commits.map(
              (commit: {
                hash: string;
                message: string;
                author: string;
                email: string;
                date: string;
              }) => ({
                ...commit,
                sha: commit.hash,
              }),
            );
            return { success: true, data: mappedCommits };
          } catch (error) {
            logger.error('Failed to get log on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.getHistory(
          workspaceId as WorkspaceId,
          validated.limit,
          validated.since,
          validated.baseRef,
          validated.baseCommitSha,
        );
        if (result.ok) {
          // Map to expected format with 'sha' field for compatibility
          const commits = result.data.commits.map((commit) => ({
            ...commit,
            sha: commit.hash, // Alias hash as sha for compatibility
          }));
          return { success: true, data: commits };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.LOG,
    ),
  );

  // Remove lock file
  ipcMain.handle(
    IPC_CHANNELS.GIT.REMOVE_LOCK,
    createSafeValidatedHandler(
      WorkspaceIdSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }
        const result = await gitService.removeLockFile(workspaceId as WorkspaceId);
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.REMOVE_LOCK,
    ),
  );

  // Get commit details
  ipcMain.handle(
    IPC_CHANNELS.GIT.COMMIT_DETAILS,
    createSafeValidatedHandler(
      z.object({
        workspaceId: z.string(),
        commitHash: z.string(),
      }),
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }
        const result = await gitService.getCommitDetails(
          workspaceId as WorkspaceId,
          validated.commitHash,
        );
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.COMMIT_DETAILS,
    ),
  );

  // Get branches - This handler is for workspace-based operations
  // There's a conflict here: we have two different schemas for the same channel
  // The GitGetBranchesSchema expects { repoPath } for initialization
  // The GetBranchesSchema expects { workspaceId } for workspace operations
  // We need to handle both cases
  ipcMain.handle(
    IPC_CHANNELS.GIT.GET_BRANCHES,
    createSafeValidatedHandler(
      z.union([
        GitGetBranchesSchema, // { repoPath: string }
        GetBranchesSchema, // { workspaceId: string, includeRemote?: boolean }
      ]),
      async (_, validated) => {
        // Check which schema was used
        if ('repoPath' in validated) {
          // Handle repository path case (for initialization)
          try {
            // Get current branch
            const currentBranchResult = await execAsync('git branch --show-current', {
              cwd: validated.repoPath,
            });
            const currentBranch = currentBranchResult.stdout.trim();

            // Get LOCAL branches only first (much faster for repos with many remote branches)
            const localBranchesResult = await execAsync('git branch', {
              cwd: validated.repoPath,
            });

            const localBranches = localBranchesResult.stdout
              .split('\n')
              .map((b: string) => b.trim())
              .filter((b: string) => b.length > 0)
              .map((b: string) => b.replace(/^[*+]\s*/, '')) // Remove current branch marker (*) and worktree marker (+)
              .filter((b: string) => !b.includes(' -> ')); // Filter out symbolic refs

            // Try to determine default branch
            let defaultBranch = 'main';
            try {
              const defaultBranchResult = await execAsync(
                'git symbolic-ref refs/remotes/origin/HEAD',
                { cwd: validated.repoPath },
              );
              const match = defaultBranchResult.stdout.match(/refs\/remotes\/origin\/(.+)/);
              if (match) {
                defaultBranch = match[1].trim();
              }
            } catch {
              // Fallback: check if main or master exists
              if (localBranches.includes('master')) {
                defaultBranch = 'master';
              }
            }

            // Only fetch remote branches if explicitly requested
            let remoteBranches: string[] = [];
            if (validated.includeRemote) {
              try {
                // Use git for-each-ref which is MUCH faster than git branch -r
                const remoteBranchesResult = await execAsync(
                  'git for-each-ref --format="%(refname:short)" refs/remotes/origin/',
                  {
                    cwd: validated.repoPath,
                    timeout: 5000, // 5 second timeout
                  },
                );

                remoteBranches = remoteBranchesResult.stdout
                  .split('\n')
                  .map((b: string) => b.trim())
                  .filter((b: string) => b.length > 0)
                  .filter((b: string) => !b.includes(' -> ')) // Filter out symbolic refs
                  // Keep origin/ prefix so git commands work directly
                  // Filter out branches that have a local equivalent (e.g., origin/main when main exists locally)
                  .filter((b: string) => !localBranches.includes(b.replace(/^origin\//, '')));

                // Sort remote branches: default branch first, then alphabetically
                remoteBranches.sort((a, b) => {
                  // Compare without origin/ prefix for sorting purposes
                  const aName = a.replace(/^origin\//, '');
                  const bName = b.replace(/^origin\//, '');
                  if (aName === defaultBranch) return -1;
                  if (bName === defaultBranch) return 1;
                  return aName.localeCompare(bName);
                });
              } catch {
                // Ignore remote branch errors - user may not have remotes configured or timeout
              }
            }

            // Sort local branches: default first, current second, then alphabetically
            const sortedLocalBranches = [...localBranches].sort((a, b) => {
              if (a === defaultBranch) return -1;
              if (b === defaultBranch) return 1;
              if (a === currentBranch) return -1;
              if (b === currentBranch) return 1;
              return a.localeCompare(b);
            });

            return {
              success: true,
              data: {
                branches: sortedLocalBranches,
                remoteBranches, // Return remote branches separately!
                currentBranch,
                defaultBranch,
              },
            };
          } catch (error) {
            logger.error('Failed to get branches from repo path', error as Error);
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Failed to get branches',
            };
          }
        } else {
          // Handle workspace case
          const workspaceId = restoreWorkspaceId(validated.workspaceId);
          if (!workspaceId) {
            return { success: false, error: 'Invalid workspace ID' };
          }

          // Check if this is a remote workspace
          const gitInfo = await getWorkspaceGitInfo(workspaceId);
          if (gitInfo?.isRemote) {
            try {
              const remoteGit = getRemoteGitManager(
                workspaceId,
                gitInfo.repositoryPath || gitInfo.worktreePath,
              );
              const branches = await remoteGit.listBranches();
              return { success: true, data: branches };
            } catch (error) {
              logger.error('Failed to get branches on remote', error as Error, { workspaceId });
              return { success: false, error: (error as Error).message };
            }
          }

          const result = await gitService.listBranches(
            workspaceId as WorkspaceId,
            validated.includeRemote,
          );
          if (result.ok) {
            return { success: true, data: result.data };
          } else {
            return { success: false, error: result.error };
          }
        }
      },
      IPC_CHANNELS.GIT.GET_BRANCHES,
    ),
  );

  // Check if directory is a git repository
  ipcMain.handle(
    IPC_CHANNELS.GIT_EXT.IS_REPOSITORY,
    createSafeValidatedHandler(
      z.object({
        path: z.string(),
      }),
      async (_, validated) => {
        try {
          const isRepo = await gitService.isRepository(validated.path);
          return { success: true, data: isRepo };
        } catch (error) {
          logger.error('Failed to check if directory is a git repository', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to check repository status',
          };
        }
      },
      IPC_CHANNELS.GIT_EXT.IS_REPOSITORY,
    ),
  );

  // Get list of remotes for a repository
  ipcMain.handle(
    IPC_CHANNELS.GIT.GET_REMOTES,
    createSafeValidatedHandler(
      z.object({
        repoPath: z.string(),
      }),
      async (_, validated) => {
        try {
          // Get list of remotes with their URLs
          const { stdout } = await execAsync('git remote -v', {
            cwd: validated.repoPath,
          });

          // Parse remote output: "origin  git@github.com:user/repo.git (fetch)"
          const remotes = new Map<string, { name: string; fetchUrl: string; pushUrl: string }>();
          for (const line of stdout.split('\n')) {
            const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
            if (match) {
              const [, name, url, type] = match;
              if (!remotes.has(name)) {
                remotes.set(name, { name, fetchUrl: '', pushUrl: '' });
              }
              const remote = remotes.get(name)!;
              if (type === 'fetch') {
                remote.fetchUrl = url;
              } else {
                remote.pushUrl = url;
              }
            }
          }

          // Convert to array and determine default remote
          const remoteList = Array.from(remotes.values());

          // Determine default: prefer 'origin', then 'upstream', then first
          let defaultRemote = 'origin';
          if (!remotes.has('origin')) {
            if (remotes.has('upstream')) {
              defaultRemote = 'upstream';
            } else if (remoteList.length > 0) {
              defaultRemote = remoteList[0].name;
            }
          }

          return {
            success: true,
            data: {
              remotes: remoteList,
              defaultRemote,
            },
          };
        } catch (error) {
          logger.error('Failed to get remotes', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get remotes',
          };
        }
      },
      IPC_CHANNELS.GIT.GET_REMOTES,
    ),
  );

  // Get file content at a specific git ref
  ipcMain.handle(
    IPC_CHANNELS.GIT.SHOW_FILE,
    createSafeValidatedHandler(
      z.object({
        workspaceId: z.string(),
        filePath: z.string(),
        ref: z.string(),
      }),
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        // Check if this is a remote workspace
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          try {
            const remoteGit = getRemoteGitManager(
              workspaceId,
              gitInfo.repositoryPath || gitInfo.worktreePath,
            );
            const result = await remoteGit.showFile(
              validated.filePath,
              validated.ref,
              gitInfo.worktreePath,
            );
            if (result.ok) {
              return { success: true, data: result.data };
            } else {
              return { success: false, error: result.error };
            }
          } catch (error) {
            logger.error('Failed to show file on remote', error as Error, { workspaceId });
            return { success: false, error: (error as Error).message };
          }
        }

        const result = await gitService.showFile(
          workspaceId as WorkspaceId,
          validated.filePath,
          validated.ref,
        );
        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.SHOW_FILE,
    ),
  );

  // Rename branch
  ipcMain.handle(
    IPC_CHANNELS.GIT.RENAME_BRANCH,
    createSafeValidatedHandler(
      GitRenameBranchSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        const result = await gitService.renameBranch(
          workspaceId as WorkspaceId,
          validated.oldBranchName,
          validated.newBranchName,
        );

        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.RENAME_BRANCH,
    ),
  );

  // Pull a specific branch with rebase
  // Includes auto-stash functionality: if pull fails due to unstaged changes,
  // automatically stashes changes, pulls, and unstashes
  ipcMain.handle(
    IPC_CHANNELS.GIT.PULL_BRANCH,
    createSafeValidatedHandler(
      z.object({
        repoPath: z.string(),
        branchName: z.string(),
      }),
      async (_, validated) => {
        const execOptions = {
          cwd: validated.repoPath,
          timeout: 120_000, // 2 minute timeout
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0', // Disable interactive prompts
          },
        };

        /**
         * Helper to detect if an error is due to unstaged changes
         */
        const isUnstagedChangesError = (errorMsg: string): boolean => {
          return (
            errorMsg.includes('cannot pull with rebase: You have unstaged changes') ||
            errorMsg.includes('Please commit or stash them')
          );
        };

        /**
         * Helper to attempt git pull with rebase
         */
        const attemptPull = async (): Promise<{ success: boolean; error?: string }> => {
          try {
            await execFileAsync(
              'git',
              ['pull', '--rebase', 'origin', validated.branchName],
              execOptions,
            );
            return { success: true };
          } catch (error) {
            const err = error as Error & { stderr?: string };
            const errorMessage = err.stderr || err.message || 'Failed to pull branch';
            return { success: false, error: errorMessage };
          }
        };

        try {
          // First, verify the current branch matches the requested branch
          // git pull --rebase origin <branch> only works correctly if that branch is checked out
          const { stdout: currentBranch } = await execFileAsync(
            'git',
            ['branch', '--show-current'],
            {
              cwd: validated.repoPath,
              timeout: 10_000,
            },
          );

          const currentBranchName = currentBranch.trim();
          if (currentBranchName !== validated.branchName) {
            // Branch is not checked out - use git fetch to update the remote tracking branch
            // This is sufficient for workspace creation since worktrees are created from origin/<branch>
            logger.info('Branch not checked out, using fetch instead of pull', {
              branchName: validated.branchName,
              currentBranch: currentBranchName,
            });

            try {
              // Fetch the specific branch from origin to update origin/<branch>
              await execFileAsync(
                'git',
                [
                  'fetch',
                  'origin',
                  `${validated.branchName}:refs/remotes/origin/${validated.branchName}`,
                ],
                {
                  ...execOptions,
                  timeout: 60_000, // 1 minute for fetch
                },
              );
              logger.info('Successfully fetched branch from origin', {
                branchName: validated.branchName,
              });
              return { success: true };
            } catch (fetchError) {
              const err = fetchError as Error & { stderr?: string };
              const errorMessage = err.stderr || err.message || 'Failed to fetch branch';
              logger.error('Failed to fetch branch', err, {
                branchName: validated.branchName,
              });
              return { success: false, error: errorMessage };
            }
          }

          // First attempt: try to pull directly
          const firstAttempt = await attemptPull();
          if (firstAttempt.success) {
            return { success: true };
          }

          // Check if the error is due to unstaged changes
          if (!isUnstagedChangesError(firstAttempt.error || '')) {
            // Not an unstaged changes error, return the original error
            logger.error('Failed to pull branch', new Error(firstAttempt.error), {
              branchName: validated.branchName,
            });
            return { success: false, error: firstAttempt.error };
          }

          // Auto-stash workflow: stash -> pull -> pop
          logger.info('Pull failed due to unstaged changes, attempting auto-stash workflow', {
            branchName: validated.branchName,
          });

          // Step 1: Stash changes (including untracked files)
          let stashCreated = false;
          try {
            const { stdout: stashOutput } = await execFileAsync(
              'git',
              ['stash', 'push', '--include-untracked', '-m', 'Intent: auto-stash before pull'],
              {
                cwd: validated.repoPath,
                timeout: 30_000,
              },
            );
            // Check if stash was actually created (git stash outputs "No local changes to save" if nothing to stash)
            stashCreated = !stashOutput.includes('No local changes to save');
            logger.info('Stash result', {
              stashCreated,
              output: stashOutput.trim(),
            });
          } catch (stashError) {
            const err = stashError as Error & { stderr?: string };
            logger.error('Failed to stash changes', err);
            return {
              success: false,
              error: `Failed to auto-stash changes: ${err.stderr || err.message}`,
            };
          }

          // Step 2: Pull with rebase
          const pullAfterStash = await attemptPull();
          if (!pullAfterStash.success) {
            // Pull still failed - try to restore stash if we created one
            if (stashCreated) {
              try {
                await execFileAsync('git', ['stash', 'pop'], {
                  cwd: validated.repoPath,
                  timeout: 30_000,
                });
                logger.info('Restored stash after failed pull');
              } catch (popError) {
                logger.warn('Failed to restore stash after failed pull', popError as Error);
              }
            }
            logger.error(
              'Failed to pull branch even after stashing',
              new Error(pullAfterStash.error),
            );
            return { success: false, error: pullAfterStash.error };
          }

          // Step 3: Pop stash to restore changes
          if (stashCreated) {
            try {
              await execFileAsync('git', ['stash', 'pop'], {
                cwd: validated.repoPath,
                timeout: 30_000,
              });
              logger.info('Successfully restored stashed changes after pull');
            } catch (popError) {
              const err = popError as Error & { stderr?: string };
              const popErrorMsg = err.stderr || err.message || '';

              // Check if this is a conflict during stash pop
              if (popErrorMsg.includes('CONFLICT') || popErrorMsg.includes('conflict')) {
                logger.warn('Stash pop resulted in conflicts', err);
                return {
                  success: false,
                  error: `Pull succeeded but your local changes conflict with the pulled changes. Your changes are saved in the stash. Run 'git stash pop' and resolve conflicts manually, or use 'git stash drop' to discard your local changes.`,
                };
              }

              logger.error('Failed to restore stash', err);
              return {
                success: false,
                error: `Pull succeeded but failed to restore your local changes: ${popErrorMsg}. Your changes are saved in the stash - run 'git stash pop' to restore them.`,
              };
            }
          }

          logger.info('Auto-stash workflow completed successfully', {
            branchName: validated.branchName,
            stashCreated,
          });
          return { success: true };
        } catch (error) {
          const err = error as Error & { stderr?: string };
          const errorMessage = err.stderr || err.message || 'Failed to pull branch';
          logger.error('Failed to pull branch', err, {
            branchName: validated.branchName,
          });
          return { success: false, error: errorMessage };
        }
      },
      IPC_CHANNELS.GIT.PULL_BRANCH,
    ),
  );

  // Get branch status (ahead/behind counts and unstaged changes)
  ipcMain.handle(
    IPC_CHANNELS.GIT.GET_BRANCH_STATUS,
    createSafeValidatedHandler(
      z.object({
        repoPath: z.string(),
        branchName: z.string(),
      }),
      async (_, validated) => {
        const result = await gitService.getBranchStatus(validated.repoPath, validated.branchName);

        if (result.ok) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      },
      IPC_CHANNELS.GIT.GET_BRANCH_STATUS,
    ),
  );

  // Get auto-commit status history for a specific agent (renderer queries this on mount)
  ipcMain.handle(
    IPC_CHANNELS.GIT_EXT.GET_AUTO_COMMIT_STATUS,
    createSafeValidatedHandler(
      z.object({
        agentId: z.string(),
      }),
      async (_, validated) => {
        const statuses = getAutoCommitStatuses(validated.agentId);
        return { success: true, data: statuses };
      },
      IPC_CHANNELS.GIT_EXT.GET_AUTO_COMMIT_STATUS,
    ),
  );

  // Get background git operations status for a workspace
  ipcMain.handle(
    IPC_CHANNELS.GIT_EXT.GET_BACKGROUND_OPS_STATUS,
    createSafeValidatedHandler(
      z.object({
        workspaceId: z.string(),
      }),
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }
        const { backgroundGitOpsService } = await import('./background-git-ops.service.js');
        const operations = backgroundGitOpsService.getOperations(workspaceId);
        return { success: true, data: operations };
      },
      IPC_CHANNELS.GIT_EXT.GET_BACKGROUND_OPS_STATUS,
    ),
  );

  logger.info('Git IPC handlers registered successfully');
}

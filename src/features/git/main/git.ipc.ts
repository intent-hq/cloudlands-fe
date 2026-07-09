/**
 * Git IPC Handlers
 *
 * Registers IPC handlers for the git operations the intentd daemon does not
 * serve yet. Channels with a daemon arm (PROTOCOL §5.6) — status, stage,
 * unstage, commit, pull, history/log, commit-details, pullBranch (→ path-based
 * `git.pull`), getBranchStatus (→ `git.branchStatus`) and show-file (→
 * `git.showFile`) — have been retired here: the renderer reaches the daemon
 * directly via `backendRequest('git.*')`. What remains is the local-only
 * surface: hunk staging, discard, push, fetch, diff-with-content/numstat,
 * lock removal, branch listing/rename and remote inspection.
 */

import { ipcMain } from 'electron';
import { GitService } from './git.service.js';
import { Logger } from '../../../shared/logger.js';
import { IPC_CHANNELS } from '../../../shared/ipc-registry.js';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware.js';
import { z } from 'zod';
import {
  restoreWorkspaceId,
  type WorkspaceId,
} from '../../../shared/types/index.js';
import {
  GitGetBranchesSchema,
  GitRenameBranchSchema,
} from '../../../main/ipc-schemas.js';
import {
  getWorkspaceGitInfo,
  validatePathsInScope,
} from './git-router.js';
import { execAsync } from '../../../shared/git/git-env';
import { getAutoCommitStatuses } from '../../agent/main/auto-commit.service';
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

const DiffSchema = z.object({
  workspaceId: z.string(),
  paths: z.array(z.string()).optional(),
  staged: z.boolean().optional(),
  baseRef: z.string().optional(),
  baseCommitSha: z.string().optional(),
  targetRef: z.string().optional(),
});

const NumstatSchema = DiffSchema;

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
 * Setup git IPC handlers
 */
export function setupGitIPC() {
  logger.info('Setting up git IPC handlers');

  // git:status / git:stage / git:unstage / git:commit / git:pull /
  // git:history / git:log / git:commit-details / git:pullBranch /
  // git:getBranchStatus have been retired: the renderer now reaches the
  // daemon directly via backendRequest('git.*') (PROTOCOL §5.6), which also
  // retires their local execFileAsync and remote routing.

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

        // Remote discard-changes retired in P3-5.1; return an error for
        // remote-configured workspaces instead of routing through the legacy
        // remote stack.
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          return {
            success: false,
            error: 'Discard changes is not supported for remote workspaces',
          };
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

        // Remote push retired in P3-5.1; return an error for remote-configured
        // workspaces instead of routing through the legacy remote stack.
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          return { success: false, error: 'Push is not supported for remote workspaces' };
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

        // Remote fetch retired in P3-5.1; return an error for
        // remote-configured workspaces instead of routing through the legacy
        // remote stack.
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          return { success: false, error: 'Fetch is not supported for remote workspaces' };
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

        // Branch-base diffs are side-effect-free committed-branch comparisons
        // used by the local-changes aggregate view to collapse per-commit hunks
        // into one HEAD-coordinate diff before renderer-side merging.
        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (validated.baseRef || validated.baseCommitSha) {
          if (gitInfo?.isRemote) {
            return { success: false, error: 'Branch-base diff is not supported for remote workspaces' };
          }

          const result = await gitService.getBranchBaseDiff(
            workspaceId as WorkspaceId,
            validated.paths,
            validated.baseRef,
            validated.baseCommitSha,
            validated.targetRef,
          );
          if (result.ok) {
            return { success: true, data: result.data };
          }
          return { success: false, error: result.error };
        }

        // Remote diff retired in P3-5.1; return an error for
        // remote-configured workspaces instead of routing through the legacy
        // remote stack.
        if (gitInfo?.isRemote) {
          return { success: false, error: 'Diff is not supported for remote workspaces' };
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

  // Get numstat line counts without full diff content
  ipcMain.handle(
    IPC_CHANNELS.GIT.NUMSTAT,
    createSafeValidatedHandler(
      NumstatSchema,
      async (_, validated) => {
        const workspaceId = restoreWorkspaceId(validated.workspaceId);
        if (!workspaceId) {
          return { success: false, error: 'Invalid workspace ID' };
        }

        const gitInfo = await getWorkspaceGitInfo(workspaceId);
        if (gitInfo?.isRemote) {
          return { success: false, error: 'Git numstat is not supported for remote workspaces' };
        }

        const result = await gitService.getNumstat(
          workspaceId as WorkspaceId,
          validated.paths,
          validated.staged,
          validated.baseRef,
          validated.baseCommitSha,
          validated.targetRef,
        );
        if (result.ok) {
          return { success: true, data: result.data };
        }
        return { success: false, error: result.error };
      },
      IPC_CHANNELS.GIT.NUMSTAT,
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

          // Remote listBranches retired in P3-5.1; return an error for
          // remote-configured workspaces instead of routing through the
          // legacy remote stack.
          const gitInfo = await getWorkspaceGitInfo(workspaceId);
          if (gitInfo?.isRemote) {
            return { success: false, error: 'List branches is not supported for remote workspaces' };
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
              let remote = remotes.get(name);
              if (!remote) {
                remote = { name, fetchUrl: '', pushUrl: '' };
                remotes.set(name, remote);
              }
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

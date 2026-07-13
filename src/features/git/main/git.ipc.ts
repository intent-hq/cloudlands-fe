/**
 * Git IPC Handlers
 *
 * Registers main-process IPC handlers for the git operations the daemon does
 * not own. Channels with a daemon arm (PROTOCOL §5.6) have been retired here:
 * status, stage, unstage, commit, pull, history/log, commit-details,
 * pullBranch, getBranchStatus, showFile, and — after Wave B — hunk
 * staging/unstaging, discard, push, fetch, branch rename, and lock removal.
 * What remains is the local-only read/inspection surface: branch-base + local
 * diff/numstat, branch listing, is-repository, remote inspection, auto-commit
 * status readback, and background-git-ops status readback.
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
import { GitGetBranchesSchema } from '../../../main/ipc-schemas.js';
import { getWorkspaceGitInfo } from './git-router.js';
import { execAsync } from '../../../shared/git/git-env';
import { getAutoCommitStatuses } from '../../agent/main/auto-commit.service';

const logger = new Logger('GitIPC');
const gitService = new GitService();

// Validation schemas
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
  //
  // Wave B (Audit G F1) — git:stage-hunk / git:unstage-hunk / git:discard /
  // git:push / git:fetch / git:removeLockFile / git:rename-branch also
  // retired: the git-bridge seeder (`src/store/renderer/seeders/
  // git-bridge-seeder.ts`) routes them straight to
  // `git.stageHunk` / `git.unstageHunk` / `git.discard` / `git.push` /
  // `git.fetch` / `git.removeLockFile` / `git.renameBranch` respectively.

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

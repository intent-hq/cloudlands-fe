/**
 * Git IPC Handlers
 *
 * Registers main-process IPC handlers for the git operations the daemon does
 * not own. Channels with a daemon arm (PROTOCOL §5.6) have been retired here,
 * and the GitService-backed handlers (diff, numstat, branch listing,
 * is-repository) were removed as unreachable dead code — the renderer routes
 * those channels through the mock IPC router / git-bridge seeder, never
 * Electron main. What remains is remote inspection, auto-commit status
 * readback, and background-git-ops status readback.
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger.js';
import { IPC_CHANNELS } from '../../../shared/ipc-registry.js';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware.js';
import { z } from 'zod';
import { restoreWorkspaceId } from '../../../shared/types/index.js';
import { execAsync } from '../../../shared/git/git-env';
import { getAutoCommitStatuses } from '../../agent/main/auto-commit.service';

const logger = new Logger('GitIPC');

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
  // git:stage-hunk / git:unstage-hunk / git:discard / git:push / git:fetch /
  // git:removeLockFile / git:rename-branch also retired: the git-bridge
  // seeder (`src/store/renderer/seeders/git-bridge-seeder.ts`) routes them
  // straight to `git.stageHunk` / `git.unstageHunk` / `git.discard` /
  // `git.push` / `git.fetch` / `git.removeLockFile` / `git.renameBranch`
  // respectively.
  //
  // git:diff / git:numstat / git:getBranches / git:isRepository removed as
  // dead code: the renderer's invoke() routes all channels through the mock
  // IPC router + seeders, so these GitService-backed main-process handlers
  // were unreachable.

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

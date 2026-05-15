import type { WorkspaceId } from '$shared/types/branded-ids';
/**
 * Git Tracking IPC
 *
 * IPC handlers for git tracking operations.
 */

import { ipcMain } from 'electron';
import { githubService } from './github.service';
import { Logger } from '../../../shared/logger';
import {
  getGitStateManager,
  initializeGitStateManager,
} from '../git-state-manager-registry';
import type { RemoteGitConfig } from './git-state-manager';
import { WorkspaceService } from '../../workspace/main/workspace.service';
import { GIT_TRACKING_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  GitTrackingGetStateSchema,
  GitTrackingGetSyncStatusSchema,
  GitTrackingSyncSchema,
  GitTrackingGetFileDiffSchema,
  GitTrackingIsGithubAuthenticatedSchema,
  GitTrackingGetGithubBranchesSchema,
  GitTrackingGetPullRequestsSchema,
  GitTrackingSearchPullRequestsSchema,
  GitTrackingGetPullRequestSchema,
  GitTrackingCreatePullRequestSchema,
  GitTrackingGetGithubIssuesSchema,
  GitTrackingSearchGithubIssuesSchema,
  GitTrackingGetRemoteUrlSchema,
  GitTrackingGetCheckRunsSchema,
  GitTrackingGetPRReviewsSchema,
} from '../../../main/ipc-schemas';
import { execAsync } from '../../../shared/git/git-env';

const logger = new Logger('GitTrackingIPC');
const workspaceService = new WorkspaceService();

/**
 * Setup git tracking IPC handlers
 */
export function setupGitTrackingIPC(): void {
  logger.info('Setting up git tracking IPC handlers');

  // Get git state
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_STATE,
    createSafeValidatedHandler(
      GitTrackingGetStateSchema,
      async (_, { workspaceId }) => {
        try {
          let gitStateManager = getGitStateManager(workspaceId);

          if (!gitStateManager) {
            // Get workspace to find worktree path
            const workspace = await workspaceService.getWorkspace(workspaceId as WorkspaceId);
            if (!workspace.ok || !workspace.data?.worktreePath) {
              return { success: false, error: 'Workspace not found or has no worktree' };
            }

            // Build config with remote support if needed
            let remoteConfig: RemoteGitConfig | undefined;
            if (workspace.data.isRemote) {
              remoteConfig = {
                workspaceId,
              };
            }

            // Initialize git state manager
            gitStateManager = await initializeGitStateManager(
              workspaceId,
              workspace.data.worktreePath,
              {
                remoteConfig,
              },
            );
          }

          const state = gitStateManager.getState();
          return { success: true, data: state };
        } catch (error) {
          logger.error('Failed to get git state', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_STATE,
    ),
  );

  // Get sync status
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_SYNC_STATUS,
    createSafeValidatedHandler(
      GitTrackingGetSyncStatusSchema,
      async (_, { workspaceId }) => {
        try {
          const gitStateManager = getGitStateManager(workspaceId);
          if (!gitStateManager) {
            return { success: false, error: 'Git state manager not initialized' };
          }

          const status = gitStateManager.getSyncStatus();
          return { success: true, data: status };
        } catch (error) {
          logger.error('Failed to get sync status', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_SYNC_STATUS,
    ),
  );

  // Sync git state
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.SYNC,
    createSafeValidatedHandler(
      GitTrackingSyncSchema,
      async (_, { workspaceId }) => {
        try {
          const gitStateManager = getGitStateManager(workspaceId);
          if (!gitStateManager) {
            return { success: false, error: 'Git state manager not initialized' };
          }

          await gitStateManager.syncState();
          const state = gitStateManager.getState();
          return { success: true, data: state };
        } catch (error) {
          logger.error('Failed to sync git state', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.SYNC,
    ),
  );

  // Get file diff
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_FILE_DIFF,
    createSafeValidatedHandler(
      GitTrackingGetFileDiffSchema,
      async (_, { workspaceId, filePath, staged }) => {
        try {
          const gitStateManager = getGitStateManager(workspaceId);
          if (!gitStateManager) {
            return { success: false, error: 'Git state manager not initialized' };
          }

          const diff = await gitStateManager.getFileDiff(filePath, staged);
          return { success: true, data: diff };
        } catch (error) {
          logger.error('Failed to get file diff', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_FILE_DIFF,
    ),
  );

  // Check GitHub authentication
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.IS_GITHUB_AUTHENTICATED,
    createSafeValidatedHandler(
      GitTrackingIsGithubAuthenticatedSchema,
      async () => {
        try {
          const authenticated = await githubService.isAuthenticated();
          return { success: true, data: authenticated };
        } catch (error) {
          logger.error('Failed to check GitHub authentication', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.IS_GITHUB_AUTHENTICATED,
    ),
  );

  // Get branches for a GitHub repository (uses authenticated access if available)
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_GITHUB_BRANCHES,
    createSafeValidatedHandler(
      GitTrackingGetGithubBranchesSchema,
      async (_, { owner, repo }) => {
        try {
          const result = await githubService.getBranches(owner, repo);
          if (result) {
            return { success: true, data: result };
          } else {
            return {
              success: false,
              error: 'Not authenticated with GitHub',
            };
          }
        } catch (error) {
          logger.error('Failed to get GitHub branches', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_GITHUB_BRANCHES,
    ),
  );

  // Get pull requests
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_PULL_REQUESTS,
    createSafeValidatedHandler(
      GitTrackingGetPullRequestsSchema,
      async (_, { owner, repo, options, force }) => {
        try {
          const pullRequests = await githubService.getPullRequests(owner, repo, {
            ...(options && typeof options === 'object' ? options : {}),
            force,
          });
          return { success: true, data: pullRequests };
        } catch (error) {
          logger.error('Failed to get pull requests', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_PULL_REQUESTS,
    ),
  );

  // Search pull requests with filter (uses GitHub search API with @me)
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.SEARCH_PULL_REQUESTS,
    createSafeValidatedHandler(
      GitTrackingSearchPullRequestsSchema,
      async (_, { owner, repo, options, force }) => {
        try {
          const pullRequests = await githubService.searchPullRequests(owner, repo, {
            ...(options && typeof options === 'object' ? options : {}),
            force,
          });
          return { success: true, data: pullRequests };
        } catch (error) {
          logger.error('Failed to search pull requests', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.SEARCH_PULL_REQUESTS,
    ),
  );

  // Get single pull request
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_PULL_REQUEST,
    createSafeValidatedHandler(
      GitTrackingGetPullRequestSchema,
      async (_, { owner, repo, number, force }) => {
        try {
          const pullRequest = await githubService.getPullRequest(owner, repo, number, { force });
          return { success: true, data: pullRequest };
        } catch (error) {
          logger.error('Failed to get pull request', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_PULL_REQUEST,
    ),
  );

  // Create pull request
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.CREATE_PULL_REQUEST,
    createSafeValidatedHandler(
      GitTrackingCreatePullRequestSchema,
      async (_, { owner, repo, options }) => {
        try {
          const pullRequest = await githubService.createPullRequest(owner, repo, options);
          return { success: true, data: pullRequest };
        } catch (error) {
          logger.error('Failed to create pull request', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.CREATE_PULL_REQUEST,
    ),
  );

  // Get GitHub issues
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_GITHUB_ISSUES,
    createSafeValidatedHandler(
      GitTrackingGetGithubIssuesSchema,
      async (_, { owner, repo, options }) => {
        try {
          const issues = await githubService.getIssues(owner, repo, options);
          return { success: true, data: issues };
        } catch (error) {
          logger.error('Failed to get GitHub issues', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_GITHUB_ISSUES,
    ),
  );

  // Search GitHub issues with filter (uses GitHub search API with @me and is:issue)
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.SEARCH_GITHUB_ISSUES,
    createSafeValidatedHandler(
      GitTrackingSearchGithubIssuesSchema,
      async (_, { owner, repo, options }) => {
        try {
          const issues = await githubService.searchIssues(owner, repo, options);
          return { success: true, data: issues };
        } catch (error) {
          logger.error('Failed to search GitHub issues', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.SEARCH_GITHUB_ISSUES,
    ),
  );

  // Get remote URL for a repository path
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_REMOTE_URL,
    createSafeValidatedHandler(
      GitTrackingGetRemoteUrlSchema,
      async (_, { repoPath }) => {
        try {
          const { stdout } = await execAsync('git config --get remote.origin.url', {
            cwd: repoPath,
          });
          const remoteUrl = stdout.trim();

          // Parse owner/repo from the remote URL
          const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
          if (match) {
            return {
              success: true,
              data: {
                remoteUrl,
                owner: match[1],
                repo: match[2],
              },
            };
          }

          return {
            success: true,
            data: { remoteUrl, owner: null, repo: null },
          };
        } catch (error) {
          logger.debug('Failed to get remote URL', { repoPath, error: (error as Error).message });
          return {
            success: true,
            data: { remoteUrl: '', owner: null, repo: null },
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_REMOTE_URL,
    ),
  );

  // Get check runs for a commit
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_CHECK_RUNS,
    createSafeValidatedHandler(
      GitTrackingGetCheckRunsSchema,
      async (_, { owner, repo, commitSha }) => {
        try {
          const checkRuns = await githubService.getCheckRuns(owner, repo, commitSha);
          return { success: true, data: checkRuns };
        } catch (error) {
          logger.error('Failed to get check runs', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_CHECK_RUNS,
    ),
  );

  // Get PR reviews
  ipcMain.handle(
    GIT_TRACKING_CHANNELS.GET_PR_REVIEWS,
    createSafeValidatedHandler(
      GitTrackingGetPRReviewsSchema,
      async (_, { owner, repo, number }) => {
        try {
          const reviews = await githubService.getReviews(owner, repo, number);
          return { success: true, data: reviews };
        } catch (error) {
          logger.error('Failed to get PR reviews', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      GIT_TRACKING_CHANNELS.GET_PR_REVIEWS,
    ),
  );

  // Set up event forwarding
  setupEventForwarding();
}

/**
 * Set up event forwarding from git state manager to renderer
 */
function setupEventForwarding(): void {
  // This would be called when git state changes
  // For now, we'll rely on the activity log integration to forward events
}

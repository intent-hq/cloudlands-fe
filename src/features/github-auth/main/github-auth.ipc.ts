import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import type { GithubRepo } from '../../../shared/augment-api/augment-api.client';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { GITHUB_AUTH_CHANNELS } from '../constants';
import { githubAuthService } from './github-auth.service';
import { refreshGitHubAuthStatus } from '../../agent/main/specialists.service';

const logger = new Logger('GitHubAuthIPC');

/**
 * The daemon `github.*` wire returns GitHub repos in camelCase, whereas the
 * renderer + saga consumers expect the GitHub-native snake_case `GithubRepo`
 * shape. Translate at this boundary so the UI stays byte-for-byte unchanged.
 */
interface DaemonGithubRepo {
  owner: string;
  name: string;
  htmlUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  defaultBranch?: string;
}

function toConsumerRepo(repo: DaemonGithubRepo): GithubRepo {
  return {
    owner: repo.owner,
    name: repo.name,
    html_url: repo.htmlUrl,
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
    default_branch: repo.defaultBranch,
  };
}

export function setupGitHubAuthIPC(): void {
  logger.info('Setting up GitHub Auth IPC handlers');

  // Check if user is authenticated with GitHub via Augment
  ipcMain.handle(GITHUB_AUTH_CHANNELS.IS_AUTHENTICATED, async () => githubAuthService.isAuthenticated());

  // Get GitHub user info (may be null if not available from Augment API)
  ipcMain.handle(GITHUB_AUTH_CHANNELS.GET_USER, async () => githubAuthService.getUser());

  // Start GitHub authentication - opens OAuth URL in browser
  ipcMain.handle(GITHUB_AUTH_CHANNELS.START_AUTH, async () => {
    try {
      const result = await githubAuthService.startAuth();
      return result;
    } catch (error) {
      logger.error('Failed to start auth flow', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Check if authentication completed after OAuth redirect
  // This replaces the old pollForToken - client should call this periodically
  ipcMain.handle(GITHUB_AUTH_CHANNELS.POLL_FOR_TOKEN, async () => {
    try {
      const isComplete = await githubAuthService.checkAuthComplete();
      if (isComplete) {
        const user = await githubAuthService.getUser();
        // Refresh cached GitHub auth status so specialists list updates
        refreshGitHubAuthStatus().catch((e) =>
          logger.warn('Failed to refresh GitHub auth status for specialists', e as Error),
        );
        return { success: true, data: { user, isComplete: true } };
      }
      return { success: true, data: { isComplete: false } };
    } catch (error) {
      logger.error('Auth check failed', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Cancel ongoing authentication
  ipcMain.handle(GITHUB_AUTH_CHANNELS.CANCEL_AUTH, async () => {
    githubAuthService.cancelAuth();
    return { success: true };
  });

  // Clear cached authentication state
  ipcMain.handle(GITHUB_AUTH_CHANNELS.LOGOUT, async () => {
    await githubAuthService.clearAuth();
    return { success: true };
  });

  // Get full authentication state for UI
  ipcMain.handle(GITHUB_AUTH_CHANNELS.GET_AUTH_STATE, async () => githubAuthService.getAuthState());

  // Get GitHub status from Augment API
  ipcMain.handle(GITHUB_AUTH_CHANNELS.GET_STATUS, async () => githubAuthService.getGitHubStatus(true));

  // List GitHub repositories for the authenticated user.
  // The daemon paginates via an opaque `nextToken` cursor (not numeric pages),
  // so we walk the cursor and accumulate the full list to preserve the prior
  // "fetch all" behavior the renderer relies on. The legacy `page` arg is
  // accepted for channel compatibility but no longer drives pagination.
  ipcMain.handle(GITHUB_AUTH_CHANNELS.LIST_REPOS, async (_event, { page }: { page?: number }) => {
    try {
      logger.info('IPC: Listing GitHub repos', { page });
      const allRepos: GithubRepo[] = [];
      let nextToken: string | undefined;
      const maxPages = 20; // Safety limit to avoid infinite cursor loops
      for (let i = 0; i < maxPages; i++) {
        const response = await getBackendClient().request<{
          repos?: DaemonGithubRepo[];
          nextToken?: string;
        }>('github.repos.list', { limit: 100, nextToken });
        if (response?.repos?.length) {
          allRepos.push(...response.repos.map(toConsumerRepo));
        }
        nextToken = response?.nextToken;
        if (!nextToken) break;
      }
      logger.info('IPC: Got GitHub repos', { count: allRepos.length });
      return { success: true, data: allRepos };
    } catch (error) {
      logger.error('IPC: Failed to list GitHub repos', error as Error, {
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
      });
      return { success: false, error: (error as Error).message };
    }
  });

  // Global GitHub repo search via the daemon `github.repos.search` method.
  ipcMain.handle(
    GITHUB_AUTH_CHANNELS.SEARCH_REPOS,
    async (_event, { query }: { query: string }) => {
      try {
        logger.info('IPC: Searching GitHub repos', { query });
        const response = await getBackendClient().request<{
          repos?: DaemonGithubRepo[];
          nextToken?: string;
        }>('github.repos.search', { query, limit: 20 });
        const repos = (response?.repos ?? []).map(toConsumerRepo);
        logger.info('IPC: Got search results', { count: repos.length });
        return { success: true, data: repos };
      } catch (error) {
        logger.error('IPC: Failed to search GitHub repos', error as Error, {
          errorMessage: (error as Error).message,
        });
        return { success: false, error: (error as Error).message };
      }
    },
  );
}

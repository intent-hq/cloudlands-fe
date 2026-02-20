import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { augmentApiClient } from '../../../shared/augment-api/augment-api.client';
import { GITHUB_AUTH_CHANNELS } from '../constants';
import { githubAuthService } from './github-auth.service';

const logger = new Logger('GitHubAuthIPC');

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

  // List GitHub repositories for the authenticated user
  ipcMain.handle(GITHUB_AUTH_CHANNELS.LIST_REPOS, async (_event, { page }: { page?: number }) => {
    try {
      logger.info('IPC: Listing GitHub repos', { page });
      const repos = await augmentApiClient.listGitHubRepos(page);
      logger.info('IPC: Got GitHub repos', { count: repos.length });
      return { success: true, data: repos };
    } catch (error) {
      logger.error('IPC: Failed to list GitHub repos', error as Error, {
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
      });
      return { success: false, error: (error as Error).message };
    }
  });
}

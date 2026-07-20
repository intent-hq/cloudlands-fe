import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { LINEAR_AUTH_CHANNELS } from '../constants';
import { linearAuthService } from './linear-auth.service';

const logger = new Logger('LinearAuthIPC');

export function setupLinearAuthIPC(): void {
  logger.info('Setting up Linear Auth IPC handlers');

  // Check if user is authenticated with Linear via the daemon
  ipcMain.handle(LINEAR_AUTH_CHANNELS.IS_AUTHENTICATED, async () => linearAuthService.isAuthenticated());

  // Start Linear authentication flow
  ipcMain.handle(LINEAR_AUTH_CHANNELS.START_AUTH, async () => {
    try {
      return await linearAuthService.startAuth();
    } catch (error) {
      logger.error('Failed to start Linear auth', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start authentication',
      };
    }
  });

  // Cancel ongoing authentication (just clears state)
  ipcMain.handle(LINEAR_AUTH_CHANNELS.CANCEL_AUTH, async () => {
    // Nothing to cancel for OAuth flow
    return;
  });

  // Logout / revoke Linear access
  ipcMain.handle(LINEAR_AUTH_CHANNELS.LOGOUT, async () => linearAuthService.revokeAccess());

  // Get full authentication state for UI
  // Args: [forceRefresh?: boolean]
  ipcMain.handle(LINEAR_AUTH_CHANNELS.GET_AUTH_STATE, async (_event, forceRefresh?: boolean) => linearAuthService.getAuthState(forceRefresh ?? false));

  // Get Linear status from daemon API
  ipcMain.handle(LINEAR_AUTH_CHANNELS.GET_STATUS, async () => linearAuthService.getLinearStatus(true));

  // Fetch issues based on filter type
  ipcMain.handle(
    LINEAR_AUTH_CHANNELS.FETCH_MY_ISSUES,
    async (_event, filter: 'assigned' | 'created' | 'subscribed' | 'team' | 'all' = 'assigned') => {
      try {
        return await linearAuthService.fetchMyIssues(filter);
      } catch (error) {
        logger.error('Failed to fetch Linear issues', error as Error);
        return [];
      }
    },
  );

  // Search issues by query
  ipcMain.handle(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, async (_event, query: string) => {
    try {
      return await linearAuthService.searchIssues(query);
    } catch (error) {
      logger.error('Failed to search Linear issues', error as Error);
      return [];
    }
  });

  logger.info('Linear Auth IPC handlers registered');
}

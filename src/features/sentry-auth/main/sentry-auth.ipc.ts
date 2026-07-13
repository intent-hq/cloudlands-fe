/**
 * Sentry Auth IPC Handlers
 *
 * Registers IPC handlers for Sentry authentication and issue operations.
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { SENTRY_AUTH_CHANNELS } from '../constants';
import type { FetchIssuesRequest } from '../types';
import { sentryAuthService } from './sentry-auth.service';

const logger = new Logger('SentryAuthIPC');

export function setupSentryAuthIPC(): void {
  logger.info('Setting up Sentry Auth IPC handlers');

  // Check if user is authenticated with Sentry
  ipcMain.handle(SENTRY_AUTH_CHANNELS.IS_AUTHENTICATED, async () => sentryAuthService.isAuthenticated());

  // Save Sentry configuration (org slug + API token)
  ipcMain.handle(
    SENTRY_AUTH_CHANNELS.SAVE_CONFIG,
    async (_event, data: { organization: string; apiToken: string }) => {
      try {
        return await sentryAuthService.saveConfig(data.organization, data.apiToken);
      } catch (error) {
        logger.error('Failed to save Sentry config', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save configuration',
        };
      }
    },
  );

  // Get full authentication state for UI
  ipcMain.handle(SENTRY_AUTH_CHANNELS.GET_AUTH_STATE, async () => sentryAuthService.getAuthState());

  // Logout / clear Sentry config
  ipcMain.handle(SENTRY_AUTH_CHANNELS.LOGOUT, async () => {
    await sentryAuthService.logout();
    return { success: true };
  });

  // Fetch projects for the configured organization
  ipcMain.handle(SENTRY_AUTH_CHANNELS.FETCH_PROJECTS, async () => {
    try {
      return await sentryAuthService.fetchProjects();
    } catch (error) {
      logger.error('Failed to fetch Sentry projects', error as Error);
      return [];
    }
  });

  // Fetch issues for a project or organization
  ipcMain.handle(
    SENTRY_AUTH_CHANNELS.FETCH_ISSUES,
    async (_event, request?: FetchIssuesRequest) => {
      try {
        return await sentryAuthService.fetchIssues(request);
      } catch (error) {
        logger.error('Failed to fetch Sentry issues', error as Error);
        return [];
      }
    },
  );

  // Search issues by query
  ipcMain.handle(
    SENTRY_AUTH_CHANNELS.SEARCH_ISSUES,
    async (_event, data: { query: string; project?: string }) => {
      try {
        return await sentryAuthService.searchIssues(data.query, data.project);
      } catch (error) {
        logger.error('Failed to search Sentry issues', error as Error);
        return [];
      }
    },
  );

  // Get a specific issue by ID
  ipcMain.handle(SENTRY_AUTH_CHANNELS.GET_ISSUE, async (_event, issueId: string) => {
    try {
      return await sentryAuthService.getIssue(issueId);
    } catch (error) {
      logger.error('Failed to get Sentry issue', error as Error);
      return null;
    }
  });

  logger.info('Sentry Auth IPC handlers registered');
}

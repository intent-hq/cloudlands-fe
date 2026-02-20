/**
 * Sentry Auth Client
 *
 * Renderer-side client for Sentry authentication and issue operations.
 * Communicates with the main process via IPC.
 */

import { invoke } from '$lib/electron-bridge';
import { SENTRY_AUTH_CHANNELS } from '../constants';
import type {
  FetchIssuesRequest,
  SaveConfigResult,
  SentryAuthState,
  SentryIssueResult,
  SentryProject,
} from '../types';

export const sentryAuthClient = {
  /**
   * Check if user is authenticated with Sentry
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      return await invoke<boolean>(SENTRY_AUTH_CHANNELS.IS_AUTHENTICATED);
    } catch {
      return false;
    }
  },

  /**
   * Save Sentry configuration (org slug + API token)
   */
  async saveConfig(organization: string, apiToken: string): Promise<SaveConfigResult> {
    return await invoke<SaveConfigResult>(SENTRY_AUTH_CHANNELS.SAVE_CONFIG, {
      organization,
      apiToken,
    });
  },

  /**
   * Get full authentication state for UI
   */
  async getAuthState(): Promise<SentryAuthState> {
    try {
      return await invoke<SentryAuthState>(SENTRY_AUTH_CHANNELS.GET_AUTH_STATE);
    } catch {
      return { isAuthenticated: false };
    }
  },

  /**
   * Logout / clear Sentry config
   */
  async logout(): Promise<void> {
    await invoke(SENTRY_AUTH_CHANNELS.LOGOUT);
  },

  /**
   * Fetch projects for the configured organization
   */
  async fetchProjects(): Promise<SentryProject[]> {
    try {
      return await invoke<SentryProject[]>(SENTRY_AUTH_CHANNELS.FETCH_PROJECTS);
    } catch {
      return [];
    }
  },

  /**
   * Fetch issues for a project or organization
   */
  async fetchIssues(request?: FetchIssuesRequest): Promise<SentryIssueResult[]> {
    try {
      return await invoke<SentryIssueResult[]>(SENTRY_AUTH_CHANNELS.FETCH_ISSUES, request);
    } catch {
      return [];
    }
  },

  /**
   * Search issues by query
   */
  async searchIssues(query: string, project?: string): Promise<SentryIssueResult[]> {
    try {
      return await invoke<SentryIssueResult[]>(SENTRY_AUTH_CHANNELS.SEARCH_ISSUES, {
        query,
        project,
      });
    } catch {
      return [];
    }
  },

  /**
   * Get a specific issue by ID
   */
  async getIssue(issueId: string): Promise<SentryIssueResult | null> {
    try {
      return await invoke<SentryIssueResult | null>(SENTRY_AUTH_CHANNELS.GET_ISSUE, issueId);
    } catch {
      return null;
    }
  },
};

// Re-export types for convenience
export type { SentryIssueResult, SentryProject } from '../types';

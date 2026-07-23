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
  SentryIssuePage,
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
   * Fetch issues for a project or organization (first page only)
   */
  async fetchIssues(request?: FetchIssuesRequest): Promise<SentryIssueResult[]> {
    return (await this.fetchIssuesPage(request)).issues;
  },

  /**
   * Fetch one cursor-paginated page of issues (PROTOCOL §5.29).
   * Pass `request.nextToken` from a previous page to continue.
   */
  async fetchIssuesPage(request?: FetchIssuesRequest): Promise<SentryIssuePage> {
    try {
      return await invoke<SentryIssuePage>(SENTRY_AUTH_CHANNELS.FETCH_ISSUES, request);
    } catch {
      return { issues: [], nextToken: null };
    }
  },

  /**
   * Search issues by query (first page only)
   */
  async searchIssues(query: string, project?: string): Promise<SentryIssueResult[]> {
    return (await this.searchIssuesPage(query, project)).issues;
  },

  /**
   * Search one cursor-paginated page of issues (PROTOCOL §5.29).
   * @param options - Optional `limit` and opaque `nextToken` cursor
   */
  async searchIssuesPage(
    query: string,
    project?: string,
    options?: { limit?: number; nextToken?: string },
  ): Promise<SentryIssuePage> {
    try {
      return await invoke<SentryIssuePage>(SENTRY_AUTH_CHANNELS.SEARCH_ISSUES, {
        query,
        project,
        ...options,
      });
    } catch {
      return { issues: [], nextToken: null };
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
export type { SentryIssuePage, SentryIssueResult, SentryProject } from '../types';

import { invoke } from '$lib/electron-bridge';
import { LINEAR_AUTH_CHANNELS } from '../constants';
import type { LinearAuthState, LinearAuthStatus } from '../types';

/**
 * Linear Auth Client
 *
 * Renderer-side client for Linear read operations, bridged to the daemon's
 * `linear.*` namespace (PROTOCOL §5.28). There is no OAuth flow in the
 * API-key model — connect/disconnect run through the daemon settings seam
 * (see linear-auth-store-service.ts), so this client exposes reads only.
 */
export const linearAuthClient = {
  /**
   * Check if user is authenticated with Linear
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      return await invoke<boolean>(LINEAR_AUTH_CHANNELS.IS_AUTHENTICATED);
    } catch {
      return false;
    }
  },

  /**
   * Get full authentication state for UI
   * @param forceRefresh - If true, bypass cache and fetch fresh status from API
   */
  async getAuthState(forceRefresh = false): Promise<LinearAuthState> {
    try {
      return await invoke<LinearAuthState>(LINEAR_AUTH_CHANNELS.GET_AUTH_STATE, forceRefresh);
    } catch {
      return {
        isAuthenticated: false,
        requiresDaemonAuth: true,
      };
    }
  },

  /**
   * Get Linear status from daemon API
   */
  async getStatus(): Promise<LinearAuthStatus> {
    try {
      return await invoke<LinearAuthStatus>(LINEAR_AUTH_CHANNELS.GET_STATUS);
    } catch {
      return {
        isConfigured: false,
        oauthUrl: '',
      };
    }
  },

  /**
   * Fetch issues based on filter type (first page only).
   * @param filter - The type of issues to fetch (defaults to 'assigned')
   */
  async fetchMyIssues(
    filter: 'assigned' | 'created' | 'subscribed' | 'team' | 'all' = 'assigned',
  ): Promise<LinearIssueResult[]> {
    return (await this.fetchMyIssuesPage(filter)).issues;
  },

  /**
   * Fetch one cursor-paginated page of issues (PROTOCOL §5.28).
   * @param options - Optional `limit` and opaque `nextToken` cursor
   */
  async fetchMyIssuesPage(
    filter: 'assigned' | 'created' | 'subscribed' | 'team' | 'all' = 'assigned',
    options?: LinearIssuePageOptions,
  ): Promise<LinearIssuePage> {
    try {
      return await invoke<LinearIssuePage>(LINEAR_AUTH_CHANNELS.FETCH_MY_ISSUES, filter, options);
    } catch {
      return { issues: [], nextToken: null };
    }
  },

  /**
   * Search issues by query (first page only).
   */
  async searchIssues(query: string): Promise<LinearIssueResult[]> {
    return (await this.searchIssuesPage(query)).issues;
  },

  /**
   * Search one cursor-paginated page of issues (PROTOCOL §5.28).
   * @param options - Optional `limit` and opaque `nextToken` cursor
   */
  async searchIssuesPage(
    query: string,
    options?: LinearIssuePageOptions,
  ): Promise<LinearIssuePage> {
    try {
      return await invoke<LinearIssuePage>(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, query, options);
    } catch {
      return { issues: [], nextToken: null };
    }
  },
};

/** Cursor-pagination options for the issue reads (PROTOCOL §5.28). */
export interface LinearIssuePageOptions {
  limit?: number;
  /** Opaque cursor from a previous page's `nextToken`. */
  nextToken?: string;
}

/** One page of the cursor-paginated issue reads (PROTOCOL §5.28). */
export interface LinearIssuePage {
  issues: LinearIssueResult[];
  /** Opaque cursor for the next page, or `null` when this is the last page. */
  nextToken: string | null;
}

/**
 * Simplified Linear issue result for the UI
 */
export interface LinearIssueResult {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url?: string;
  teamName?: string;
  teamKey?: string;
  state?: string;
  priority?: number;
  /** Assignee name */
  assignee?: string;
  /** Labels as array of names */
  labels?: string[];
  /** Project name */
  project?: string;
  /** Creator/author name */
  creator?: string;
  /** Created timestamp */
  createdAt?: string;
  /** Updated timestamp */
  updatedAt?: string;
}

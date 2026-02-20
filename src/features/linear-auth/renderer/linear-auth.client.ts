import { invoke } from '$lib/electron-bridge';
import { LINEAR_AUTH_CHANNELS } from '../constants';
import type { LinearAuthState, LinearAuthStatus, StartAuthResult } from '../types';

/**
 * Linear Auth Client
 *
 * Renderer-side client for Linear authentication operations.
 * Communicates with the main process via IPC.
 */
export const linearAuthClient = {
  /**
   * Check if user is authenticated with Linear via Augment
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      return await invoke<boolean>(LINEAR_AUTH_CHANNELS.IS_AUTHENTICATED);
    } catch {
      return false;
    }
  },

  /**
   * Start Linear authentication - opens OAuth URL in browser
   */
  async startAuth(): Promise<StartAuthResult> {
    return await invoke<StartAuthResult>(LINEAR_AUTH_CHANNELS.START_AUTH);
  },

  /**
   * Cancel ongoing authentication
   */
  async cancelAuth(): Promise<void> {
    await invoke(LINEAR_AUTH_CHANNELS.CANCEL_AUTH);
  },

  /**
   * Logout / revoke Linear access
   */
  async logout(): Promise<boolean> {
    try {
      return await invoke<boolean>(LINEAR_AUTH_CHANNELS.LOGOUT);
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
        requiresAugmentAuth: true,
      };
    }
  },

  /**
   * Get Linear status from Augment API
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
   * Fetch issues based on filter type
   * @param filter - The type of issues to fetch (defaults to 'assigned')
   */
  async fetchMyIssues(
    filter: 'assigned' | 'created' | 'subscribed' | 'team' | 'all' = 'assigned',
  ): Promise<LinearIssueResult[]> {
    try {
      return await invoke<LinearIssueResult[]>(LINEAR_AUTH_CHANNELS.FETCH_MY_ISSUES, filter);
    } catch {
      return [];
    }
  },

  /**
   * Search issues by query
   */
  async searchIssues(query: string): Promise<LinearIssueResult[]> {
    try {
      return await invoke<LinearIssueResult[]>(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, query);
    } catch {
      return [];
    }
  },
};

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

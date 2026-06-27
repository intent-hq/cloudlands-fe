import { Logger } from '../../../shared/logger';
import type { LinearAuthState, LinearAuthStatus, StartAuthResult } from '../types';

const logger = new Logger('LinearAuthService');

/**
 * Linear Authentication Service
 *
 * The Linear integration is intentionally mocked to a no-op: the UI still
 * renders but the service makes ZERO real calls (no Augment cloud, no Linear
 * cloud). Every method returns an inert "not connected" result — status reads
 * report not-connected, the auth/login flow does nothing, revoke reports
 * success, and issue fetches return empty arrays.
 */
export class LinearAuthService {
  /**
   * Check if user is authenticated with Linear.
   * Linear integration is mocked to a no-op; always reports not connected.
   */
  async isAuthenticated(): Promise<boolean> {
    const status = await this.getLinearStatus();
    return status.isConfigured;
  }

  /**
   * Get Linear status. Inert no-op: always not connected, never hits the network.
   */
  async getLinearStatus(_forceRefresh = false): Promise<LinearAuthStatus> {
    return {
      isConfigured: false,
      oauthUrl: '',
    };
  }

  /**
   * Start Linear authentication flow.
   * Inert no-op: never opens a URL or contacts any cloud service.
   */
  async startAuth(): Promise<StartAuthResult> {
    logger.info('Linear authentication is unavailable (integration disabled)');
    return {
      success: false,
      error: 'Linear integration is currently unavailable.',
    };
  }

  /**
   * Check if authentication completed. Inert no-op: always not connected.
   */
  async checkAuthComplete(): Promise<boolean> {
    const status = await this.getLinearStatus(true);
    return status.isConfigured;
  }

  /**
   * Revoke Linear access. Inert no-op that reports success.
   */
  async revokeAccess(): Promise<boolean> {
    logger.info('Linear access revoke is a no-op (integration disabled)');
    return true;
  }

  /**
   * Get the full authentication state for the UI.
   * Inert no-op: always not connected with no user.
   */
  async getAuthState(_forceRefresh = false): Promise<LinearAuthState> {
    return {
      isAuthenticated: false,
      requiresAugmentAuth: false,
    };
  }

  /**
   * Fetch Linear issues. Inert no-op: always returns an empty list, no network.
   * @param _filter - The type of issues to fetch (ignored)
   */
  async fetchMyIssues(
    _filter: 'assigned' | 'created' | 'subscribed' | 'team' | 'all' = 'assigned',
  ): Promise<LinearIssueResult[]> {
    return [];
  }

  /**
   * Search Linear issues. Inert no-op: always returns an empty list, no network.
   */
  async searchIssues(_searchQuery: string): Promise<LinearIssueResult[]> {
    return [];
  }
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

// Singleton instance
export const linearAuthService = new LinearAuthService();

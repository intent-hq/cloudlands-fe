/**
 * Sentry Auth Store
 *
 * Svelte 5 runes-based store for Sentry authentication and issue state.
 */

import { sentryAuthClient, type SentryIssueResult, type SentryProject } from './sentry-auth.client';
import type { SentryIssueStatusType } from '../constants';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('SentryAuthStore');

interface SentryAuthStoreState {
  /** Whether user is authenticated with Sentry */
  isAuthenticated: boolean;
  /** Configured organization slug */
  organization: string | null;
  /** Whether authentication/connection is in progress */
  isConnecting: boolean;
  /** Error message if any */
  error: string | null;
  /** Cached projects for the organization */
  projects: SentryProject[];
  /** Whether projects are being loaded */
  isLoadingProjects: boolean;
  /** Cached issues */
  issues: SentryIssueResult[];
  /** Whether issues are being loaded */
  isLoadingIssues: boolean;
}

function createSentryAuthStore() {
  const state = $state<SentryAuthStoreState>({
    isAuthenticated: false,
    organization: null,
    isConnecting: false,
    error: null,
    projects: [],
    isLoadingProjects: false,
    issues: [],
    isLoadingIssues: false,
  });

  async function initialize() {
    const authState = await sentryAuthClient.getAuthState();
    state.isAuthenticated = authState.isAuthenticated;
    state.organization = authState.organization ?? null;
    state.error = authState.error ?? null;
    logger.debug('Initialized', { isAuthenticated: authState.isAuthenticated });
  }

  async function connect(organization: string, apiToken: string): Promise<boolean> {
    state.error = null;
    state.isConnecting = true;

    try {
      const result = await sentryAuthClient.saveConfig(organization, apiToken);

      if (!result.success) {
        state.error = result.error ?? 'Failed to connect to Sentry';
        state.isConnecting = false;
        return false;
      }

      state.isAuthenticated = true;
      state.organization = organization;
      state.isConnecting = false;

      // Fetch projects after successful connection
      await fetchProjects();

      return true;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Failed to connect to Sentry';
      state.isConnecting = false;
      return false;
    }
  }

  async function logout() {
    await sentryAuthClient.logout();
    state.isAuthenticated = false;
    state.organization = null;
    state.projects = [];
    state.issues = [];
  }

  function clearError() {
    state.error = null;
  }

  async function refresh() {
    await initialize();
  }

  async function fetchProjects(): Promise<SentryProject[]> {
    if (!state.isAuthenticated) {
      return [];
    }

    state.isLoadingProjects = true;
    try {
      const projects = await sentryAuthClient.fetchProjects();
      state.projects = projects;
      return projects;
    } catch (error) {
      logger.error('Failed to fetch projects', error);
      return [];
    } finally {
      state.isLoadingProjects = false;
    }
  }

  async function fetchIssues(
    status?: SentryIssueStatusType | 'all',
    project?: string,
  ): Promise<SentryIssueResult[]> {
    if (!state.isAuthenticated) {
      return [];
    }

    state.isLoadingIssues = true;
    try {
      const issues = await sentryAuthClient.fetchIssues({ status, project });
      state.issues = issues;
      return issues;
    } catch (error) {
      logger.error('Failed to fetch issues', error);
      return [];
    } finally {
      state.isLoadingIssues = false;
    }
  }

  async function searchIssues(query: string, project?: string): Promise<SentryIssueResult[]> {
    if (!state.isAuthenticated) {
      return [];
    }

    state.isLoadingIssues = true;
    try {
      return await sentryAuthClient.searchIssues(query, project);
    } catch (error) {
      logger.error('Failed to search issues', error);
      return [];
    } finally {
      state.isLoadingIssues = false;
    }
  }

  return {
    get state() {
      return state;
    },
    initialize,
    connect,
    logout,
    clearError,
    refresh,
    fetchProjects,
    fetchIssues,
    searchIssues,
  };
}

export const sentryAuthStore = createSentryAuthStore();

// Re-export types for convenience
export type { SentryIssueResult, SentryProject } from './sentry-auth.client';

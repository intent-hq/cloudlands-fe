/**
 * Sentry Integration Constants
 */

/**
 * IPC channel names for Sentry authentication and issue operations
 */
export const SENTRY_AUTH_CHANNELS = {
  /** Check if user is authenticated with Sentry */
  IS_AUTHENTICATED: 'sentry-auth:is-authenticated',
  /** Save Sentry configuration (org slug + API token) */
  SAVE_CONFIG: 'sentry-auth:save-config',
  /** Get full authentication state */
  GET_AUTH_STATE: 'sentry-auth:get-auth-state',
  /** Logout / clear Sentry config */
  LOGOUT: 'sentry-auth:logout',
  /** Fetch projects for the configured organization */
  FETCH_PROJECTS: 'sentry-auth:fetch-projects',
  /** Fetch issues for a project or organization */
  FETCH_ISSUES: 'sentry-auth:fetch-issues',
  /** Search issues by query */
  SEARCH_ISSUES: 'sentry-auth:search-issues',
  /** Get a specific issue by ID */
  GET_ISSUE: 'sentry-auth:get-issue',
} as const;

/**
 * Sentry issue status values
 */
export type SentryIssueStatusType = 'resolved' | 'unresolved' | 'ignored';

/**
 * Sentry issue level/severity values
 */
export type SentryIssueLevelType = 'error' | 'warning' | 'info' | 'fatal' | 'debug';

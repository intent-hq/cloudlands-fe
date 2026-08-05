/**
 * Sentry Integration Constants
 */
import { m } from '$shared/paraglide/messages.js';

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
 * Sentry API base URL
 */
export const SENTRY_API_BASE_URL = 'https://sentry.io/api/0';

/**
 * Sentry issue status values
 */
export const SentryIssueStatus = {
  Resolved: 'resolved',
  Unresolved: 'unresolved',
  Ignored: 'ignored',
} as const;

export type SentryIssueStatusType = (typeof SentryIssueStatus)[keyof typeof SentryIssueStatus];

/**
 * Sentry issue level/severity values
 */
export const SentryIssueLevel = {
  Error: 'error',
  Warning: 'warning',
  Info: 'info',
  Fatal: 'fatal',
  Debug: 'debug',
} as const;

export type SentryIssueLevelType = (typeof SentryIssueLevel)[keyof typeof SentryIssueLevel];

/**
 * Sentry issue filter options for display in UI
 */
export type SentryIssueFilter = 'unresolved' | 'resolved' | 'ignored' | 'all';

export const SENTRY_ISSUE_FILTER_OPTIONS: Array<{
  value: SentryIssueFilter;
  label: string;
  description: string;
}> = [
  {
    value: 'unresolved',
    get label() {
      return m.sentryAuth_filter_unresolved_label();
    },
    get description() {
      return m.sentryAuth_filter_unresolved_description();
    },
  },
  {
    value: 'resolved',
    get label() {
      return m.sentryAuth_filter_resolved_label();
    },
    get description() {
      return m.sentryAuth_filter_resolved_description();
    },
  },
  {
    value: 'ignored',
    get label() {
      return m.sentryAuth_filter_ignored_label();
    },
    get description() {
      return m.sentryAuth_filter_ignored_description();
    },
  },
  {
    value: 'all',
    get label() {
      return m.sentryAuth_filter_all_label();
    },
    get description() {
      return m.sentryAuth_filter_all_description();
    },
  },
];

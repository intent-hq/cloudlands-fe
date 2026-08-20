/**
 * Linear Integration Constants
 */
import { m } from '$shared/paraglide/messages.js';

/**
 * IPC channel names for Linear authentication
 */
export const LINEAR_AUTH_CHANNELS = {
  /** Check if user is authenticated with Linear */
  IS_AUTHENTICATED: 'linear-auth:is-authenticated',
  /** Start Linear authentication flow */
  START_AUTH: 'linear-auth:start-auth',
  /** Cancel ongoing authentication */
  CANCEL_AUTH: 'linear-auth:cancel-auth',
  /** Logout / revoke Linear access */
  LOGOUT: 'linear-auth:logout',
  /** Get full authentication state */
  GET_AUTH_STATE: 'linear-auth:get-auth-state',
  /** Get Linear status from the daemon API */
  GET_STATUS: 'linear-auth:get-status',
  /** Fetch issues assigned to current user */
  FETCH_MY_ISSUES: 'linear-auth:fetch-my-issues',
  /** Search issues by query */
  SEARCH_ISSUES: 'linear-auth:search-issues',
} as const;

/**
 * Linear issue filter types
 */
export type LinearIssueFilter = 'assigned' | 'created' | 'subscribed' | 'team' | 'all';

/**
 * Filter options for display in UI
 */
export const LINEAR_ISSUE_FILTER_OPTIONS: Array<{
  value: LinearIssueFilter;
  label: string;
  description: string;
}> = [
  {
    value: 'assigned',
    get label() {
      return m.linearAuth_filter_assigned_label();
    },
    get description() {
      return m.linearAuth_filter_assigned_description();
    },
  },
  {
    value: 'created',
    get label() {
      return m.linearAuth_filter_created_label();
    },
    get description() {
      return m.linearAuth_filter_created_description();
    },
  },
  {
    value: 'subscribed',
    get label() {
      return m.linearAuth_filter_subscribed_label();
    },
    get description() {
      return m.linearAuth_filter_subscribed_description();
    },
  },
  {
    value: 'team',
    get label() {
      return m.linearAuth_filter_team_label();
    },
    get description() {
      return m.linearAuth_filter_team_description();
    },
  },
  {
    value: 'all',
    get label() {
      return m.linearAuth_filter_all_label();
    },
    get description() {
      return m.linearAuth_filter_all_description();
    },
  },
];

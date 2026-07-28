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
 * Remote Tool ID for Linear in the legacy remote-tools API
 * From: clients/sidecar/libs/src/tools/tool-types.ts
 */
export const LINEAR_REMOTE_TOOL_ID = 12;

/**
 * Tool availability status values
 */
export const ToolAvailabilityStatus = {
  Unknown: 0,
  Available: 1,
  NeedsConfiguration: 2,
  NeedsOAuth: 3,
  Disabled: 4,
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

/**
 * Natural language queries for each filter type
 * (i18n-ignore: agent-directed prompt content, not rendered UI text)
 */
export const LINEAR_ISSUE_FILTER_QUERIES: Record<
  LinearIssueFilter,
  { summary: string; query: string }
> = {
  assigned: {
    // i18n-ignore — agent-directed prompt content
    summary: 'Fetch issues assigned to current user',
    // i18n-ignore — agent-directed prompt content
    query: 'List all issues assigned to me that are not completed or canceled, grouped by team',
  },
  created: {
    // i18n-ignore — agent-directed prompt content
    summary: 'Fetch issues created by current user',
    // i18n-ignore — agent-directed prompt content
    query: 'List all issues I created that are not completed or canceled, grouped by team',
  },
  subscribed: {
    // i18n-ignore — agent-directed prompt content
    summary: 'Fetch issues user is subscribed to',
    // i18n-ignore — agent-directed prompt content
    query: 'List all issues I am subscribed to that are not completed or canceled, grouped by team',
  },
  team: {
    // i18n-ignore — agent-directed prompt content
    summary: 'Fetch all active issues from user teams',
    query:
      // i18n-ignore — agent-directed prompt content
      'List all active issues from my teams that are not completed or canceled, grouped by team',
  },
  all: {
    // i18n-ignore — agent-directed prompt content
    summary: 'Fetch all accessible issues',
    // i18n-ignore — agent-directed prompt content
    query: 'List all issues I have access to that are not completed or canceled, grouped by team',
  },
};

/**
 * Linear Integration Constants
 */

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
    label: 'Assigned to me',
    description: 'Issues currently assigned to you',
  },
  {
    value: 'created',
    label: 'Created by me',
    description: 'Issues you created',
  },
  {
    value: 'subscribed',
    label: 'Subscribed',
    description: 'Issues you are watching',
  },
  {
    value: 'team',
    label: 'My teams',
    description: 'All active issues from your teams',
  },
  {
    value: 'all',
    label: 'All accessible',
    description: 'All issues you have access to',
  },
];

/**
 * Natural language queries for each filter type
 */
export const LINEAR_ISSUE_FILTER_QUERIES: Record<
  LinearIssueFilter,
  { summary: string; query: string }
> = {
  assigned: {
    summary: 'Fetch issues assigned to current user',
    query: 'List all issues assigned to me that are not completed or canceled, grouped by team',
  },
  created: {
    summary: 'Fetch issues created by current user',
    query: 'List all issues I created that are not completed or canceled, grouped by team',
  },
  subscribed: {
    summary: 'Fetch issues user is subscribed to',
    query: 'List all issues I am subscribed to that are not completed or canceled, grouped by team',
  },
  team: {
    summary: 'Fetch all active issues from user teams',
    query:
      'List all active issues from my teams that are not completed or canceled, grouped by team',
  },
  all: {
    summary: 'Fetch all accessible issues',
    query: 'List all issues I have access to that are not completed or canceled, grouped by team',
  },
};

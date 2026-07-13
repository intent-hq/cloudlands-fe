export const GITHUB_AUTH_CHANNELS = {
  IS_AUTHENTICATED: 'github-auth:is-authenticated',
  GET_USER: 'github-auth:get-user',
  START_AUTH: 'github-auth:start',
  POLL_FOR_TOKEN: 'github-auth:poll',
  CANCEL_AUTH: 'github-auth:cancel',
  LOGOUT: 'github-auth:logout',
  GET_AUTH_STATE: 'github-auth:get-auth-state',
  GET_STATUS: 'github-auth:get-status',
  LIST_REPOS: 'github-auth:list-repos',
  SEARCH_REPOS: 'github-auth:search-repos',
} as const;

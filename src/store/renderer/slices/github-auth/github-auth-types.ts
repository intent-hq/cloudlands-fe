import type { GitHubUser } from "$features/github-auth/types";

export type GitHubAuthState = {
  /** Whether user is authenticated with GitHub via Augment */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with Augment first */
  requiresAugmentAuth: boolean;
  /** GitHub user info (if available) */
  user: GitHubUser | null;
  /** Whether authentication is in progress */
  isAuthenticating: boolean;
  /** OAuth URL for authentication (shown to user) */
  oauthUrl: string | null;
  /** Whether GitHub is configured but needs scope update */
  needsScopeUpdate: boolean;
  /** Error message if any */
  error: string | null;
};


import type { GitHubDeviceFlow, GitHubUser } from "$features/github-auth/types";

/**
 * In-flight device-flow codes shown to the user (PROTOCOL §5.27) — the shared
 * wire shape minus `status`, which the slice models via `isAuthenticating` /
 * `error` instead.
 */
export type GitHubDeviceFlowInfo = Omit<GitHubDeviceFlow, "status">;

export type GitHubAuthState = {
  /** Whether user is authenticated with GitHub via the daemon */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with the daemon first */
  requiresDaemonAuth: boolean;
  /** GitHub user info (if available) */
  user: GitHubUser | null;
  /** Whether authentication is in progress */
  isAuthenticating: boolean;
  /** Verification URI while a device flow is pending (§5.27); null otherwise */
  oauthUrl: string | null;
  /** Device-flow codes while a flow is pending (null otherwise) */
  deviceFlow: GitHubDeviceFlowInfo | null;
  /** Whether GitHub is configured but needs scope update */
  needsScopeUpdate: boolean;
  /** Error message if any */
  error: string | null;
};


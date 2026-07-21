import type { GitHubUser } from "$features/github-auth/types";

/** In-flight device-flow codes shown to the user (PROTOCOL §5.27). */
export type GitHubDeviceFlowInfo = {
  /** Code the user enters at `verificationUri`. */
  userCode: string;
  /** Where the user enters the code (usually https://github.com/login/device). */
  verificationUri: string;
  /** Seconds until the codes expire (snapshot at start). */
  expiresIn: number;
  /** Polling-cadence hint in seconds. */
  interval: number;
};

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


export interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

/**
 * Where the daemon-owned device flow stands (PROTOCOL §5.27 `deviceFlow.status`).
 * `pending` = waiting for the user to enter the code; the rest are terminal.
 */
export type GitHubDeviceFlowStatus = 'pending' | 'expired' | 'denied' | 'error';

/**
 * The `deviceFlow` object embedded in `github.authStatus` (§5.27) — the
 * user-facing codes only, never the `device_code` or a token.
 */
export interface GitHubDeviceFlow {
  status: GitHubDeviceFlowStatus;
  userCode: string;
  verificationUri: string;
  /** Seconds until the codes expire. */
  expiresIn: number;
  /** Polling-cadence hint in seconds. */
  interval: number;
}

/**
 * GitHub OAuth/PAT configuration status as reported by the daemon.
 */
export interface GitHubAuthStatus {
  isConfigured: boolean;
  oauthUrl: string;
  configuredButNeedsUpdate: boolean;
  updatedScopes: string;
  /** In-flight (or last-terminal) device flow; null when none (§5.27). */
  deviceFlow?: GitHubDeviceFlow | null;
}

/**
 * GitHub repository in the GitHub-native snake_case shape consumed by the
 * renderer and saga layers.
 */
export interface GithubRepo {
  owner: string;
  name: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  default_branch?: string;
}

/**
 * Result from starting GitHub authentication
 */
export interface StartAuthResult {
  success: boolean;
  error?: string;
  /** True if user is already authenticated with GitHub */
  alreadyAuthenticated?: boolean;
  /** OAuth URL to redirect user to for authentication */
  oauthUrl?: string;
  /** True if GitHub is configured but needs scope update */
  needsScopeUpdate?: boolean;
  /** New scopes that need to be authorized */
  updatedScopes?: string;
  /** Device-flow code the user enters at `verificationUri` (§5.27 `github.connect`). */
  userCode?: string;
  /** Where the user enters `userCode` (usually https://github.com/login/device). */
  verificationUri?: string;
  /** Seconds until the codes expire. */
  expiresIn?: number;
  /** Polling-cadence hint in seconds. */
  interval?: number;
}

/**
 * Full GitHub authentication state for the UI
 */
export interface GitHubAuthState {
  /** Whether user is authenticated with GitHub via the daemon */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with the daemon first */
  requiresDaemonAuth: boolean;
  /** GitHub user info (if available) */
  user: GitHubUser | null;
  /** Whether GitHub is configured but needs scope update */
  needsScopeUpdate?: boolean;
  /** New scopes that need to be authorized */
  updatedScopes?: string;
  /** OAuth URL for authentication */
  oauthUrl?: string;
}

/**
 * Event emitted when GitHub authentication is required
 */
export interface GitHubAuthRequiredEvent {
  workspaceId?: string;
  operation?: string;
  message: string;
}

// Legacy types for backwards compatibility (deprecated)

/** @deprecated Use StartAuthResult instead */
export interface StartDeviceFlowResult {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

/** @deprecated No longer used - auth is managed by the daemon */
export interface StoredAuth {
  accessToken: string;
  user: GitHubUser;
  createdAt: string;
  scopes: string[];
}

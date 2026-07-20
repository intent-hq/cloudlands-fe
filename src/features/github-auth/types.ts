export interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

/**
 * GitHub OAuth/PAT configuration status as reported by the daemon.
 */
export interface GitHubAuthStatus {
  isConfigured: boolean;
  oauthUrl: string;
  configuredButNeedsUpdate: boolean;
  updatedScopes: string;
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

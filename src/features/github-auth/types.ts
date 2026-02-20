export interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
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
  /** Whether user is authenticated with GitHub via Augment */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with Augment first */
  requiresAugmentAuth: boolean;
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

/** @deprecated No longer used - auth is managed by Augment */
export interface StoredAuth {
  accessToken: string;
  user: GitHubUser;
  createdAt: string;
  scopes: string[];
}

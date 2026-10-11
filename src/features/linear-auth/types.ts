/**
 * Full Linear authentication state for the UI
 */
export interface LinearAuthState {
  /** Whether user is authenticated with Linear via the daemon */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with the daemon first */
  requiresDaemonAuth: boolean;
  /** OAuth URL for authentication */
  oauthUrl?: string;
}

/**
 * Linear auth status from the daemon API
 */
export interface LinearAuthStatus {
  /** Whether Linear is configured/connected */
  isConfigured: boolean;
  /** OAuth URL for authentication (if not configured) */
  oauthUrl: string;
  /** Tool availability status from API */
  availabilityStatus?: number;
}

/**
 * Simplified Linear issue result for the UI
 */
export interface LinearIssueResult {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url?: string;
  teamName?: string;
  teamKey?: string;
  state?: string;
  priority?: number;
  /** Assignee name */
  assignee?: string;
  /** Labels as array of names */
  labels?: string[];
  /** Project name */
  project?: string;
  /** Creator/author name */
  creator?: string;
  /** Created timestamp */
  createdAt?: string;
  /** Updated timestamp */
  updatedAt?: string;
}

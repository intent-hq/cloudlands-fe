/**
 * Linear Integration Types
 *
 * This module contains types for Linear authentication and future API operations.
 * Authentication is managed through Augment's OAuth flow.
 */

// =============================================================================
// Authentication Types
// =============================================================================

/**
 * Result from starting Linear authentication
 */
export interface StartAuthResult {
  success: boolean;
  error?: string;
  /** True if user is already authenticated with Linear */
  alreadyAuthenticated?: boolean;
  /** OAuth URL to redirect user to for authentication */
  oauthUrl?: string;
}

/**
 * Full Linear authentication state for the UI
 */
export interface LinearAuthState {
  /** Whether user is authenticated with Linear via Augment */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with Augment first */
  requiresAugmentAuth: boolean;
  /** OAuth URL for authentication */
  oauthUrl?: string;
}

/**
 * Linear auth status from Augment API
 */
export interface LinearAuthStatus {
  /** Whether Linear is configured/connected */
  isConfigured: boolean;
  /** OAuth URL for authentication (if not configured) */
  oauthUrl: string;
  /** Tool availability status from API */
  availabilityStatus?: number;
}

// =============================================================================
// Linear Entity Types (for future API operations)
// =============================================================================

/**
 * Linear user information
 */
export interface LinearUser {
  id: string;
  name: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

/**
 * Linear team information
 */
export interface LinearTeam {
  id: string;
  /** Team key like "AUG" */
  key: string;
  name: string;
  description?: string;
}

/**
 * Linear workflow state information
 */
export interface LinearWorkflowState {
  id: string;
  name: string;
  /** "backlog", "unstarted", "started", "completed", "canceled" */
  type: string;
  description?: string;
  color?: string;
}

/**
 * Linear project information
 */
export interface LinearProject {
  id: string;
  name: string;
  description?: string;
  /** "backlog", "planned", "started", "paused", "completed", "canceled" */
  state: string;
  url?: string;
}

/**
 * Linear label information
 */
export interface LinearLabel {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

/**
 * Linear issue information
 */
export interface LinearIssue {
  id: string;
  /** Issue identifier like "AUG-123" */
  identifier: string;
  title: string;
  description?: string;
  priority?: number;
  estimate?: number;
  url?: string;
  createdAt?: string;
  updatedAt?: string;

  // Relationships
  state?: LinearWorkflowState;
  team?: LinearTeam;
  assignee?: LinearUser;
  creator?: LinearUser;
  project?: LinearProject;
  labels?: LinearLabel[];
}

// =============================================================================
// Future: API Operation Types
// =============================================================================

/**
 * Request to search Linear issues
 */
export interface SearchIssuesRequest {
  query?: string;
  teamId?: string;
  assigneeId?: string;
  stateId?: string;
  limit?: number;
}

/**
 * Request to create a Linear issue
 */
export interface CreateIssueRequest {
  title: string;
  description?: string;
  teamId: string;
  assigneeId?: string;
  stateId?: string;
  priority?: number;
  labelIds?: string[];
}

/**
 * Request to update a Linear issue
 */
export interface UpdateIssueRequest {
  issueId: string;
  title?: string;
  description?: string;
  assigneeId?: string;
  stateId?: string;
  priority?: number;
}

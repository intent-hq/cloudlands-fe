/**
 * Sentry Integration Types
 *
 * This module contains types for Sentry authentication and API operations.
 * Authentication uses a user-provided API token (not OAuth).
 */

import type { SentryIssueLevelType, SentryIssueStatusType } from './constants';

// =============================================================================
// Authentication Types
// =============================================================================

/**
 * Sentry authentication configuration stored locally
 */
export interface SentryConfig {
  /** Sentry organization slug */
  organization: string;
  /** Sentry API auth token */
  apiToken: string;
}

/**
 * Full Sentry authentication state for the UI
 */
export interface SentryAuthState {
  /** Whether user has configured Sentry credentials */
  isAuthenticated: boolean;
  /** Configured organization slug */
  organization?: string;
  /** Error message if configuration is invalid */
  error?: string;
}

/**
 * Result from saving Sentry configuration
 */
export interface SaveConfigResult {
  success: boolean;
  error?: string;
  /** Organization name if validation succeeded */
  organizationName?: string;
}

// =============================================================================
// Sentry Entity Types
// =============================================================================

/**
 * Sentry project information
 */
export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  /** Optional platform (e.g., 'javascript', 'python') */
  platform?: string;
  /** Whether this project is a member project */
  isMember?: boolean;
}

/**
 * Sentry issue/event group information
 */
export interface SentryIssue {
  id: string;
  /** Short ID like "PROJECT-123" */
  shortId: string;
  /** Issue title (error message or event title) */
  title: string;
  /** Culprit (file/function where error occurred) */
  culprit?: string;
  /** Issue status */
  status: SentryIssueStatusType;
  /** Issue level/severity */
  level: SentryIssueLevelType;
  /** Total event count */
  count: string;
  /** Number of affected users */
  userCount: number;
  /** First seen timestamp */
  firstSeen: string;
  /** Last seen timestamp */
  lastSeen: string;
  /** Project info */
  project: {
    id: string;
    name: string;
    slug: string;
  };
  /** Additional metadata */
  metadata?: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  /** Permalink to the issue in Sentry */
  permalink?: string;
}

/**
 * Simplified Sentry issue result for the UI
 */
export interface SentryIssueResult {
  id: string;
  shortId: string;
  title: string;
  culprit?: string;
  status: SentryIssueStatusType;
  level: SentryIssueLevelType;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  projectName: string;
  projectSlug: string;
  url?: string;
  /** Error type (e.g., "Error", "TypeError") */
  type?: string;
  /** Error value/message detail */
  value?: string;
  /** Filename where error occurred */
  filename?: string;
  /** Function name where error occurred */
  function?: string;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/**
 * Request to fetch Sentry issues
 */
export interface FetchIssuesRequest {
  /** Project slug to filter by (optional) */
  project?: string;
  /** Status filter */
  status?: SentryIssueStatusType | 'all';
  /** Search query */
  query?: string;
  /** Maximum number of results */
  limit?: number;
}

/**
 * Request to search Sentry issues
 */
export interface SearchIssuesRequest {
  query: string;
  /** Project slug to filter by (optional) */
  project?: string;
  limit?: number;
}

/**
 * Sentry Integration Types
 *
 * This module contains types for Sentry authentication and API operations.
 * Authentication uses a user-provided API token (not OAuth).
 */

import type { SentryIssueLevelType, SentryIssueStatusType } from './constants';

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
  /** Opaque cursor from a previous page's `nextToken` */
  nextToken?: string;
}

/**
 * One page of cursor-paginated Sentry issue reads (PROTOCOL §5.29)
 */
export interface SentryIssuePage {
  issues: SentryIssueResult[];
  /** Opaque cursor for the next page, or `null` when this is the last page */
  nextToken: string | null;
}

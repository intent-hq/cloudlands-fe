/**
 * Sentry Auth Redux Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

import type { SentryProject } from '$features/sentry-auth/types';

export type SentryAuthState = {
  /** Whether user is authenticated with Sentry */
  isAuthenticated: boolean;
  /** Configured organization slug */
  organization: string | null;
  /** Whether authentication/connection is in progress */
  isConnecting: boolean;
  /** Error message if any */
  error: string | null;
  /** Cached projects for the organization */
  projects: SentryProject[];
  /** Whether projects are being loaded */
  isLoadingProjects: boolean;
};

// Re-export types that consumers need
export type { SentryIssueResult } from '$features/sentry-auth/types';

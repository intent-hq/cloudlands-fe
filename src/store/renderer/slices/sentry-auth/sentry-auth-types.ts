/**
 * Sentry Auth Redux Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

import type { SentryProject } from '$features/sentry-auth/types';
import type { SentryIssueResult } from '$features/sentry-auth/types';
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

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
  /** Cached issue list used by simple pickers. */
  issues: Collection<SentryIssueResult, 'id'>;
  isLoadingIssues: boolean;
  issuesLoaded: boolean;
};

// Re-export types that consumers need
export type { SentryIssueResult } from '$features/sentry-auth/types';

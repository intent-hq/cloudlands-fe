import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
import type { LinearIssueFilter } from '$features/linear-auth/constants';
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

export type LinearAuthSliceState = {
  /** Whether user is authenticated with Linear via the daemon */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with the daemon first */
  requiresDaemonAuth: boolean;
  /** Whether authentication is in progress */
  isAuthenticating: boolean;
  /** OAuth URL for authentication (shown to user) */
  oauthUrl: string | null;
  /** Error message if any */
  error: string | null;
  /** Cached issues for the current user */
  issues: Collection<LinearIssueResult, 'id'>;
  /** Whether issues are being loaded */
  isLoadingIssues: boolean;
  /** FE-local issue filter persisted by the auth saga. */
  issueFilter: LinearIssueFilter;
  /** Whether the persisted issue filter has been hydrated. */
  issueFilterLoaded: boolean;
};

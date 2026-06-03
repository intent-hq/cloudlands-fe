import type { LinearIssueResult } from "$features/linear-auth/renderer/linear-auth.client";

export type LinearIssueFilter = 'assigned' | 'created' | 'subscribed' | 'team' | 'all';

export type LinearAuthSliceState = {
  /** Whether user is authenticated with Linear via Augment */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with Augment first */
  requiresAugmentAuth: boolean;
  /** Whether authentication is in progress */
  isAuthenticating: boolean;
  /** OAuth URL for authentication (shown to user) */
  oauthUrl: string | null;
  /** Error message if any */
  error: string | null;
  /** Cached issues for the current user */
  issues: LinearIssueResult[];
  /** Whether issues are being loaded */
  isLoadingIssues: boolean;
};


import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
import type { ProviderAuthOperation } from '../provider-auth/provider-auth-types';

export type LinearAuthSliceState = {
  operation: ProviderAuthOperation | null;
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
  issues: LinearIssueResult[];
  /** Whether issues are being loaded */
  isLoadingIssues: boolean;
};

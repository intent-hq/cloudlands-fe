import type { ForgeAuthStatus, ForgeUser, ForgeProvider } from '../forge-auth/types';
import type { PrincipalIdentity } from '../workspace-sharing/types';

export { COLLABORATION_AUTH_CHANNELS as COLLABORATION_AUTH } from '../../shared/ipc/channels';

/** Absence is a legacy host; null is an explicitly unpinned invitation. */
export interface CollaborationRequest {
  scope: 'host' | 'workspace' | 'settings';
  pinIdentity?: PrincipalIdentity | null;
  hostLabel?: string;
  workspaceTitle?: string;
}
export interface CollaborationPolicy {
  multiplayer: boolean;
  gitlab: boolean;
}
export interface IdentityTarget {
  provider: ForgeProvider;
  host: string;
}
export interface CollaborationAuthStatus extends ForgeAuthStatus {
  purpose: 'collaboration';
  requestedScopes: string[];
  grantedScopes: string[] | null;
}
export type CollaborationError =
  | 'multiplayer-disabled'
  | 'gitlab-disabled'
  | 'upgrade-required'
  | 'request-changed'
  | 'local-connection-changed'
  | 'identity-mismatch'
  | 'identity-in-use'
  | 'scope-missing'
  | 'device-grant-unsupported'
  | 'rate-limited'
  | 'invalid-host'
  | 'sign-in-failed';
export interface CollaborationView {
  requestId: string;
  request: CollaborationRequest;
  target: IdentityTarget;
  phase: 'loading' | 'account' | 'device' | 'error';
  user: ForgeUser | null;
  requestedScopes: string[];
  grantedScopes: string[] | null;
  deviceGrantSupported: boolean;
  device?: { userCode: string; verificationUri: string };
  error?: CollaborationError;
}
/** PATs travel only through this ephemeral IPC argument, never actions or snapshots. */
export type CollaborationAction =
  | { type: 'policy'; policy: CollaborationPolicy }
  | { type: 'choose'; target: IdentityTarget }
  | { type: 'connect'; token?: string }
  | { type: 'refresh' }
  | { type: 'confirm' }
  | { type: 'open-browser' }
  | { type: 'cancel' };

/** Recovery hint only; an account ID here is not fresh proof or account consent. */
export interface CollaborationSelection {
  target: IdentityTarget;
  displayedAccountId?: string;
}
export type CollaborationOutcome<T> =
  | { kind: 'ready'; prepared: T }
  | { kind: 'cancelled'; request: CollaborationRequest; selection?: CollaborationSelection }
  | {
      kind: 'error';
      code: CollaborationError;
      request: CollaborationRequest;
      selection?: CollaborationSelection;
    };

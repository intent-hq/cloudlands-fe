/**
 * One user-facing sentence per bounded invite failure reason
 * (`InviteFailureReason`, `src/shared/ipc/invite-notice.ts`). Shared by the
 * renderer notice modal and the main process's native fallback so both
 * surfaces say the same thing for the same code.
 */
import type { InviteFailureReason } from '../ipc/invite-notice';
import { m } from '../paraglide/messages.js';

export function describeInviteFailureReason(reason: InviteFailureReason): string {
  switch (reason) {
    case 'expired':
      return m.deeplink_inviteError_expired();
    case 'revoked':
      return m.deeplink_inviteError_revoked();
    case 'redeemed':
      return m.deeplink_inviteError_redeemed();
    case 'pin-mismatch':
      return m.deeplink_inviteError_pinMismatch();
    case 'proof-invalid':
      return m.deeplink_inviteError_proofInvalid();
    case 'proof-expired':
      return m.deeplink_inviteError_proofExpired();
    case 'host-github-unreachable':
      return m.deeplink_inviteError_hostGithubUnreachable();
    case 'workspace-full':
      return m.deeplink_inviteError_workspaceFull();
    case 'owner-self-join':
      return m.deeplink_inviteError_ownerSelfJoin();
    case 'denied':
      return m.deeplink_inviteError_denied();
    case 'flow-expired':
      return m.deeplink_inviteError_flowExpired();
    case 'sign-in-failed':
      return m.deeplink_inviteError_signInFailed();
    case 'launch-failed':
      return m.deeplink_inviteError_launchFailed();
    case 'proof-not-connected':
      return m.deeplink_inviteError_proofNotConnected();
    case 'proof-scope-missing':
      return m.deeplink_inviteError_proofScopeMissing();
    case 'proof-github-unreachable':
      return m.deeplink_inviteError_proofGithubUnreachable();
    case 'proof-failed':
      return m.deeplink_inviteError_proofFailed();
    case 'github-rate-limited':
      return m.deeplink_inviteError_githubRateLimited();
    case 'cert-mismatch':
      return m.deeplink_inviteError_certMismatch();
    case 'tailcat-unavailable':
      return m.deeplink_inviteError_tailcatUnavailable();
    case 'tunnel-failed':
      return m.deeplink_inviteError_tunnelFailed();
    case 'host-unreachable':
      return m.deeplink_inviteError_hostUnreachable();
    case 'host-refused':
      return m.deeplink_inviteError_hostRefused();
    case 'connection-closed':
      return m.deeplink_inviteError_connectionClosed();
    case 'encryption-unavailable':
      return m.deeplink_inviteError_encryptionUnavailable();
    case 'store-corrupt':
      return m.deeplink_inviteError_storeCorrupt();
    case 'generic':
      return m.deeplink_inviteError_generic();
  }
}

import { m } from '$shared/paraglide/messages.js';
import type { NodeAddError } from './nodes-types';

/** The message for a failed add, inline in the paste row or as a toast. */
export function nodeAddErrorMessage(error: NodeAddError, backend: string): string {
  const node = error.node ?? '';
  switch (error.code) {
    case 'not-a-link':
      return m.nodes_error_notLink();
    case 'incomplete':
      return m.nodes_error_incomplete();
    case 'unreachable':
      return m.nodes_error_unreachable();
    case 'rejected':
      return m.nodes_error_rejected();
    case 'certificate':
      return m.nodes_error_certificate();
    case 'not-owner':
      return m.nodes_error_notOwner();
    case 'incompatible':
      return error.message ?? m.nodes_error_failed();
    case 'expired':
      return m.nodes_error_expired();
    case 'labs-off':
      return m.nodes_error_labsOff({ node });
    case 'backend-unsupported':
      return m.nodes_error_backendUnsupported({ node, backend });
    case 'link-version':
      return m.nodes_error_linkVersion();
    case 'node-invite-invalid':
      return m.nodes_error_inviteInvalid({ node });
    case 'node-invite-expired':
      return m.nodes_error_inviteExpired({ node });
    case 'node-invite-used':
      return m.nodes_error_inviteUsed({ node });
    case 'node-invite-revoked':
      return m.nodes_error_inviteRevoked({ node });
    case 'node-invite-self':
      return m.nodes_error_inviteSelf({ backend });
    case 'certificate-mismatch':
      return m.nodes_error_inviteCertificate({ node });
    case 'machine-unreachable':
      return error.inviteSpent
        ? m.nodes_error_inviteUnreachableSpent({ node, backend })
        : m.nodes_error_inviteUnreachable({ node, backend });
    case 'machine-update-required':
      return error.inviteSpent
        ? m.nodes_error_inviteUpdateRequiredSpent({ node, backend })
        : m.nodes_error_inviteUpdateRequired({ node, backend });
    case 'invites-unsupported':
      return m.nodes_error_invitesUnsupported({ backend });
    case 'invite-not-owner':
      return m.nodes_error_inviteNotOwner({ backend });
    default:
      return m.nodes_error_failed();
  }
}

/** Errors that Try again can clear without a new link. */
export function nodeAddErrorRetryable(error: NodeAddError | null): boolean {
  return (
    error?.code === 'unreachable' ||
    (error?.code === 'machine-unreachable' && !error.inviteSpent) ||
    error?.code === 'failed' ||
    error?.code === 'backend-unsupported' ||
    error?.code === 'invites-unsupported'
  );
}

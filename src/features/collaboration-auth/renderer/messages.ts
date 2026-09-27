import { m } from '$shared/paraglide/messages.js';
import type { CollaborationError } from '../types';

export function collaborationErrorMessage(code: CollaborationError): string {
  switch (code) {
    case 'upgrade-required':
      return m.collaborationAuth_upgrade_error();
    case 'gitlab-disabled':
      return m.collaborationAuth_gitlabDisabled_error();
    case 'request-changed':
      return m.collaborationAuth_requestChanged_error();
    case 'local-connection-changed':
      return m.collaborationAuth_connectionChanged_error();
    case 'identity-mismatch':
      return m.collaborationAuth_wrongAccount_error();
    case 'scope-missing':
      return m.collaborationAuth_scope_error();
    case 'device-grant-unsupported':
      return m.collaborationAuth_pat_error();
    case 'rate-limited':
      return m.collaborationAuth_rateLimited_error();
    case 'identity-in-use':
      return m.collaborationAuth_identityInUse_error();
    default:
      return m.collaborationAuth_failed_error();
  }
}

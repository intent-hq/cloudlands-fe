import { m } from '$shared/paraglide/messages.js';
import type { SshRunFailure } from './machine-setup-slice';

/** One plain message per SSH setup failure (`link-rejected` uses the add error instead). */
export function sshFailureMessage(failure: SshRunFailure, host: string): string {
  switch (failure.code) {
    case 'unreachable':
      return m.machineSetup_error_unreachable({ host });
    case 'auth-refused':
      return m.machineSetup_error_authRefused({ host });
    case 'no-agent':
      return m.machineSetup_error_noAgent();
    case 'key-unreadable':
      return m.machineSetup_error_keyUnreadable();
    case 'host-key-mismatch':
      return m.machineSetup_error_hostKeyMismatch({ host });
    case 'host-key-declined':
      return m.machineSetup_error_hostKeyDeclined({ host });
    case 'unsupported-os':
      return m.machineSetup_error_unsupportedOs();
    case 'install-failed':
      return m.machineSetup_error_installFailed({ host });
    case 'no-link':
      return m.machineSetup_error_noLink();
    case 'link-rejected':
    case 'failed':
      return m.machineSetup_error_failed();
  }
}

/** A second line for the failures with a common fix. */
export function sshFailureHint(failure: SshRunFailure): string | null {
  if (failure.code === 'unreachable') return m.machineSetup_error_remoteLogin_hint();
  if (failure.code === 'install-failed' || failure.code === 'no-link')
    return m.machineSetup_error_seeLog_hint();
  return null;
}

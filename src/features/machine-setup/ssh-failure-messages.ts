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
    case 'no-start':
      return m.machineSetup_error_noStart({ host });
    case 'did-not-start':
      return m.machineSetup_error_didNotStart({ host });
    case 'running-elsewhere':
      return m.machineSetup_error_runningElsewhere({ host });
    case 'too-old':
      return m.machineSetup_error_tooOld({ host });
    case 'orchestrator':
      return m.machineSetup_error_orchestrator({ host });
    case 'pair-failed':
      return m.machineSetup_error_pairFailed({ host });
    case 'link-rejected':
    case 'failed':
      return m.machineSetup_error_failed();
  }
}

/** A second line for the failures with a common fix. */
export function sshFailureHint(failure: SshRunFailure): string | null {
  if (
    failure.code === 'install-failed' ||
    failure.code === 'no-link' ||
    failure.code === 'did-not-start' ||
    failure.code === 'too-old' ||
    failure.code === 'pair-failed'
  )
    return m.machineSetup_error_seeLog_hint();
  return null;
}

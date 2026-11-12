/**
 * The message for each way redeeming a local pairing code can fail, and which
 * failures make the typed code useless. Pure: no IPC.
 */
import { m } from '$shared/paraglide/messages.js';
import type { LocalRedeemError } from '$shared/types/local-pairing';

/** The message for a failed redemption, naming the other Intent. */
export function localRedeemErrorMessage(error: LocalRedeemError, name: string): string {
  switch (error.code) {
    case 'wrong-code':
      return error.attemptsRemaining
        ? m.localPairing_redeem_wrongCode_error({ name, count: error.attemptsRemaining })
        : m.localPairing_redeem_wrongCodeNoCount_error({ name });
    case 'locked':
      return m.localPairing_redeem_locked_error({ name });
    case 'expired':
      return m.localPairing_redeem_expired_error({ name });
    case 'code-format':
      return m.localPairing_redeem_codeFormat_error();
    case 'gone':
      return m.localPairing_redeem_gone_error({ name });
    case 'not-listening':
      return m.localPairing_redeem_notListening_error({ name });
    case 'unreachable':
      return m.localPairing_redeem_unreachable_error({ name });
    case 'certificate':
      return m.localPairing_redeem_certificate_error({ name });
    case 'refused':
      return m.localPairing_redeem_refused_error({ name });
    case 'remote-access-on':
      return m.localPairing_redeem_remoteAccessOn_error({ name });
    case 'unsupported':
      return m.localPairing_redeem_unsupported_error({ name });
    case 'busy':
      return m.localPairing_redeem_busy_error({ name });
    case 'save-failed':
      return m.localPairing_redeem_saveFailed_error({ name });
    default:
      return m.localPairing_redeem_unknown_error({ name });
  }
}

/** After these the typed code can never work again: clear the field. */
export function localRedeemErrorSpendsCode(error: LocalRedeemError): boolean {
  return (
    error.code === 'wrong-code' ||
    error.code === 'locked' ||
    error.code === 'expired' ||
    error.code === 'certificate' ||
    error.code === 'save-failed'
  );
}

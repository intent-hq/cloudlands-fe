/**
 * Daemon events of local code pairing (§5.58), mapped to slice actions. The
 * daemon sends both only to local-transport (UDS / named pipe) connections.
 */
import {
  localPairingCodeChanged,
  localPairingCredentialChanged,
  localPairingCredentialRevoked,
} from './local-pairing-slice';
import { parseLocalCredentialsEvent, parseLocalPairingCode } from './local-pairing-types';

export const LOCAL_CODE_CHANGED_EVENT = 'pairing:localCode-changed';
export const LOCAL_CREDENTIALS_CHANGED_EVENT = 'pairing:localCredentials-changed';

export type LocalPairingEventAction =
  | ReturnType<typeof localPairingCodeChanged>
  | ReturnType<typeof localPairingCredentialChanged>
  | ReturnType<typeof localPairingCredentialRevoked>;

/** The action for one daemon event, or null when it is not a valid local pairing event. */
export function localPairingEventAction(
  type: string,
  data: unknown,
): LocalPairingEventAction | null {
  if (type === LOCAL_CODE_CHANGED_EVENT) {
    const record = typeof data === 'object' && data !== null ? data : {};
    const code = parseLocalPairingCode((record as { localCode?: unknown }).localCode);
    return code ? localPairingCodeChanged(code) : null;
  }
  if (type === LOCAL_CREDENTIALS_CHANGED_EVENT) {
    const parsed = parseLocalCredentialsEvent(data);
    if (!parsed) return null;
    return parsed.kind === 'revoked'
      ? localPairingCredentialRevoked(parsed.credentialId)
      : localPairingCredentialChanged(parsed.credential);
  }
  return null;
}

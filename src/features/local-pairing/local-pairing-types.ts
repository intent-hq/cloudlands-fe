/**
 * Wire shapes of local code pairing (protocol §5.58) as the host (B) sees
 * them. The plaintext code and credential tokens never appear here: the code
 * lives only in `local-pairing-code-text.ts`, and tokens never reach B's UI.
 */

const LOCAL_PAIRING_CODE_STATES = ['active', 'redeemed', 'expired', 'cancelled', 'locked'] as const;
type LocalPairingCodeState = (typeof LOCAL_PAIRING_CODE_STATES)[number];

export interface LocalPairingCode {
  codeId: string;
  state: LocalPairingCodeState;
  createdAt: string;
  expiresAt: string;
  attemptsRemaining: number;
  cancelReason?: 'user' | 'replaced';
  credentialId?: string;
  appName?: string;
}

export interface LocalPairingCredential {
  credentialId: string;
  appName: string;
  createdAt: string;
  lastUsedAt: string | null;
  connected: boolean;
}

/** Whether this daemon can serve the host side, as far as this window can tell. */
export type LocalPairingSupport = 'unknown' | 'supported' | 'unsupported';

/** Where the code panel is, before a code exists or while it is shown. */
export type LocalPairingPanelStep =
  'closed' | 'creating' | 'confirm-listener' | 'enabling-listener' | 'open';

export type LocalPairingPanelFailure = 'create-failed' | 'listener-failed' | 'cancel-failed';

export interface LocalPairingState {
  support: LocalPairingSupport;
  step: LocalPairingPanelStep;
  /** The code this window created and is showing; null when none. */
  code: LocalPairingCode | null;
  failure: LocalPairingPanelFailure | null;
  /** Unrevoked credentials; null until loaded or when the list could not be read. */
  credentials: LocalPairingCredential[] | null;
  /** Credential ids with a Remove in flight. */
  removing: Record<string, true>;
  /** Credential ids whose last Remove failed. */
  removeFailed: Record<string, true>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';

export function parseLocalPairingCode(value: unknown): LocalPairingCode | null {
  if (!isRecord(value)) return null;
  const { codeId, state, createdAt, expiresAt, attemptsRemaining } = value;
  if (
    !isString(codeId) ||
    !LOCAL_PAIRING_CODE_STATES.includes(state as LocalPairingCodeState) ||
    !isString(createdAt) ||
    !isString(expiresAt) ||
    Number.isNaN(Date.parse(expiresAt)) ||
    typeof attemptsRemaining !== 'number' ||
    !Number.isInteger(attemptsRemaining) ||
    attemptsRemaining < 0
  )
    return null;
  return {
    codeId,
    state: state as LocalPairingCodeState,
    createdAt,
    expiresAt,
    attemptsRemaining,
    ...(state === 'cancelled' &&
    (value.cancelReason === 'user' || value.cancelReason === 'replaced')
      ? { cancelReason: value.cancelReason }
      : {}),
    ...(state === 'redeemed' && isString(value.credentialId)
      ? { credentialId: value.credentialId }
      : {}),
    ...(state === 'redeemed' && isString(value.appName) ? { appName: value.appName } : {}),
  };
}

function parseLocalPairingCredential(value: unknown): LocalPairingCredential | null {
  if (!isRecord(value)) return null;
  const { credentialId, appName, createdAt, lastUsedAt, connected } = value;
  if (!isString(credentialId) || !isString(appName) || !isString(createdAt)) return null;
  return {
    credentialId,
    appName,
    createdAt,
    lastUsedAt: isString(lastUsedAt) ? lastUsedAt : null,
    connected: connected === true,
  };
}

/** `pairing.listLocalCredentials` result; malformed rows are dropped. */
export function parseLocalPairingCredentials(value: unknown): LocalPairingCredential[] | null {
  if (!isRecord(value) || !Array.isArray(value.credentials)) return null;
  return value.credentials.flatMap((entry) => {
    const credential = parseLocalPairingCredential(entry);
    return credential ? [credential] : [];
  });
}

/** Ordered as the daemon lists them: `createdAt`, then `credentialId`. */
export function sortLocalPairingCredentials(
  credentials: readonly LocalPairingCredential[],
): LocalPairingCredential[] {
  return [...credentials].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.credentialId.localeCompare(b.credentialId),
  );
}

export type LocalCredentialsEvent =
  | { kind: 'changed'; credential: LocalPairingCredential }
  | { kind: 'revoked'; credentialId: string };

/** `pairing:localCredentials-changed` data. */
export function parseLocalCredentialsEvent(data: unknown): LocalCredentialsEvent | null {
  if (!isRecord(data)) return null;
  if (data.revoked === true && isString(data.credentialId))
    return { kind: 'revoked', credentialId: data.credentialId };
  const credential = parseLocalPairingCredential(data.credential);
  return credential ? { kind: 'changed', credential } : null;
}

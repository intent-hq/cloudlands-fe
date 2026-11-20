import type {
  PasskeyAssertedCredential,
  PasskeyCreatedCredential,
  PasskeyErrorReason,
  PasskeyPageCreateOptions,
  PasskeyPageErrorName,
  PasskeyPageGetOptions,
  PasskeyTransport,
} from '../../../shared/ipc/passkeys';
import type { SidecarErrorCode } from './passkey-sidecar';

const DEFAULT_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_ALGORITHMS = [
  { type: 'public-key', alg: -7 },
  { type: 'public-key', alg: -257 },
];

export function ceremonyTimeoutMs(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(requested)));
}

export interface ClientDataExpectation {
  type: 'webauthn.create' | 'webauthn.get';
  challenge: string;
  origin: string;
}

/**
 * Spec §11.1: the helper builds `clientDataJSON` and returns the bytes it
 * hashed. Main uses them verbatim only when they describe this request.
 * v1 has no cross-origin frames, so `crossOrigin` must be false and
 * `topOrigin` absent.
 */
export function clientDataMatches(
  clientDataJSON: Buffer,
  expected: ClientDataExpectation,
): boolean {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(clientDataJSON.toString('utf8')) as Record<string, unknown>;
  } catch {
    return false;
  }
  return (
    typeof data === 'object' &&
    data !== null &&
    data.type === expected.type &&
    data.challenge === expected.challenge &&
    data.origin === expected.origin &&
    data.crossOrigin === false &&
    data.topOrigin === undefined
  );
}

export function createParams(
  transport: PasskeyTransport,
  origin: string,
  rpId: string,
  options: PasskeyPageCreateOptions,
  timeoutMs: number,
) {
  const selection = options.authenticatorSelection ?? {};
  const residentKey =
    selection.residentKey ?? (selection.requireResidentKey ? 'required' : 'discouraged');
  return {
    transport,
    origin,
    crossOrigin: false,
    rpId,
    challenge: options.challenge,
    rp: { id: rpId, name: options.rp.name },
    user: options.user,
    pubKeyCredParams: options.pubKeyCredParams.length
      ? options.pubKeyCredParams
      : DEFAULT_ALGORITHMS,
    excludeCredentials: options.excludeCredentials ?? [],
    authenticatorSelection: {
      residentKey,
      userVerification: selection.userVerification ?? 'preferred',
      ...(selection.authenticatorAttachment
        ? { authenticatorAttachment: selection.authenticatorAttachment }
        : {}),
    },
    attestation: options.attestation ?? 'none',
    extensions: options.extensions?.credProps ? { credProps: true } : {},
    timeoutMs,
  };
}

export function getParams(
  transport: PasskeyTransport,
  origin: string,
  rpId: string,
  options: PasskeyPageGetOptions,
  timeoutMs: number,
) {
  return {
    transport,
    origin,
    crossOrigin: false,
    rpId,
    challenge: options.challenge,
    allowCredentials: options.allowCredentials ?? [],
    userVerification: options.userVerification ?? 'preferred',
    extensions: {},
    timeoutMs,
  };
}

export interface SidecarCreateResult {
  clientDataJSON: string;
  credentialId: string;
  attestationObject: string;
  authenticatorData: string;
  publicKey?: string | null;
  publicKeyAlgorithm: number;
  transports?: string[];
  authenticatorAttachment?: string;
  extensions?: { credProps?: { rk: boolean } };
}

export interface SidecarGetResult {
  clientDataJSON: string;
  credentialId: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string | null;
  authenticatorAttachment?: string;
}

export function createdCredential(
  result: SidecarCreateResult,
  credPropsRequested: boolean,
): PasskeyCreatedCredential {
  return {
    kind: 'create',
    id: result.credentialId,
    authenticatorAttachment: result.authenticatorAttachment ?? 'cross-platform',
    clientDataJSON: result.clientDataJSON,
    attestationObject: result.attestationObject,
    authenticatorData: result.authenticatorData,
    publicKey: result.publicKey ?? null,
    publicKeyAlgorithm: result.publicKeyAlgorithm,
    transports: result.transports ?? [],
    clientExtensionResults:
      credPropsRequested && result.extensions?.credProps
        ? { credProps: { rk: result.extensions.credProps.rk } }
        : {},
  };
}

export function assertedCredential(result: SidecarGetResult): PasskeyAssertedCredential {
  return {
    kind: 'get',
    id: result.credentialId,
    authenticatorAttachment: result.authenticatorAttachment ?? 'cross-platform',
    clientDataJSON: result.clientDataJSON,
    authenticatorData: result.authenticatorData,
    signature: result.signature,
    userHandle: result.userHandle ?? null,
    clientExtensionResults: {},
  };
}

/** Spec §11.3: the DOMException name the page sees. */
export function pageErrorName(code: SidecarErrorCode | string): PasskeyPageErrorName {
  switch (code) {
    case 'InvalidState':
      return 'InvalidStateError';
    case 'NotSupported':
      return 'NotSupportedError';
    case 'Security':
      return 'SecurityError';
    case 'Abort':
      return 'AbortError';
    default:
      return 'NotAllowedError';
  }
}

/** The dialog error for a sidecar failure; `null` closes the dialog without one. */
export function dialogErrorReason(
  code: SidecarErrorCode | string,
  bluetooth: 'on' | 'off' | 'missing' | undefined,
): PasskeyErrorReason | null {
  switch (code) {
    case 'Abort':
      return null;
    case 'BluetoothUnavailable':
      return bluetooth === 'missing' ? 'bluetooth-missing' : 'bluetooth-off';
    case 'PinLocked':
      return 'pin-locked';
    case 'Timeout':
      return 'timeout';
    case 'InvalidState':
      return 'already-registered';
    case 'NotSupported':
      return 'unavailable';
    default:
      return 'failed';
  }
}

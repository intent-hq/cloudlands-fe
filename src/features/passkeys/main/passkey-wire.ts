import { createHash } from 'node:crypto';
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

/** Same member order as Chromium; main is the only producer (spec §11.1). */
export function buildClientDataJSON(
  type: 'webauthn.create' | 'webauthn.get',
  challenge: string,
  origin: string,
): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

export function sha256Base64Url(data: Buffer): string {
  return createHash('sha256').update(data).digest('base64url');
}

export function createParams(
  transport: PasskeyTransport,
  origin: string,
  rpId: string,
  clientDataHash: string,
  options: PasskeyPageCreateOptions,
  timeoutMs: number,
) {
  const selection = options.authenticatorSelection ?? {};
  const residentKey =
    selection.residentKey ?? (selection.requireResidentKey ? 'required' : 'discouraged');
  return {
    transport,
    origin,
    rpId,
    clientDataHash,
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
  clientDataHash: string,
  options: PasskeyPageGetOptions,
  timeoutMs: number,
) {
  return {
    transport,
    origin,
    rpId,
    clientDataHash,
    allowCredentials: options.allowCredentials ?? [],
    userVerification: options.userVerification ?? 'preferred',
    extensions: {},
    timeoutMs,
  };
}

export interface SidecarCreateResult {
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
  credentialId: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string | null;
  authenticatorAttachment?: string;
}

export function createdCredential(
  result: SidecarCreateResult,
  clientDataJSON: Buffer,
  credPropsRequested: boolean,
): PasskeyCreatedCredential {
  return {
    kind: 'create',
    id: result.credentialId,
    authenticatorAttachment: result.authenticatorAttachment ?? 'cross-platform',
    clientDataJSON: clientDataJSON.toString('base64url'),
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

export function assertedCredential(
  result: SidecarGetResult,
  clientDataJSON: Buffer,
): PasskeyAssertedCredential {
  return {
    kind: 'get',
    id: result.credentialId,
    authenticatorAttachment: result.authenticatorAttachment ?? 'cross-platform',
    clientDataJSON: clientDataJSON.toString('base64url'),
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

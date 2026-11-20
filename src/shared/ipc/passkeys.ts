/**
 * Browser-panel passkey IPC contract (Linux, `intent-passkey` sidecar).
 *
 * Page side (`src/features/passkeys/preload/passkey-page.ts`, a frame preload on
 * the `persist:browser-panel` session):
 * - `passkeys:page-create` / `passkeys:page-get` (invoke) carry the page's
 *   `publicKey` options with binary fields as base64url. They resolve with a
 *   {@link PasskeyPageResult}; failures resolve `{ ok: false }` so the page sees
 *   a DOMException name and not an Electron wrapper message.
 * - `passkeys:page-cancel` (invoke) is the page's AbortSignal.
 * - `passkeys:page-capabilities` (invoke) resolves {@link PasskeyPageCapabilities}.
 *
 * Host side (the window that holds the webview):
 * - `passkeys:dialog-show` (send) is the full dialog state for one ceremony.
 * - `passkeys:dialog-close` (send) closes it.
 * - `passkeys:dialog-respond` (invoke) is the user's answer.
 *
 * App window (Settings → Passkeys, app renderer only):
 * - `passkeys:device-list` (invoke) resolves {@link PasskeyDeviceListResult}.
 * - `passkeys:device-delete` (invoke, {@link PasskeyDeviceDeleteRequest}) resolves
 *   {@link PasskeyDeviceDeleteResult}.
 *
 * Main takes the origin from `event.senderFrame` only; nothing here carries an
 * origin or URL from the page.
 */

export type PasskeyTransport = 'hybrid' | 'usb' | 'device';

export interface PasskeyCredentialDescriptor {
  id: string;
  transports?: string[];
}

export interface PasskeyPageCreateOptions {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  excludeCredentials?: PasskeyCredentialDescriptor[];
  authenticatorSelection?: {
    residentKey?: string;
    requireResidentKey?: boolean;
    userVerification?: string;
    authenticatorAttachment?: string;
  };
  attestation?: string;
  extensions?: { credProps?: boolean };
  timeout?: number;
}

export interface PasskeyPageGetOptions {
  challenge: string;
  rpId?: string;
  allowCredentials?: PasskeyCredentialDescriptor[];
  userVerification?: string;
  timeout?: number;
}

export interface PasskeyCreatedCredential {
  kind: 'create';
  id: string;
  authenticatorAttachment: string | null;
  clientDataJSON: string;
  attestationObject: string;
  authenticatorData: string;
  publicKey: string | null;
  publicKeyAlgorithm: number;
  transports: string[];
  clientExtensionResults: { credProps?: { rk: boolean } };
}

export interface PasskeyAssertedCredential {
  kind: 'get';
  id: string;
  authenticatorAttachment: string | null;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
  clientExtensionResults: Record<string, never>;
}

/** DOMException names the page may see. */
export type PasskeyPageErrorName =
  | 'NotAllowedError'
  | 'InvalidStateError'
  | 'NotSupportedError'
  | 'SecurityError'
  | 'AbortError'
  | 'TypeError';

export type PasskeyPageResult =
  | { ok: true; credential: PasskeyCreatedCredential | PasskeyAssertedCredential }
  | { ok: false; name: PasskeyPageErrorName; message: string };

export type PasskeyCeremonyKind = 'create' | 'get';

type PasskeyHybridAvailability = 'available' | 'bluetooth-off' | 'bluetooth-missing';

export type PasskeyProgress =
  | 'starting'
  | 'waiting-for-phone'
  | 'connecting'
  | 'waiting-for-approval'
  | 'touch-key'
  | 'processing';

export type PasskeyErrorReason =
  | 'bluetooth-off'
  | 'bluetooth-missing'
  | 'pin-locked'
  | 'timeout'
  | 'already-registered'
  | 'device-locked'
  | 'device-already-registered'
  | 'device-no-passkey'
  | 'device-old-pin-wrong'
  | 'device-failed'
  | 'unavailable'
  | 'failed';

interface PasskeyAccount {
  index: number;
  userName: string;
  userDisplayName: string;
}

export type PasskeyDialogView =
  | { step: 'choose-transport'; hybrid: PasskeyHybridAvailability; device: boolean }
  | { step: 'qr'; data: string; progress: PasskeyProgress }
  | { step: 'progress'; transport: PasskeyTransport; progress: PasskeyProgress }
  | {
      step: 'pin';
      /** `device`: the Intent OS PIN; `usb`: the security key PIN. */
      kind: 'usb' | 'device';
      wrongPin: boolean;
      attemptsLeft?: number;
      retryAfterMs?: number;
      /** Device only: the PIN changed; ask once for the previous PIN. */
      oldPin?: boolean;
      /** Device create with no device passkeys yet: show the PIN strength advice. */
      firstPasskey?: boolean;
    }
  | { step: 'choose-account'; accounts: PasskeyAccount[] }
  | { step: 'error'; reason: PasskeyErrorReason };

export interface PasskeyDialogShowPayload {
  ceremonyId: string;
  kind: PasskeyCeremonyKind;
  /** The relying party the browser process validated against the frame origin. */
  rpId: string;
  view: PasskeyDialogView;
}

export interface PasskeyDialogClosePayload {
  ceremonyId: string;
}

export type PasskeyDialogResponse =
  | { ceremonyId: string; action: 'transport'; transport: PasskeyTransport }
  | { ceremonyId: string; action: 'pin'; pin: string }
  | { ceremonyId: string; action: 'choose'; index: number }
  | { ceremonyId: string; action: 'cancel' };

export interface PasskeyPageCapabilities {
  /** True when this device can create and use device passkeys (Intent OS PIN). */
  platformAuthenticator: boolean;
}

export interface PasskeyDeviceCredential {
  credentialId: string;
  rpId: string;
  userName: string;
  userDisplayName: string;
  /** Milliseconds since the Unix epoch. */
  createdAt: number;
  /** Milliseconds since the Unix epoch; null until first use. */
  lastUsedAt: number | null;
}

export type PasskeyDeviceListResult =
  | { available: false }
  | { available: true; credentials: PasskeyDeviceCredential[] }
  | { available: true; error: true };

export interface PasskeyDeviceDeleteRequest {
  credentialId: string;
}

export interface PasskeyDeviceDeleteResult {
  ok: boolean;
}

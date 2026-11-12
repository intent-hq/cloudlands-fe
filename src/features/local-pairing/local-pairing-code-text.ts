/**
 * The plaintext pairing code, deliberately outside Redux, action payloads and
 * persistence so it never lands in state snapshots, diagnostics exports or
 * devtools (same boundary as `websocket-api-credentials.ts`). The daemon
 * returns it once, in the `pairing.createLocalCode` result; it is dropped as
 * soon as the code can no longer be redeemed.
 */

export interface LocalPairingCodeText {
  codeId: string;
  /** Display form, for example `KTP-82M`. */
  code: string;
}

type Receiver = (value: LocalPairingCodeText | null) => void;

let current: LocalPairingCodeText | null = null;
const receivers = new Set<Receiver>();

function deliver(value: LocalPairingCodeText | null): void {
  current = value;
  for (const receive of receivers) receive(value);
}

/** Receive the current code now and on every change; returns the disposer. */
export function registerLocalPairingCodeText(receive: Receiver): () => void {
  receivers.add(receive);
  receive(current);
  return () => {
    receivers.delete(receive);
  };
}

/** @internal The code currently held; exported for tests. */
export function readLocalPairingCodeText(): LocalPairingCodeText | null {
  return current;
}

export function receiveLocalPairingCodeText(value: LocalPairingCodeText): void {
  deliver(value);
}

/** Forget the code (any code, or only `codeId` when given). */
export function clearLocalPairingCodeText(codeId?: string): void {
  if (current && (codeId === undefined || current.codeId === codeId)) deliver(null);
}

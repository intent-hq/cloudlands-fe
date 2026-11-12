/**
 * Requester side (A) of local code pairing (protocol §5.58): Settings →
 * Machines → Add machine → Intent on this computer.
 *
 * The desktop app's main process reads the discovery folder and redeems the
 * code over `/local-pair`; the renderer only sees the list below and the
 * outcome. The credential token never crosses to the renderer.
 */

import type { ConnectionRecord } from './connections';

/** One Intent running on this computer that accepts local code pairing. */
export interface LocalIntent {
  /** The discovery record's `instanceId`; the only handle the renderer passes back. */
  instanceId: string;
  displayName: string;
  /** The daemon's data folder, shown to tell same-named installs apart. */
  dataDir: string;
  /** False while the other Intent has no listener (`port: null`). */
  accepting: boolean;
}

export type LocalIntentsListResult =
  | { ok: true; intents: LocalIntent[] }
  /** The discovery folder could not be read safely (not a folder, a symlink, someone else's). */
  | { ok: false; code: 'unavailable' };

/** Why redeeming a code failed. */
export type LocalRedeemErrorCode =
  /** Wrong code; `attemptsRemaining` is at least 1. */
  | 'wrong-code'
  /** Too many wrong tries: the code is cancelled. */
  | 'locked'
  /** No active code: expired, used, cancelled or never created. */
  | 'expired'
  /** Not six characters from the code alphabet (checked before anything is sent). */
  | 'code-format'
  /** The other Intent quit, or its record went away. */
  | 'gone'
  /** The other Intent has no listener yet. */
  | 'not-listening'
  /** Nothing answered on its port. */
  | 'unreachable'
  /** The certificate or the grant did not match its discovery record. */
  | 'certificate'
  /** The other Intent turned the request away (403 at upgrade, or not loopback). */
  | 'refused'
  /** The other Intent refuses local pairing while its remote access tunnel is on. */
  | 'remote-access-on'
  /** It does not serve local pairing (404, -32601, -32001). */
  | 'unsupported'
  /** Too many pairing attempts at once (503). */
  | 'busy'
  /** Paired, but this app could not save the machine. */
  | 'save-failed'
  /** Any other refusal, including error codes this app does not know yet. */
  | 'unknown';

export interface LocalRedeemError {
  code: LocalRedeemErrorCode;
  /** For `wrong-code`. */
  attemptsRemaining?: number;
}

export type LocalRedeemResult =
  { ok: true; connection: ConnectionRecord } | { ok: false; error: LocalRedeemError };

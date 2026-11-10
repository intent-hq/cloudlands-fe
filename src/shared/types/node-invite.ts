/**
 * Add a machine from an `intent://node` link (`intentd pair --node`).
 *
 * The link carries routes, the certificate pin and a single-use invite
 * secret, never an owner token. Main keeps the link in a short-lived pending
 * slot; the renderer sees only the pending id and a display name. The current
 * backend claims the invite (`remoteMachines.claim`) and saves the machine.
 * The backend advertises the method with `remoteMachineClaim: 1`
 * (`NODE_CAPABILITY_KEYS`). See protocol `methods/nodes.md` → Node invites and claim.
 */

import type { RemoteMachine } from './remote-machines';

/** Backend method that claims a node invite and saves the machine. */
export const NODE_INVITE_CLAIM_METHOD = 'remoteMachines.claim';

/** The only link version this app reads (`v=`). */
export const NODE_INVITE_LINK_VERSION = 1;

/** Params of the claim method. `uri` is a secret: never log or store it. */
export interface NodeInviteClaimParams {
  uri: string;
}

/** Claim errors: `error.data.code` from `remoteMachines.claim`. */
export const NODE_INVITE_DAEMON_CODES = [
  /** The backend found the link malformed. */
  'invalid-node-link',
  /** Unknown invite id or wrong secret (not told apart). */
  'node-invite-invalid',
  'node-invite-expired',
  /** Already claimed, by any backend. */
  'node-invite-used',
  'node-invite-revoked',
  /** The invite belongs to the backend's own daemon. */
  'node-invite-self',
  /** `-32603`; `attempts`, `inviteSpent`. */
  'machine-unreachable',
  /** `inviteSpent`. */
  'machine-update-required',
] as const;

type NodeInviteDaemonCode = (typeof NODE_INVITE_DAEMON_CODES)[number];

export type NodeInviteInspectErrorCode =
  /** Not an `intent://node` link. */
  | 'not-a-link'
  /** Missing a route, port, fingerprint, invite id or secret. */
  | 'incomplete'
  /** A link version (`v=`) other than 1. */
  | 'link-version';

export type NodeInviteInspectResult =
  | {
      ok: true;
      /** Main-only pending link; claim or discard it. */
      pendingId: string;
      /** The link's first host; null for a tunnel-only link. */
      label: string | null;
    }
  | { ok: false; code: NodeInviteInspectErrorCode };

export type NodeInviteClaimErrorCode =
  | NodeInviteDaemonCode
  /** `machine-unreachable` where every route failed the certificate pin. */
  | 'certificate-mismatch'
  /** The backend lacks the claim method (`-32601`). */
  | 'backend-unsupported'
  /** The window's connection is not the backend's owner (`-32003`). */
  | 'not-owner'
  /** The pending slot expired or was already used. */
  | 'expired'
  | 'failed';

export type NodeInviteClaimResult =
  | { ok: true; machine: RemoteMachine }
  | {
      ok: false;
      code: NodeInviteClaimErrorCode;
      /** Routes the backend tried, for `machine-unreachable`. */
      routes?: string[];
      /** The claim may have used the invite: the same link won't work again. */
      inviteSpent?: boolean;
    };

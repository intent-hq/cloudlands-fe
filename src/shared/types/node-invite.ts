/**
 * Add a machine from an `intent://node` link (`intentd pair --node`).
 *
 * The link carries routes, the certificate pin and a single-use invite
 * secret, never an owner token. Main keeps the parsed link in a short-lived
 * pending slot; the renderer sees only the pending id and a display name.
 * The current backend claims the invite and stores the machine.
 *
 * The wire names below follow the protocol docs (node invite links). The
 * backend advertises the claim method with `remoteMachineInvites: 1`
 * (`NODE_CAPABILITY_KEYS`).
 */

import type { RemoteMachine } from './remote-machines';

/** Backend method that claims a node invite and saves the machine. */
export const NODE_INVITE_CLAIM_METHOD = 'remoteMachines.claim';

/** Link versions this app understands (`v=`). */
export const NODE_INVITE_LINK_VERSION = 1;

/** Params of the claim method. `secret` is a credential: never log it. */
export interface NodeInviteClaimParams {
  inviteId: string;
  secret: string;
  hosts: string[];
  port: number;
  tcAddress?: string;
  fingerprint: string;
}

/** Daemon `error.data.code` values of a failed claim. */
export const NODE_INVITE_DAEMON_CODES = [
  /** Unknown invite id or wrong secret. */
  'invite-invalid',
  'invite-expired',
  /** Already claimed (single use). */
  'invite-used',
  'invite-revoked',
  'machine-unreachable',
  'machine-update-required',
] as const;

type NodeInviteDaemonCode = (typeof NODE_INVITE_DAEMON_CODES)[number];

export type NodeInviteInspectErrorCode =
  /** Not an `intent://node` link. */
  | 'not-a-link'
  /** Missing a route, port, fingerprint, invite id or secret. */
  | 'incomplete'
  /** A newer link format (`v=`) than this app reads. */
  | 'link-version';

export type NodeInviteInspectResult =
  | {
      ok: true;
      /** Main-only pending link; claim or discard it. */
      pendingId: string;
      /** Display name: the link's `name=`, else its first route. */
      label: string;
    }
  | { ok: false; code: NodeInviteInspectErrorCode };

export type NodeInviteClaimErrorCode =
  | NodeInviteDaemonCode
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
    };

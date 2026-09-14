/**
 * Wire shapes for workspace sharing (multiplayer w3/w4, intent-hq/intentd#1868
 * and #1872): the `workspace.members.*` roster and the `workspace.invite.*`
 * link lifecycle. Field names match the daemon structs 1:1 (camelCase).
 */
import type { WorkspaceRole } from '$shared/types';

/** One `workspace.members.list` row — a membership joined to its principal. */
export interface WorkspaceMember {
  principalId: string;
  /** GitHub login; null for a principal without a resolved identity. */
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: WorkspaceRole;
  addedAt: string;
}

/**
 * One `workspace_invite` row as `workspace.invite.list` / `.create` return it.
 * The link secret is never on this shape: `create` returns it once, beside the
 * invite, and `list` never carries it.
 */
export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  createdByPrincipalId: string;
  /** GitHub user id the invite is pinned to; absent when open to anyone. */
  pinGithubUserId?: number;
  /** Canonical GitHub login of the pinned account (as resolved by the daemon). */
  pinLogin?: string;
  createdAt: string;
  expiresAt: string;
  redeemedAt?: string;
  redeemedByPrincipalId?: string;
  revokedAt?: string;
}

/**
 * `workspace.invite.create` result: the invite row plus the one-time `secret`
 * and the ready-to-send `intent://invite` link that wraps it with the daemon's
 * dial envelope. Neither the secret nor the url is ever returned again.
 */
export interface WorkspaceInviteCreateResult {
  invite: WorkspaceInvite;
  secret: string;
  url: string;
  hosts: string[];
  port: number;
  fingerprint: string;
  tcAddress?: string;
  version: number;
}

/**
 * Machine-readable `error.data.code` values the daemon attaches to invite
 * failures (`Error::Invite(InviteErrorKind)`, intent-hq/intentd#1872).
 */
export type InviteErrorCode =
  | 'invite-not-found'
  | 'invite-expired'
  | 'invite-revoked'
  | 'invite-redeemed'
  | 'invite-pin-mismatch'
  | 'invite-pin-unknown'
  | 'github-identity-required'
  | 'primary-identity-locked'
  | 'invite-flow-denied'
  | 'invite-flow-expired'
  | 'invite-flow-error'
  | 'invite-flow-not-found'
  | 'invite-flow-busy';

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
 * `workspace.members.list` result: the roster plus the workspace's guest cap
 * (intent-hq/intentd#1917). `guestCount` is the collaborators plus open
 * invites spent against `guestLimit` (`sharing.maxGuestsPerWorkspace`; `0`
 * closes the workspace to guests). Both are `null` when the daemon predates
 * the cap fields, so a caller gates on the cap only when it is known.
 */
export interface WorkspaceMembersList {
  members: WorkspaceMember[];
  guestCount: number | null;
  guestLimit: number | null;
}

/**
 * One `workspace_invite` row as `workspace.invite.list` / `.create` return it.
 * The raw secret is never on this shape; the ready-to-send `intent://invite`
 * link is (`url`), so an owner can copy any open invite again.
 */
export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  createdByPrincipalId: string;
  /**
   * The `intent://invite` link for this open invite; absent when the daemon
   * cannot build the dial envelope (Remote Access listener down).
   */
  url?: string;
  /** GitHub user id the invite is pinned to; absent when open to anyone. */
  pinGithubUserId?: number;
  /** Canonical GitHub login of the pinned account (as resolved by the daemon). */
  pinLogin?: string;
  createdAt: string;
  expiresAt: string;
  /** Last redemption (a reusable invite stays open across redemptions). */
  redeemedAt?: string;
  redeemedByPrincipalId?: string;
  revokedAt?: string;
  /**
   * `true` when the link stays open across redemptions (unpinned invites,
   * daemons ≥ intent-hq/intentd#1988); a pinned invite is single-use. Absent
   * on a daemon that predates reusable links, where every invite is
   * single-use.
   */
  reusable?: boolean;
  /** Memberships the link created so far; absent on a daemon that predates it. */
  redemptionCount?: number;
}

/**
 * `workspace.invite.create` result: the invite row plus the `secret` and the
 * ready-to-send `intent://invite` link that wraps it with the daemon's dial
 * envelope. The raw secret is returned only here; the link is also available
 * on later `workspace.invite.list` rows as `invite.url`.
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
 * failures (`Error::Invite(InviteErrorKind)`, intent-hq/intentd#1872). The
 * client allowlists against this tuple: any other `data.code` string is
 * folded to `unknown` so an arbitrary daemon/transport value never rides a
 * failure record or a log line.
 */
export const INVITE_ERROR_CODES = [
  'invite-not-found',
  'invite-expired',
  'invite-revoked',
  'invite-redeemed',
  'invite-pin-mismatch',
  'invite-pin-unknown',
  'github-identity-required',
  'primary-identity-locked',
  'invite-flow-denied',
  'invite-flow-expired',
  'invite-flow-error',
  'invite-flow-not-found',
  'invite-flow-busy',
  'guest-limit',
  'workspace-full',
] as const;

export type InviteErrorCode = (typeof INVITE_ERROR_CODES)[number];

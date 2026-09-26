/**
 * Guest Sessions Slice Types (multiplayer w4)
 *
 * Renderer state for the hosts this app joined as a GUEST through an
 * `intent://invite` link, plus the owner-side roster of the workspaces the
 * current window's backend shares. The wire/IPC contract lives in
 * `shared/types/guest-sessions.ts`; this module re-exports the shapes the
 * slice/selectors/saga consume and adds the renderer-only slice-state type.
 *
 * Safe to import from any process.
 */

import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import type { WorkspaceRole } from '$shared/types';
import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

export type {
  GuestSessionRecord,
  GuestSessionsListResult,
  LeaveGuestSessionResult,
  LeaveGuestWorkspaceResult,
} from '$shared/types/guest-sessions';

/**
 * One `workspace.members.list` row — a membership joined to its principal
 * (PROTOCOL §5.1, intent-hq/intentd#1868). Field names match the daemon
 * struct 1:1.
 */
export interface WorkspaceMember {
  principalId: string;
  /** Forge handle; null for a principal without a resolved identity. */
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: WorkspaceRole;
  addedAt: string;
  /** Provider-neutral account identity from `workspace.members.list`; omitted while unlinked. */
  identity?: {
    provider: 'github' | 'gitlab';
    host: string;
    externalUserId: string;
  };
}

/** `workspace.members.list` result. */
export interface WorkspaceMembersListResult {
  members: WorkspaceMember[];
}

/** `workspace.members.remove` result. */
export interface WorkspaceMemberRemoveResult {
  removed: boolean;
}

/**
 * One open `workspace_invite` row as `workspace.invite.list` returns it
 * (intent-hq/intentd#1872). The link secret never rides this shape.
 */
export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  createdByPrincipalId: string;
  pinGithubUserId?: number;
  pinLogin?: string;
  createdAt: string;
  expiresAt: string;
  redeemedAt?: string;
  redeemedByPrincipalId?: string;
  revokedAt?: string;
}

/** `workspace.invite.list` result: the workspace's open invites. */
export interface WorkspaceInviteListResult {
  invites: WorkspaceInvite[];
}

/** `workspace.invite.revoke` result. */
export interface WorkspaceInviteRevokeResult {
  revoked: boolean;
}

/**
 * Bounded failure codes of the roster read / *Remove* operations — the only
 * values a rejected `loadHostedRosterRequested` / `removeHostedMemberRequested`
 * promise (and any log line) carries. A raw daemon or transport message never
 * rides the failure: `forbidden` is the daemon's `-32003` (or the local owner
 * gate), `daemon` any other structured refusal, `transport` a bridge/socket/
 * timeout failure, `cancelled` a purge that cut the operation short.
 */
export type HostedRosterFailureCode = 'forbidden' | 'daemon' | 'transport' | 'cancelled';

/**
 * Outcome of one *Remove all guests* sweep (`removeAllHostedGuestsRequested`):
 * every collaborator of the workspace removed (`workspace.members.remove`)
 * and every open invite revoked (`workspace.invite.revoke`), each step
 * reported on its own so a partial failure is never silent. The promise
 * RESOLVES with this shape even when steps failed; it rejects only when the
 * sweep could not run at all (ownership lost, roster unreadable, purged).
 */
export interface RemoveAllHostedGuestsResult {
  removedPrincipalIds: string[];
  failedMembers: Array<{ principalId: string; code: HostedRosterFailureCode }>;
  revokedInviteIds: string[];
  /** `pinLogin` names the invite for the report when the link was pinned to a GitHub login. */
  failedInvites: Array<{
    inviteId: string;
    pinLogin: string | null;
    code: HostedRosterFailureCode;
  }>;
  /** Set when `workspace.invite.list` itself failed: no invite was revoked. */
  invitesUnavailable: HostedRosterFailureCode | null;
}

export class HostedRosterOperationError extends Error {
  readonly code: HostedRosterFailureCode;
  constructor(code: HostedRosterFailureCode) {
    // i18n-ignore (bounded machine code, never rendered)
    super(code);
    this.name = 'HostedRosterOperationError';
    this.code = code;
  }
}

/**
 * Bounded failure codes of the main-owned guest session operations (list
 * hydration, *Leave host*) — the only values a rejected
 * `loadGuestSessionsRequested` / `leaveGuestSessionRequested` promise carries.
 * A raw IPC rejection never rides the failure (main's message may echo host
 * material): `ipc` is any failed invoke, `cancelled` a saga teardown that cut
 * the operation short.
 */
export type GuestSessionFailureCode = 'ipc' | 'cancelled';

export class GuestSessionOperationError extends Error {
  readonly code: GuestSessionFailureCode;
  constructor(code: GuestSessionFailureCode) {
    // i18n-ignore (bounded machine code, never rendered)
    super(code);
    this.name = 'GuestSessionOperationError';
    this.code = code;
  }
}

export interface HostedRoster {
  /**
   * Load state of one hosted workspace's roster. `withheld` is terminal: the
   * caller no longer manages the workspace (daemon `-32003 Forbidden`, or the
   * local owner gate) — cached rows are dropped, no owner RPC is sent for the
   * workspace, and a load / read / failure landing afterwards leaves the
   * entry as is; only purging the workspace entry ends it.
   */
  status: 'loading' | 'loaded' | 'error' | 'withheld';
  members: WorkspaceMember[];
}

export interface GuestSessionsState {
  /** Hosts joined as a guest, authoritative from main (`guest-sessions:list` / `:changed`). */
  sessions: Collection<GuestSessionRecord, 'id'>;
  /** Sessions with a pooled client (a window for that host was opened). */
  openIds: string[];
  /** Sessions whose pooled client is currently connected (subset of `openIds`). */
  connectedIds: string[];
  /** Whether the authoritative list has completed its first hydration. */
  hasReceivedList: boolean;
  /**
   * True when the boot hydration could not deliver a list (the invoke failed,
   * or there is no Electron bridge to ask): the window's guest/owner identity
   * is then settled on what is known rather than held open forever. Cleared
   * by the next list payload.
   */
  listUnavailable: boolean;
  /** Guest session ids with a *Leave host* in flight. */
  leavingIds: string[];
  /** `${sessionId}:${workspaceId}` keys with a per-workspace *Leave* in flight. */
  leavingWorkspaceKeys: string[];
  /** Retryable failures of confirmed operations; confirmation dialogs never retarget these. */
  failedLeaveIds: string[];
  failedLeaveWorkspaceKeys: string[];
  failedMemberKeys: string[];
  /** Historical reports survive a membership delta removing a row from the hosting list. */
  sweepReports: Collection<HostedSweepReport, 'workspaceId'>;
  /**
   * Owner-side rosters of the current window's shared workspaces, keyed by
   * workspace id — a read-through view of `workspace.members.list`, refetched
   * on the workspace's membership-changing `workspace:updated` deltas.
   */
  hostedRosters: Record<string, HostedRoster>;
  /** `${workspaceId}:${principalId}` keys with a *Remove* in flight. */
  removingMemberKeys: string[];
  /** Hosted workspace ids with a *Remove all guests* sweep in flight. */
  clearingWorkspaceIds: string[];
}

export interface HostedSweepReport {
  workspaceId: string;
  workspaceTitle: string;
  /** Labels captured before mutation, not a second copy of workspace/member entities. */
  memberLabels: Record<string, string>;
  failedMemberIds: string[];
  failedInviteLabels: string[];
  invitesUnavailable: boolean;
}

export function hostedMemberKey(workspaceId: string, principalId: string): string {
  return `${workspaceId}:${principalId}`;
}

export function guestWorkspaceKey(sessionId: string, workspaceId: string): string {
  return `${sessionId}:${workspaceId}`;
}

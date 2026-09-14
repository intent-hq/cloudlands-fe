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
} from '$shared/types/guest-sessions';

/**
 * One `workspace.members.list` row — a membership joined to its principal
 * (PROTOCOL §5.1, intent-hq/intentd#1868). Field names match the daemon
 * struct 1:1.
 */
export interface WorkspaceMember {
  principalId: string;
  /** GitHub login; null for a principal without a resolved identity. */
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: WorkspaceRole;
  addedAt: string;
}

/** `workspace.members.list` result. */
export interface WorkspaceMembersListResult {
  members: WorkspaceMember[];
}

/** `workspace.members.remove` result. */
export interface WorkspaceMemberRemoveResult {
  removed: boolean;
}

export interface HostedRoster {
  /** Load state of one hosted workspace's roster. */
  status: 'loading' | 'loaded' | 'error';
  members: WorkspaceMember[];
}

export interface GuestSessionsState {
  /** Hosts joined as a guest, authoritative from main (`guest-sessions:list` / `:changed`). */
  sessions: Collection<GuestSessionRecord, 'id'>;
  /** Sessions whose pooled client is currently connected. */
  connectedIds: string[];
  /** Whether the authoritative list has completed its first hydration. */
  hasReceivedList: boolean;
  /** Guest session ids with a *Leave host* in flight. */
  leavingIds: string[];
  /**
   * Owner-side rosters of the current window's shared workspaces, keyed by
   * workspace id — a read-through view of `workspace.members.list`, refetched
   * on the workspace's membership-changing `workspace:updated` deltas.
   */
  hostedRosters: Record<string, HostedRoster>;
  /** `${workspaceId}:${principalId}` keys with a *Remove* in flight. */
  removingMemberKeys: string[];
}

export function hostedMemberKey(workspaceId: string, principalId: string): string {
  return `${workspaceId}:${principalId}`;
}

/**
 * Guest Sessions Selectors (multiplayer w4)
 */

import { store } from '../../store';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  hostedMemberKey,
  guestWorkspaceKey,
  type GuestSessionRecord,
  type HostedRoster,
} from './guest-sessions-types';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

const NO_ROSTER: HostedRoster = { status: 'loading', members: [] };

/** Hosts joined as a guest, in main's order. */
export const selectGuestSessions = store.createSelector((state) =>
  getItems(state.guestSessions.sessions),
);

/** Whether the authoritative guest session list has completed its first hydration. */
export const selectGuestSessionsLoaded = store.createSelector(
  (state) => state.guestSessions.hasReceivedList,
);

/**
 * The guest session the current window is bound to (its backend id is a
 * joined host), or null in an owner window (local / paired device).
 */
export const selectWindowGuestSession = store.createSelector(
  (state): GuestSessionRecord | null =>
    getItem(state.guestSessions.sessions, state.connections.windowBackendId) ?? null,
);

/** Saved invited-session category only; connected principal state determines authority. */
export const selectIsGuestWindow = store.createSelector(
  (state) => selectWindowGuestSession.select(state) !== null,
);

/**
 * ids of the guest sessions with a pooled client (a window for that host was
 * opened). The nav block shows a connectivity status for these only; a
 * session outside this set has no window and shows no status.
 */
export const selectGuestSessionsOpenIds = store.createSelector(
  (state) => state.guestSessions.openIds,
);

/**
 * ids of the guest sessions whose pooled client is currently connected
 * (subset of `openIds`). The nav block shows "connected" / "not connected"
 * from this for open sessions.
 */
export const selectGuestSessionsConnectedIds = store.createSelector(
  (state) => state.guestSessions.connectedIds,
);

export const selectGuestLeavingIds = store.createSelector(
  (state) => state.guestSessions.leavingIds,
);
export const selectGuestLeavingWorkspaceKeys = store.createSelector(
  (state) => state.guestSessions.leavingWorkspaceKeys,
);
export const selectGuestFailedLeaves = store.createSelector((state) =>
  selectGuestSessions
    .select(state)
    .filter((session) => state.guestSessions.failedLeaveIds.includes(session.id)),
);
export const selectGuestFailedWorkspaceLeaves = store.createSelector((state) =>
  selectGuestSessions
    .select(state)
    .flatMap((session) =>
      (session.workspaces ?? [])
        .filter((workspace) =>
          state.guestSessions.failedLeaveWorkspaceKeys.includes(
            guestWorkspaceKey(session.id, workspace.id),
          ),
        )
        .map((workspace) => ({ session, workspace })),
    ),
);
export const selectGuestLeaveFailedIds = store.createSelector(
  (state) => state.guestSessions.failedLeaveIds,
);
export const selectHostedSweepReports = store.createSelector((state) =>
  getItems(state.guestSessions.sweepReports),
);
export const selectHostedSweepReport = store.createSelector((state, workspaceId: string) =>
  getItem(state.guestSessions.sweepReports, workspaceId),
);
export const selectHostedClearingIds = store.createSelector(
  (state) => state.guestSessions.clearingWorkspaceIds,
);

/**
 * Whether a workspace is in this window's list. A roster operation for a
 * workspace outside the list has nothing to render into: it fails without
 * installing (or re-installing) a roster entry.
 */
export const selectIsHostedWorkspaceListed = store.createSelector(
  (state, workspaceId: string): boolean =>
    getItem(state.workspace.workspaces, WorkspaceId(workspaceId)) !== undefined,
);

/**
 * Whether the caller manages a workspace's membership right now: the
 * workspace is in this window's list, `myRole` is not `collaborator` (absent
 * `myRole` — older daemon — reads as owner) and its roster is not already
 * terminally `withheld`. The saga's gate before AND after
 * `workspace.members.list` / `workspace.members.remove`: a collaborator, a
 * workspace that left the list, or a workspace the daemon already refused
 * never sends (or applies the result of) an owner RPC.
 */
export const selectCanManageHostedWorkspace = store.createSelector(
  (state, workspaceId: string): boolean => {
    if (state.guestSessions.hostedRosters[workspaceId]?.status === 'withheld') return false;
    const ws = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
    return ws !== undefined && ws.myRole !== 'collaborator';
  },
);

/**
 * Workspaces the current window's backend shares with at least one
 * collaborator and the caller owns — the Settings "Hosting" list. Absent
 * `myRole` (older daemon) reads as owner; `memberCount` counts the owner too,
 * so a workspace is shared once it exceeds 1.
 */
export const selectHostedWorkspaces = store.createSelector((state): Workspace[] =>
  getItems(state.workspace.workspaces).filter(
    (ws) => ws.myRole !== 'collaborator' && (ws.memberCount ?? 1) > 1,
  ),
);

/** The roster of one hosted workspace (loading placeholder before the first read). */
export const selectHostedRoster = store.createSelector(
  (state, workspaceId: string): HostedRoster =>
    state.guestSessions.hostedRosters[workspaceId] ?? NO_ROSTER,
);

export const selectHostedFailedRemovals = store.createSelector((state, workspaceId: string) =>
  selectHostedRoster
    .select(state, workspaceId)
    .members.filter((member) =>
      state.guestSessions.failedMemberKeys.includes(
        hostedMemberKey(workspaceId, member.principalId),
      ),
    ),
);

const NO_PRINCIPALS: string[] = [];

/** Principal ids with a *Remove* in flight in one hosted workspace. */
export const selectHostedRemovingPrincipalIds = store.createSelector(
  (state, workspaceId: string): string[] => {
    const prefix = hostedMemberKey(workspaceId, '');
    const ids = state.guestSessions.removingMemberKeys
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
    return ids.length === 0 ? NO_PRINCIPALS : ids;
  },
);

/** Whether a *Remove all guests* sweep is in flight for one hosted workspace. */
export const selectIsHostedWorkspaceClearing = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.guestSessions.clearingWorkspaceIds.includes(workspaceId),
);

/**
 * `${workspaceId}:${memberCount}` for every workspace with a tracked roster —
 * the saga's change signal to refetch a roster whose daemon-side membership
 * moved. A `withheld` roster is terminal and excluded (no refetch), as is a
 * workspace the caller no longer manages. Sorted so the array is
 * shallow-stable across unrelated updates.
 */
export const selectHostedRosterMemberCounts = store.createSelector((state): string[] => {
  const entries: string[] = [];
  for (const [workspaceId, roster] of Object.entries(state.guestSessions.hostedRosters)) {
    if (roster.status === 'withheld') continue;
    const ws = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
    if (!ws || ws.myRole === 'collaborator') continue;
    entries.push(`${workspaceId}:${ws.memberCount ?? 0}`);
  }
  return entries.sort();
});

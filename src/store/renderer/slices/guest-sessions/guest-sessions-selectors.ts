/**
 * Guest Sessions Selectors (multiplayer w4)
 */

import { isWorkspaceGuest } from '$features/workspace-sharing/utils/workspace-guest';
import {
  selectCollaborationReady,
  selectHostRole,
  selectPrincipalSnapshot,
} from '../principal/principal-selectors';
import {
  selectCanManageWorkspace,
  selectWorkspaceAuthority,
  selectWorkspaceListLoadedForBackend,
} from '../workspace/workspace-selectors';
import { canManageWorkspace } from '../workspace/workspace-authority';
import { store } from '../../store';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  hostedMemberKey,
  guestSessionLifetime,
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

/** Current workspace management, with Multiplayer presentation enabled and no server refusal. */
export const selectCanManageHostedWorkspace = store.createSelector(
  (state, workspaceId: string): boolean => {
    if (state.guestSessions.hostedRosters[workspaceId]?.status === 'withheld') return false;
    const ws = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
    return (
      ws !== undefined &&
      selectCollaborationReady.select(state) &&
      selectCanManageWorkspace.select(state, workspaceId)
    );
  },
);

/** Active invitation summary; never infer workspace guests from total host membership. */
export const selectHostedPendingInviteCount = store.createSelector(
  (state, workspaceId: string): number | null => {
    const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
    if (workspace?.openInviteCount != null) return workspace.openInviteCount;
    const roster = state.guestSessions.hostedRosters[workspaceId];
    // The canonical cap counts accepted guests plus open invitations on older summaries.
    return roster?.guestCount != null
      ? Math.max(0, roster.guestCount - roster.members.filter(isWorkspaceGuest).length)
      : null;
  },
);

/** Empty sharing is meaningful only after this backend's workspace list has loaded. */
export const selectHostedSharingLoadState = store.createSelector(
  (state): 'loading' | 'error' | 'loaded' => {
    if (state.workspace.error) return 'error';
    return selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId)
      ? 'loaded'
      : 'loading';
  },
);

/** Unknown rosters stay visible while read; proven unshared workspaces disappear. */
export const selectHostedWorkspaces = store.createSelector((state): Workspace[] => {
  const authority = selectWorkspaceAuthority.select(state);
  return getItems(state.workspace.workspaces).filter((ws) => {
    if (!authority.collaborationReady || !canManageWorkspace(authority, ws.id, () => ws))
      return false;
    const pending = selectHostedPendingInviteCount.select(state, ws.id);
    if ((ws.memberCount ?? Infinity) <= 1 && pending === 0) return false;
    const roster = state.guestSessions.hostedRosters[ws.id];
    if (!roster || roster.status !== 'loaded') return true;
    return roster.members.some(isWorkspaceGuest) || pending === null || pending > 0;
  });
});

/** Saved role is a presentation hint only; an admitted current principal supersedes it. */
export const selectJoinedInstanceSessions = store.createSelector((state) => {
  const current = selectWindowGuestSession.select(state);
  const principal = selectPrincipalSnapshot.select(state);
  return selectGuestSessions.select(state).filter((session) => {
    const currentRole =
      current?.id === session.id && principal?.principal.id === session.principalId
        ? selectHostRole.select(state)
        : null;
    return currentRole ? currentRole !== 'guest' : session.hostRole === 'member';
  });
});
export const selectJoinedWorkspaceSessions = store.createSelector((state) => {
  const instances = new Set(
    selectJoinedInstanceSessions.select(state).map((session) => session.id),
  );
  return selectGuestSessions.select(state).filter((session) => !instances.has(session.id));
});
export const selectGuestSessionsUnavailable = store.createSelector(
  (state) => state.guestSessions.listUnavailable,
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
 * `${workspaceId}:${memberCount},${invalidation}` for every tracked roster —
 * the saga's change signal to refetch a roster whose daemon-side membership
 * moved, including invite-only events whose memberCount stays unchanged. A `withheld` roster is terminal and excluded (no refetch), as is a
 * workspace the caller no longer manages. Sorted so the array is
 * shallow-stable across unrelated updates.
 */
export const selectHostedRosterVersions = store.createSelector((state): string[] => {
  const entries: string[] = [];
  for (const [workspaceId, roster] of Object.entries(state.guestSessions.hostedRosters)) {
    if (roster.status === 'withheld') continue;
    const ws = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
    if (!ws || !selectCanManageHostedWorkspace.select(state, workspaceId)) continue;
    entries.push(`${workspaceId}:${ws.memberCount ?? 0},${roster.invalidation ?? 0}`);
  }
  return entries.sort();
});

export const selectInheritedWorkspaceKeys = store.createSelector(
  (state) => state.guestSessions.inheritedWorkspaceKeys,
);

export const selectGuestLeaveConfirmations = store.createSelector(
  (state) => state.guestSessions.leaveConfirmations,
);

export const selectGuestSessionLifetime = store.createSelector((state, id: string) =>
  guestSessionLifetime(getItem(state.guestSessions.sessions, id)),
);

/**
 * Whether this window can offer *Leave* for one workspace from the workspace
 * menu: a guest window (saved invite session, not an instance membership)
 * whose record lists the workspace as directly joined, the caller is not its
 * owner, and the host has not already refused the leave because access is
 * inherited through host membership. Mirrors the per-workspace *Leave* row in
 * Settings → Collaboration, which runs the same `leaveGuestWorkspaceRequested`.
 */
export const selectCanLeaveWorkspace = store.createSelector(
  (state, workspaceId: string): boolean => {
    if (!workspaceId || !selectCollaborationReady.select(state)) return false;
    const session = selectWindowGuestSession.select(state);
    if (!session || !(session.workspaces ?? []).some((ws) => ws.id === workspaceId)) return false;
    if (selectJoinedInstanceSessions.select(state).some((joined) => joined.id === session.id))
      return false;
    if (
      state.guestSessions.inheritedWorkspaceKeys.includes(
        guestWorkspaceKey(session.id, workspaceId),
      )
    )
      return false;
    return getItem(state.workspace.workspaces, WorkspaceId(workspaceId))?.myRole !== 'owner';
  },
);

/**
 * Whether this window asked to leave one workspace and the host's removal
 * delta has not been announced yet (see `selfLeaveWorkspaceKeys`).
 */
export const selectIsSelfLeftWorkspace = store.createSelector(
  (state, workspaceId: string): boolean => {
    const session = selectWindowGuestSession.select(state);
    return (
      !!session &&
      state.guestSessions.selfLeaveWorkspaceKeys.includes(
        guestWorkspaceKey(session.id, workspaceId),
      )
    );
  },
);

/** Whether this window's guest session has a *Leave* in flight for one workspace. */
export const selectIsLeavingWorkspace = store.createSelector(
  (state, workspaceId: string): boolean => {
    const session = selectWindowGuestSession.select(state);
    return (
      !!session &&
      state.guestSessions.leavingWorkspaceKeys.includes(guestWorkspaceKey(session.id, workspaceId))
    );
  },
);

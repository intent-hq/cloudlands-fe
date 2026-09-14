/**
 * Guest Sessions Selectors (multiplayer w4)
 */

import { store } from '../../store';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  hostedMemberKey,
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

/** Whether the current window's backend is a host this app joined as a guest. */
export const selectIsGuestWindow = store.createSelector(
  (state) => selectWindowGuestSession.select(state) !== null,
);

/**
 * ids of the guest sessions whose pooled client is currently connected. The
 * nav block shows "connected" / "not connected" from this.
 */
export const selectGuestSessionsConnectedIds = store.createSelector(
  (state) => state.guestSessions.connectedIds,
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

/**
 * `${workspaceId}:${memberCount}` for every workspace with a loaded roster —
 * the saga's change signal to refetch a roster whose daemon-side membership
 * moved. Sorted so the array is shallow-stable across unrelated updates.
 */
export const selectHostedRosterMemberCounts = store.createSelector((state): string[] => {
  const entries: string[] = [];
  for (const workspaceId of Object.keys(state.guestSessions.hostedRosters)) {
    const ws = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
    if (!ws) continue;
    entries.push(`${workspaceId}:${ws.memberCount ?? 0}`);
  }
  return entries.sort();
});

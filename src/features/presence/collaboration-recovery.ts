import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import type { Action } from '@redux-saga/types';
import type { StoreState } from '$store/renderer/types';
import type {
  RendererRecoveryHandle,
  RendererRecoveryOwner,
  RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { isPresenceRoster, type PresenceRoster } from '$shared/types/presence';
import { isLiveClient, type LiveClient } from '$shared/types/browser-clients';
import { parsePrincipalSnapshot } from '$shared/types/principal';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  selectPresenceContext,
  selectPresenceWorkspaceIds,
  selectPresenceMembershipKeys,
} from '$store/renderer/slices/presence/presence-selectors';
import {
  presenceSnapshotReceived,
  presenceMembersReceived,
  presenceWorkspaceRemoved,
} from '$store/renderer/slices/presence/presence-slice';
import type { WorkspaceMembersListResult } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
import { selectShareCanManage } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
import {
  shareDataLoaded,
  sharePrincipalsLoaded,
  shareAccessWithheld,
  shareRosterLoaded,
  shareRosterRetired,
} from '$store/renderer/slices/workspace-share/workspace-share-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { clearInviteLinks, vaultInviteLinks } from '$features/workspace-sharing/invite-link-vault';
import type {
  HostPrincipal,
  WorkspaceInviteRow,
  WorkspaceMembersList,
} from '$features/workspace-sharing/types';
import {
  selectHostMembershipContext,
  selectHostUserPresenceSession,
} from '$store/renderer/slices/host-membership/host-membership-selectors';
import {
  hostMembershipLoaded,
  hostMembershipRecoveryCleared,
  hostUserPresenceSettled,
  hostUserPresenceCleared,
} from '$store/renderer/slices/host-membership/host-membership-slice';
import { clearHostInviteLinks, retainHostInviteLink } from '$features/host-membership/invite-links';
import type { HostInvite, HostInviteRow, HostMember } from '$features/host-membership/types';

export const collaborationKey = (
  kind: 'presence-roster' | 'presence-members' | 'share-dialog' | 'share-roster',
  workspaceId: string,
) => `${kind}:${JSON.stringify([workspaceId])}`;
const handles = new Map<string, RendererRecoveryHandle>();
type Flight = { work: Promise<unknown>; receipt: RecoveryLifetime };
const pending = new Map<string, Set<Flight>>();

export const collaborationReadBlocked = (key: string): boolean =>
  handles.get(key)?.status.stale === true || !rendererEventRecovery.capture(key).isCurrent();
export function trackCollaborationFlight(key: string, work: Promise<unknown>): void {
  const flight = { work, receipt: rendererEventRecovery.capture(key) };
  const flights = pending.get(key) ?? new Set<Flight>();
  pending.set(key, flights);
  flights.add(flight);
  void work
    .finally(() => {
      flights.delete(flight);
      if (!flights.size && pending.get(key) === flights) pending.delete(key);
    })
    .catch(() => {});
}

/** Recovery waits for existing RPCs; coalescing never reuses another captured lifetime. */
export function readCollaboration<T>(key: string, read: () => Promise<T>): Promise<T | undefined> {
  if (collaborationReadBlocked(key)) return Promise.resolve(undefined);
  const receipt = rendererEventRecovery.capture(key);
  const flights = [...(pending.get(key) ?? [])];
  const same =
    handles.has(key) && flights.find((f) => f.receipt.key === receipt.key && f.receipt.isCurrent());
  if (same) return same.work as Promise<T>;
  const work =
    handles.has(key) && flights.length
      ? Promise.allSettled(flights.map((f) => f.work)).then(() =>
          receipt.commit(() => undefined) && !collaborationReadBlocked(key) ? read() : undefined,
        )
      : read();
  trackCollaborationFlight(key, work);
  return work;
}

/** A command reply is an unversioned writer too: after loss, reconcile by reading. */
export function admitCollaborationCommand(
  key: string,
  captured: RecoveryLifetime,
): RecoveryLifetime | null {
  const handle = handles.get(key);
  if (!captured.commit(() => undefined)) {
    handle?.invalidate();
    return null;
  }
  if (handle && !handle.push()) return null;
  // Recapture is permitted only after both the captured authority and this writer were admitted.
  return rendererEventRecovery.capture(key);
}

/** Shared validation for initial client.list and post-loss reads. */
export function onlineHostPrincipals(clients: LiveClient[]): string[] {
  const ids = new Set<string>();
  for (const client of clients) {
    const id = client.principalId;
    if (
      !isLiveClient(client) ||
      typeof id !== 'string' ||
      !id.trim() ||
      !Number.isInteger(client.connections) ||
      client.connections <= 0 ||
      !['owner', 'member', 'guest'].includes(client.hostRole ?? '') ||
      !parsePrincipalSnapshot(
        { server: { capabilities: {} } },
        { ...client, id, isAdministrator: client.hostRole === 'owner' },
      )
    )
      throw new Error('Invalid authenticated client roster');
    ids.add(id);
  }
  return [...ids];
}

function safeHostInvite(row: HostInviteRow): HostInvite {
  return {
    id: row.id,
    scope: row.scope,
    role: row.role,
    createdByPrincipalId: row.createdByPrincipalId,
    pinLogin: row.pinLogin,
    pinIdentity: row.pinIdentity,
    reusable: row.reusable,
    redemptionCount: row.redemptionCount,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    ...(row.pinGithubUserId === undefined ? {} : { pinGithubUserId: row.pinGithubUserId }),
  };
}

interface RecoveryStore {
  getState(): StoreState;
  dispatch(action: Action): unknown;
  subscribe(listener: () => void): () => void;
}

/** One session-owned adapter, installed by the shared bridge. It adds no event listener or lease. */
export function installCollaborationRecovery(
  scope: RendererRecoveryScope,
  store: RecoveryStore,
): () => void {
  type Entry = { identity: string; handle: RendererRecoveryHandle; clear(): void };
  const entries = new Map<string, Entry>();
  const denied = new Map<string, string>();
  let syncing = false;
  let disposed = false;
  const sync = () => {
    if (syncing || disposed) return;
    syncing = true;
    try {
      const state = store.getState();
      const authority = selectPrincipalActionContext.select(state);
      const desired = new Set<string>();
      function add<T>(identity: string, owner: RendererRecoveryOwner<T>) {
        desired.add(owner.key);
        const old = entries.get(owner.key);
        if (old?.identity === identity || denied.get(owner.key) === identity) return;
        if (old) {
          entries.delete(owner.key);
          handles.delete(owner.key);
          old.handle.dispose();
          old.clear();
        }
        const clear = () => {
          owner.retire(undefined);
        };
        const handle = scope.registerResource({
          ...owner,
          isCurrent: () =>
            !disposed && entries.get(owner.key)?.identity === identity && owner.isCurrent(),
          read: async (reader) => {
            await Promise.allSettled(
              [...(pending.get(owner.key) ?? [])].map((flight) => flight.work),
            );
            if (!reader.lifetime.isCurrent()) throw new Error('Collaboration read retired');
            return owner.read(reader);
          },
          retire: () => {
            denied.set(owner.key, identity);
            entries.delete(owner.key);
            handles.delete(owner.key);
            clear();
          },
        });
        entries.set(owner.key, { identity, handle, clear });
        handles.set(owner.key, handle);
      }
      const presenceContext = selectPresenceContext.select(state);
      if (presenceContext && state.presence.context === presenceContext) {
        const ids = selectPresenceWorkspaceIds.select(state);
        const shared = selectPresenceMembershipKeys.select(state);
        for (const workspaceId of ids) {
          const current = () =>
            selectPresenceContext.select(store.getState()) === presenceContext &&
            selectPresenceWorkspaceIds.select(store.getState()).includes(workspaceId);
          add(presenceContext, {
            key: collaborationKey('presence-roster', workspaceId),
            workspaceId,
            eventTypes: ['presence:changed'],
            isCurrent: current,
            read: async ({ request }) => {
              const roster = await request<PresenceRoster>('presence.snapshot', { workspaceId });
              if (!isPresenceRoster(roster) || roster.workspaceId !== workspaceId)
                throw new Error('Invalid presence snapshot');
              return roster;
            },
            apply: (roster) => {
              store.dispatch(presenceSnapshotReceived(roster));
            },
            invalidate: () => {},
            retire: () => {
              store.dispatch(presenceWorkspaceRemoved(workspaceId));
            },
          });
          if (shared.some((key) => key.slice(0, key.lastIndexOf(':')) === workspaceId))
            add(presenceContext, {
              key: collaborationKey('presence-members', workspaceId),
              workspaceId,
              eventTypes: ['workspace:updated'],
              isCurrent: current,
              read: async ({ request }) => {
                const startedProfileRevision = store.getState().presence.profileRevision;
                const { members } = await request<WorkspaceMembersListResult>(
                  'workspace.members.list',
                  { workspaceId },
                );
                return { members, startedProfileRevision };
              },
              apply: ({ members, startedProfileRevision }) => {
                store.dispatch(
                  presenceMembersReceived(workspaceId, members, startedProfileRevision),
                );
              },
              invalidate: () => {},
              retire: () => {
                store.dispatch(presenceMembersReceived(workspaceId, []));
              },
            });
        }
      }
      const share = state.workspaceShare;
      if (authority && share.open && share.workspaceId && selectShareCanManage.select(state)) {
        const workspaceId = share.workspaceId;
        const target = { workspaceId, session: share.session };
        const identity = JSON.stringify([authority, share.session]);
        add(identity, {
          key: collaborationKey('share-dialog', workspaceId),
          workspaceId,
          eventTypes: ['workspace:updated', 'host:members-changed', 'host:invites-changed'],
          isCurrent: () => {
            const s = store.getState();
            return (
              authority === selectPrincipalActionContext.select(s) &&
              selectShareCanManage.select(s) &&
              s.workspaceShare.workspaceId === workspaceId &&
              s.workspaceShare.session === target.session
            );
          },
          read: async ({ request }) => {
            const generation = store.getState().workspaceShare.mutationGeneration;
            const reads = [
              request<WorkspaceMembersList>('workspace.members.list', { workspaceId }),
              request<{ invites: WorkspaceInviteRow[] }>('workspace.invite.list', { workspaceId }),
              request<{ principals: HostPrincipal[] }>('principal.list', {}),
            ] as const;
            // Do not release a failed flight while a sibling RPC still runs.
            const results = await Promise.allSettled(reads);
            for (const result of results) if (result.status === 'rejected') throw result.reason;
            const [members, invites, principals] = await Promise.all(reads);
            return { ...members, ...invites, ...principals, generation };
          },
          apply: ({ members, invites, principals, generation, guestCount, guestLimit }) => {
            if (generation !== store.getState().workspaceShare.mutationGeneration) {
              rendererEventRecovery.invalidate(collaborationKey('share-dialog', workspaceId));
              return;
            }
            clearInviteLinks();
            const safe = vaultInviteLinks(invites);
            store.dispatch(
              shareDataLoaded({
                target,
                generation,
                members,
                invites: safe,
                guestCount: guestCount ?? null,
                guestLimit: guestLimit ?? null,
              }),
            );
            store.dispatch(sharePrincipalsLoaded({ target, principals }));
          },
          invalidate: () => {},
          retire: () => {
            clearInviteLinks();
            store.dispatch(shareAccessWithheld({ target }));
          },
        });
      }
      if (authority)
        for (const workspaceId of Object.keys(share.byWorkspaceId)) {
          if (!selectWorkspaceById.select(state, workspaceId)) continue;
          add(authority, {
            key: collaborationKey('share-roster', workspaceId),
            workspaceId,
            eventTypes: ['workspace:updated'],
            isCurrent: () =>
              authority === selectPrincipalActionContext.select(store.getState()) &&
              !!selectWorkspaceById.select(store.getState(), workspaceId),
            read: ({ request }) =>
              request<WorkspaceMembersList>('workspace.members.list', { workspaceId }),
            apply: ({ members }) => {
              store.dispatch(shareRosterLoaded({ workspaceId, members }));
            },
            invalidate: () => {},
            retire: () => {
              store.dispatch(shareRosterRetired({ workspaceId }));
            },
          });
        }
      const host = state.hostMembership;
      const target = host.target;
      if (
        target &&
        !host.withheld &&
        selectHostMembershipContext.select(state) === target.context
      ) {
        const identity = JSON.stringify([target.session, target.context]);
        add(identity, {
          key: 'host-membership',
          workspaceId: null,
          eventTypes: ['host:members-changed', 'host:invites-changed'],
          isCurrent: () => {
            const s = store.getState();
            return (
              s.hostMembership.target?.session === target.session &&
              !s.hostMembership.withheld &&
              selectHostMembershipContext.select(s) === target.context
            );
          },
          read: async ({ request }) => {
            const reads = [
              request<{ members: HostMember[]; revision: number }>('host.members.list', {}),
              request<{ invites: HostInviteRow[] }>('host.invite.list', {}),
            ] as const;
            const results = await Promise.allSettled(reads);
            for (const result of results) if (result.status === 'rejected') throw result.reason;
            const [roster, invites] = await Promise.all(reads);
            return { ...roster, ...invites };
          },
          apply: ({ members, revision, invites }) => {
            clearHostInviteLinks(target.session);
            for (const invite of invites)
              if (invite.url) retainHostInviteLink(target.session, invite.id, invite.url);
            store.dispatch(
              hostMembershipLoaded(target, members, invites.map(safeHostInvite), revision),
            );
          },
          invalidate: () => {},
          retire: () => {
            clearHostInviteLinks(target.session);
            store.dispatch(hostMembershipRecoveryCleared(target));
          },
        });
      }
      const presence = selectHostUserPresenceSession.select(state);
      if (presence)
        add(presence, {
          key: 'host-user-presence',
          workspaceId: null,
          eventTypes: ['client:connected', 'client:disconnected', 'client:updated'],
          isCurrent: () => selectHostUserPresenceSession.select(store.getState()) === presence,
          read: async ({ request }) =>
            onlineHostPrincipals((await request<{ clients: LiveClient[] }>('client.list')).clients),
          apply: (ids) => {
            store.dispatch(
              hostUserPresenceSettled(
                presence,
                store.getState().hostMembership.presence.epoch,
                ids,
              ),
            );
          },
          invalidate: () => {},
          retire: () => {
            store.dispatch(hostUserPresenceCleared(presence));
          },
        });
      for (const [key, row] of entries)
        if (!desired.has(key)) {
          entries.delete(key);
          handles.delete(key);
          row.handle.dispose();
          row.clear();
        }
      for (const key of denied.keys()) if (!desired.has(key)) denied.delete(key);
    } finally {
      syncing = false;
    }
  };
  const off = store.subscribe(sync);
  sync();
  return () => {
    disposed = true;
    off();
    for (const [key, row] of entries) {
      handles.delete(key);
      row.handle.dispose();
      row.clear();
    }
    entries.clear();
  };
}

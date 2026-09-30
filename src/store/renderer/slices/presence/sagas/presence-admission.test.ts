import type { PresenceRoster } from '$shared/types/presence';
import { MemberProvider } from '$lib/services/mentions/providers/member-provider';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { HostRole } from '$shared/types/principal';
import { store } from '../../../store';
import { connectionsListReceived } from '../../connections/connections-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '../../workspace-events/workspace-events-slice';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { replaceWorkspaceList } from '../../workspace/workspace-slice';
import { setLabsMultiplayerEnabled } from '../../user-preferences/user-preferences-slice';
import {
  hostMembershipChanged,
  principalContextChanged,
  principalReceived,
} from '../../principal/principal-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { selectWorkspacePresencePeople } from '../presence-selectors';
import { presenceRosterReceived } from '../presence-slice';
import { presenceSaga } from './presence-saga';

const wire = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: wire.request }));
vi.mock('$lib/electron-bridge', () => ({ invoke: wire.invoke }));
const member = (principalId: string, hostRole: HostRole) => ({
  principalId,
  hostRole,
  role: hostRole === 'owner' ? 'owner' : 'collaborator',
  login: 'same',
  displayName: null,
  avatarUrl: null,
  addedAt: '2026-09-01T00:00:00Z',
});
const accepted = () => [
  member('me', 'owner'),
  member('host', 'member'),
  member('away', 'member'),
  member('guest', 'guest'),
];
const roster = (workspaceId = 'ws') => ({
  workspaceId,
  members: accepted()
    .filter((p) => p.principalId !== 'away' && p.principalId !== 'guest')
    .map((p) => ({ ...p, focus: [], typing: [] })),
});
const settle = () => vi.advanceTimersByTimeAsync(0);
function admit(revision = 1, hostRole: HostRole = 'owner') {
  const context = selectPrincipalConnectionContext.select(store.state)!;
  if (store.state.principal.context !== context) store.dispatch(principalContextChanged(context));
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      { context, invalidation: p.invalidation, presentationVersion: p.presentationVersion },
      {
        principal: {
          id: hostRole === 'guest' ? 'viewer' : 'me',
          hostRole,
          hostMembershipRevision: revision,
          isAdministrator: hostRole === 'owner',
          login: null,
          displayName: null,
          avatarUrl: null,
        },
        capabilities: {
          hostMembership: true,
          collaborationIdentity: true,
          personalPairing: true,
          authenticatedDevices: true,
        },
      },
    ),
  );
}
describe('presence admission and avatar policy', () => {
  let dispose: () => void;
  let cancel: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    dispose = store.init();
    wire.invoke.mockReset().mockResolvedValue({ typingSource: 'own' });
    wire.request
      .mockReset()
      .mockImplementation(async (method: string, { workspaceId }: { workspaceId?: string }) => {
        if (method === 'principal.me') return { id: 'me' };
        if (method === 'presence.snapshot') return roster(workspaceId);
        if (method === 'workspace.members.list') return { members: accepted() };
        throw Error(method);
      });
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    store.dispatch(
      replaceWorkspaceList([
        {
          id: WorkspaceId('ws'),
          memberCount: 4,
          ownerPrincipalId: 'me',
          myRole: 'owner',
          canManage: true,
        } as Workspace,
      ]),
    );
    store.dispatch(openWorkspaceTab('ws'));
  });
  afterEach(() => {
    cancel?.();
    cancel = undefined;
    dispose();
    vi.useRealTimers();
  });
  function start(enabled = true, hostRole: HostRole = 'owner') {
    store.dispatch(setLabsMultiplayerEnabled(enabled));
    admit(1, hostRole);
    cancel = store.runSaga(presenceSaga);
  }
  it('does not load or report presence while Multiplayer is off', async () => {
    start(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(wire.request).not.toHaveBeenCalled();
    expect(wire.invoke).not.toHaveBeenCalled();
    expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
  });
  it('does not load under unknown admission even when enabled', async () => {
    store.dispatch(setLabsMultiplayerEnabled(true));
    cancel = store.runSaga(presenceSaga);
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    expect(wire.invoke).not.toHaveBeenCalled();
  });
  it('includes connected host members without focus and offline workspace guests, excluding offline host members', async () => {
    start();
    await settle();
    const people = selectWorkspacePresencePeople.select(store.state, 'ws');
    expect(people.map((p) => p.principalId)).toEqual(['host', 'guest']);
    expect(people.map((p) => [p.hostRole, p.online, p.viewing])).toEqual([
      ['member', true, false],
      ['guest', false, false],
    ]);
  });
  it('re-reads the effective roster after a same-count role change', async () => {
    start();
    await settle();
    store.dispatch(
      hostMembershipChanged({
        revision: 2,
        principalId: 'guest',
        hostRole: 'member',
        action: 'added',
      }),
    );
    expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
    wire.request.mockImplementation(async (method: string) =>
      method === 'workspace.members.list'
        ? {
            members: accepted().map((p) =>
              p.principalId === 'guest' ? member('guest', 'member') : p,
            ),
          }
        : method === 'principal.me'
          ? { id: 'me' }
          : roster(),
    );
    admit(2);
    await settle();
    expect(wire.request.mock.calls.filter(([m]) => m === 'workspace.members.list')).toHaveLength(2);
    expect(
      selectWorkspacePresencePeople.select(store.state, 'ws').map((p) => p.principalId),
    ).toEqual(['host']);
  });
  it.each(['held', 'failed'] as const)(
    'retains accepted avatars and MemberProvider mentions during a %s same-admission presence refresh',
    async (outcome) => {
      start();
      await settle();
      const provider = new MemberProvider();
      const context = { workspaceId: 'ws' };
      const previousMentions = await provider.search('', context);
      expect(previousMentions.map((p) => p.meta?.principalId)).toEqual(['host', 'away', 'guest']);
      let resolve!: (value: unknown) => void;
      wire.request.mockImplementationOnce(() =>
        outcome === 'failed'
          ? Promise.reject(new Error('membership temporarily unavailable'))
          : new Promise((done) => {
              resolve = done;
            }),
      );
      const update: PresenceRoster = roster();
      update.members[1] = {
        ...update.members[1],
        focus: [{ workspaceId: 'ws', agentId: 'agent' }],
        typing: [{ agentId: 'agent', source: 'remote', pulse: 1 }],
      };
      store.dispatch(presenceRosterReceived(update));
      await vi.advanceTimersByTimeAsync(300);
      expect(
        selectWorkspacePresencePeople.select(store.state, 'ws').map((p) => p.principalId),
      ).toEqual(['host', 'guest']);
      expect(await provider.search('', context)).toEqual(previousMentions);
      if (outcome === 'held') {
        resolve({ members: accepted() });
        await settle();
        expect(await provider.search('', context)).toEqual(previousMentions);
      }
      store.dispatch(setLabsMultiplayerEnabled(false));
      await settle();
      expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
      expect(await provider.search('', context)).toEqual([]);
    },
  );
  it('drops held membership and snapshot results after disabling without deleting workspaces', async () => {
    const pending: Array<() => void> = [];
    wire.request.mockImplementation((method: string) =>
      method === 'principal.me'
        ? Promise.resolve({ id: 'me' })
        : new Promise((resolve) =>
            pending.push(() =>
              resolve(method === 'workspace.members.list' ? { members: accepted() } : roster()),
            ),
          ),
    );
    start();
    await settle();
    store.dispatch(setLabsMultiplayerEnabled(false));
    await settle();
    pending.forEach((resolve) => resolve());
    await settle();
    expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
    expect(store.state.presence.members).toEqual({});
    expect(getItem(store.state.workspace.workspaces, WorkspaceId('ws'))?.id).toBe('ws');
  });
  it('withholds modern rows missing authoritative hostRole from both membership and presence', async () => {
    wire.request.mockImplementation(async (method: string) =>
      method === 'workspace.members.list'
        ? { members: accepted().map(({ hostRole: _hostRole, ...p }) => p) }
        : { ...roster(), members: roster().members.map(({ hostRole: _hostRole, ...p }) => p) },
    );
    start();
    await settle();
    expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
  });
  it('uses a validated newer online roster role over older membership presentation', async () => {
    wire.request.mockImplementation(async (method: string) =>
      method === 'workspace.members.list'
        ? {
            members: accepted().map((p) =>
              p.principalId === 'host' ? member('host', 'guest') : p,
            ),
          }
        : roster(),
    );
    start();
    await settle();
    const host = selectWorkspacePresencePeople
      .select(store.state, 'ws')
      .find((p) => p.principalId === 'host');
    expect(host).toMatchObject({ hostRole: 'member', online: true, viewing: false });
  });
  it('ignores same-handle collisions and retained guest rows for offline host members', async () => {
    wire.request.mockImplementation(async (method: string) =>
      method === 'workspace.members.list'
        ? { members: [...accepted(), member('away', 'guest'), member('guest-two', 'guest')] }
        : roster(),
    );
    start();
    await settle();
    expect(
      selectWorkspacePresencePeople.select(store.state, 'ws').map((p) => p.principalId),
    ).toEqual(['host', 'guest', 'guest-two']);
  });
  it('requires fresh admission after disconnect and does not expose old rows during reconnect', async () => {
    start();
    await settle();
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
    store.dispatch(connectionStatusChanged('connected'));
    store.dispatch(daemonEventsSubscribed());
    await settle();
    expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
    admit();
    await settle();
    expect(
      selectWorkspacePresencePeople.select(store.state, 'ws').map((p) => p.principalId),
    ).toEqual(['host', 'guest']);
  });
  it('re-enabling keeps surfaces hidden until authority is refreshed', async () => {
    start();
    await settle();
    store.dispatch(setLabsMultiplayerEnabled(false));
    await settle();
    wire.request.mockClear();
    store.dispatch(setLabsMultiplayerEnabled(true));
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
    admit();
    await settle();
    expect(
      selectWorkspacePresencePeople.select(store.state, 'ws').map((p) => p.principalId),
    ).toEqual(['host', 'guest']);
  });
  it('a guest consumes an injected workspace notification; daemon delivery remains a separate dependency', async () => {
    store.dispatch(
      replaceWorkspaceList([
        {
          id: WorkspaceId('ws'),
          memberCount: 5,
          ownerPrincipalId: 'me',
          myRole: 'collaborator',
          canManage: false,
        } as Workspace,
      ]),
    );
    wire.request.mockImplementation(async (method: string) =>
      method === 'workspace.members.list'
        ? { members: [...accepted(), member('viewer', 'guest')] }
        : roster(),
    );
    start(true, 'guest');
    await settle();
    expect(store.state.principal.snapshot?.principal.hostRole).toBe('guest');
    expect(
      selectWorkspacePresencePeople.select(store.state, 'ws').map((p) => p.principalId),
    ).toEqual(['me', 'host', 'guest']);
    wire.request.mockImplementation(async (method: string) =>
      method === 'workspace.members.list'
        ? {
            members: [
              ...accepted().map((p) => (p.principalId === 'guest' ? member('guest', 'member') : p)),
              member('viewer', 'guest'),
            ],
          }
        : roster(),
    );
    store.dispatch(presenceRosterReceived(roster()));
    await vi.advanceTimersByTimeAsync(300);
    expect(
      selectWorkspacePresencePeople.select(store.state, 'ws').map((p) => p.principalId),
    ).toEqual(['me', 'host']);
  });
  it('drops a debounced notification when the workspace is removed before rejoining', async () => {
    start();
    await settle();
    wire.request.mockClear();
    store.dispatch(presenceRosterReceived(roster()));
    store.dispatch(replaceWorkspaceList([]));
    await settle();
    await vi.advanceTimersByTimeAsync(300);
    expect(wire.request).not.toHaveBeenCalled();
    expect(selectWorkspacePresencePeople.select(store.state, 'ws')).toEqual([]);
  });
  it('serializes held notification reads and keeps one trailing refresh', async () => {
    start();
    await settle();
    let release!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    wire.request.mockClear().mockImplementationOnce(() => held);
    store.dispatch(presenceRosterReceived(roster()));
    await vi.advanceTimersByTimeAsync(300);
    expect(wire.request).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) store.dispatch(presenceRosterReceived(roster()));
    await vi.advanceTimersByTimeAsync(300);
    expect(wire.request).toHaveBeenCalledTimes(1);
    release({ members: accepted() });
    await settle();
    expect(wire.request).toHaveBeenCalledTimes(2);
  });
  it('rejects pushed presence for a removed workspace and does not revive it on rejoin', async () => {
    start();
    await settle();
    store.dispatch(replaceWorkspaceList([]));
    await settle();
    store.dispatch(presenceRosterReceived(roster()));
    expect(store.state.presence.rosters).toEqual({});
    expect(selectWorkspacePresencePeople.select(store.state, 'other-workspace')).toEqual([]);
  });

  it('coalesces workspace notifications without reading unrelated workspace guests', async () => {
    start();
    await settle();
    wire.request.mockClear();
    for (let i = 0; i < 5; i++) store.dispatch(presenceRosterReceived(roster()));
    store.dispatch(presenceRosterReceived(roster('hidden')));
    await vi.advanceTimersByTimeAsync(300);
    expect(wire.request.mock.calls.filter(([m]) => m === 'workspace.members.list')).toEqual([
      ['workspace.members.list', { workspaceId: 'ws' }],
    ]);
  });
});

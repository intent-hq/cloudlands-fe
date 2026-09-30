/**
 * @vitest-environment jsdom
 *
 * Real store, bridge, principal/identity/Devices/presence and subscription sagas.
 * Only transport and platform boundaries are controlled. Injected notifications
 * prove FE consumer composition, not that a daemon emitted or authorized them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { BackendNotification } from '$lib/client/live/backend-transport';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { HostRole } from '$shared/types/principal';
import type { PresenceRoster } from '$shared/types/presence';
import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  connectionStatusChanged,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { principalSaga } from '$store/renderer/slices/principal/sagas/principal-saga';
import { identitySaga } from '$store/renderer/slices/identity/sagas/identity-saga';
import { presenceSaga } from '$store/renderer/slices/presence/sagas/presence-saga';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import { selectWorkspacePresencePeople } from '$store/renderer/slices/presence/presence-selectors';
import { MemberProvider } from '$lib/services/mentions/providers/member-provider';
import { personalDevicesSaga } from './personal-devices-saga';
import { selectPersonalDevices } from './personal-devices-selectors';
import { personalDevicesRefreshRequested } from './personal-devices-slice';
import DevicesPresenceHarness from './__tests__/DevicesPresenceHarness.svelte';

const wire = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  invoke: vi.fn(),
  qr: vi.fn(),
  notifications: new Set<(notification: BackendNotification) => void>(),
  reconnects: new Set<() => void>(),
}));
vi.mock('$lib/client/live/backend-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/client/live/backend-transport')>()),
  backendRequest: wire.request,
  backendSubscribe: wire.subscribe,
  backendUnsubscribe: wire.unsubscribe,
  onBackendNotification: (handler: (notification: BackendNotification) => void) => {
    wire.notifications.add(handler);
    return () => wire.notifications.delete(handler);
  },
  onBackendReconnected: (handler: () => void) => {
    wire.reconnects.add(handler);
    return () => wire.reconnects.delete(handler);
  },
}));
vi.mock('qrcode', () => ({ default: { toDataURL: wire.qr } }));

const workspaceId = 'shared-workspace';
const identity = { provider: 'gitlab', host: 'gitlab.example.test', externalUserId: '7' } as const;
const principal = (hostRole: HostRole = 'member', id = 'self') => ({
  id,
  hostRole,
  hostMembershipRevision: 1,
  isAdministrator: hostRole === 'owner',
  login: 'original-profile',
  displayName: null,
  avatarUrl: null,
});
const member = (principalId: string, hostRole: HostRole): WorkspaceMember => ({
  principalId,
  hostRole,
  role: hostRole === 'owner' ? 'owner' : 'collaborator',
  login: 'same-handle',
  displayName: null,
  avatarUrl: null,
  addedAt: '2026-09-30T00:00:00Z',
});
const members = () => [
  member('self', 'member'),
  member('owner', 'owner'),
  member('host', 'member'),
  member('offline-host', 'member'),
  member('offline-host', 'guest'),
  member('offline-guest', 'guest'),
];
const roster = (id = workspaceId): PresenceRoster => ({
  workspaceId: id,
  members: members()
    .filter((p) => !p.principalId.startsWith('offline'))
    .map((p) => ({ ...p, focus: [{ workspaceId: id }], typing: [] })),
});
const device = (principalId: string, hostRole: HostRole) => ({
  principalId,
  hostRole,
  clientId: 'same-client',
  name: principalId + '-phone',
  login: null,
  displayName: null,
  avatarUrl: null,
  capabilities: {},
  connections: 1,
  transports: ['wss'],
  connectedAt: '2026-09-30T00:00:00Z',
});
const pairing = (role: HostRole) => ({
  version: 1,
  uri: 'intent://pair?v=1&host=192.0.2.8&port=5181&fp=AB&token=synthetic-integration',
  hosts: ['192.0.2.8'],
  port: 5181,
  fingerprint: 'AB',
  token: 'synthetic-integration',
  principal: principal(role),
});
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const people = () => selectWorkspacePresencePeople.select(store.state, workspaceId);
const personIds = () => people().map((p) => p.principalId);
const mentions = () => new MemberProvider().search('same', { workspaceId });
const calls = (method: string) => wire.request.mock.calls.filter(([name]) => name === method);
const avatar = (id: string) => document.querySelector(`[data-presence-person-button="${id}"]`);
const settle = async () => {
  await tick();
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
let stops: Array<() => void>;
let clipboard: ReturnType<typeof vi.fn>;
let principalReply: unknown;
let memberReply: unknown;
let snapshotReply: unknown;
let role: HostRole;
let firehose: string;
let subscriptionOrdinal: number;
let held: Map<string, Promise<unknown>>;

function emit(type: string, data: unknown, subscriptionId = firehose) {
  for (const notify of wire.notifications)
    notify({ method: 'events.event', params: { subscriptionId, event: { type, data } } });
}
function workspaces(present = true) {
  store.dispatch(
    replaceWorkspaceList(
      present
        ? [
            {
              id: WorkspaceId(workspaceId),
              title: 'Shared workspace',
              memberCount: 5,
              ownerPrincipalId: 'owner',
              myRole: 'collaborator',
              canManage: role !== 'guest',
            } as Workspace,
          ]
        : [],
    ),
  );
}
function connect(host = 'remote') {
  store.dispatch(
    connectionsListReceived({
      connections: [],
      activeId: host,
      windowBackendId: host,
    }),
  );
  store.dispatch(connectionStatusChanged('connected'));
}
async function start(enabled = true, hostRole: HostRole = 'member') {
  role = hostRole;
  principalReply = principal(role);
  store.dispatch(setLabsMultiplayerEnabled(enabled));
  connect();
  store.dispatch(
    systemStatusSuccess(
      {
        running: true,
        listenMode: 'wss',
        protocolVersion: '10.8', // protocol-version-ok: same identity seam as Devices D2 fixtures
        host: { os: 'linux', arch: 'x64', locality: 'remote' },
      },
      '2026-09-30T00:00:00Z',
      store.state.daemonHealth.connectionGeneration,
    ),
  );
  workspaces();
  store.dispatch(openWorkspaceTab(workspaceId));
  stops.push(store.runSaga(principalSaga));
  stops.push(store.runSaga(identitySaga));
  stops.push(store.runSaga(personalDevicesSaga));
  stops.push(store.runSaga(presenceSaga));
  stops.push(store.runSaga(daemonEventsSaga));
  render(DevicesPresenceHarness, { props: { workspaceId } });
  await waitFor(() => expect(store.state.principal.snapshot?.principal.id).toBe('self'));
}
async function loaded() {
  await waitFor(() => expect(personIds()).toEqual(['owner', 'host', 'offline-guest']));
  await waitFor(() =>
    expect(selectPersonalDevices.select(store.state)).toHaveLength(role === 'guest' ? 1 : 2),
  );
  expect(avatar('offline-host')).toBeNull();
  expect(avatar('offline-guest')).not.toBeNull();
}
async function openPairing() {
  await fireEvent.click(
    await screen.findByRole('button', { name: m.settings_personalDevices_pair_label() }),
  );
  await waitFor(() => expect(calls('pairing.getSelfInfo').length).toBeGreaterThan(0));
}

beforeEach(() => {
  store.init();
  stops = [];
  held = new Map();
  memberReply = { members: members() };
  snapshotReply = roster();
  subscriptionOrdinal = 0;
  firehose = '';
  clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  wire.qr.mockReset().mockResolvedValue('data:image/png;base64,c3ludGhldGlj');
  wire.notifications.clear();
  wire.reconnects.clear();
  wire.subscribe.mockReset().mockImplementation(async (params: { workspaceId?: string }) => {
    const subscriptionId = 'subscription-' + ++subscriptionOrdinal;
    if (!params.workspaceId) firehose = subscriptionId;
    return { subscriptionId };
  });
  wire.unsubscribe.mockReset().mockResolvedValue(undefined);
  wire.request.mockReset().mockImplementation(async (method: string) => {
    if (held.has(method)) return held.get(method);
    if (method === 'client.hello')
      return {
        server: {
          capabilities: {
            hostMembership: 1,
            collaborationIdentity: 1,
            personalPairing: 1,
            authenticatedDevices: 1,
          },
        },
      };
    if (method === 'principal.me') return principalReply;
    if (method === 'presence.snapshot') return snapshotReply;
    if (method === 'workspace.members.list') return memberReply;
    if (method === 'client.list')
      return { clients: [device('self', role), device('other', 'owner')] };
    if (method === 'pairing.getSelfInfo') return pairing(role);
    throw new Error('Unexpected integration RPC: ' + method);
  });
  wire.invoke.mockReset().mockImplementation(async (channel: string) => {
    if (channel === 'presence:report') return { typingSource: 'own-window' };
    throw new Error('Unexpected integration IPC: ' + channel);
  });
  window.electronAPI = {
    invoke: wire.invoke,
    on: vi.fn(),
    offById: vi.fn(),
  } as unknown as Window['electronAPI'];
});
afterEach(async () => {
  cleanup();
  for (const stop of stops.reverse()) stop();
  await settle();
  expect(wire.notifications.size).toBe(0);
  expect(wire.reconnects.size).toBe(0);
  store.dispose();
});

describe('Devices and workspace presence share one admission', () => {
  it('waits for the real event lease before reading principal, Devices or presence', async () => {
    const lease = deferred<{ subscriptionId: string }>();
    wire.subscribe.mockImplementationOnce(() => lease.promise);
    const boot = start();
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
    expect(wire.invoke).not.toHaveBeenCalled();
    expect(personIds()).toEqual([]);
    expect(selectPersonalDevices.select(store.state)).toEqual([]);
    firehose = 'delayed-firehose';
    lease.resolve({ subscriptionId: firehose });
    await boot;
    await loaded();
  });

  it.each(['owner', 'member', 'guest'] as const)(
    'invalidates both loaded %s consumers on routed rekey and readmits freshly',
    async (hostRole) => {
      await start(true, hostRole);
      await loaded();
      await openPairing();
      const oldCopy = await screen.findByRole('button', {
        name: m.settings_personalDevices_copy_label(),
      });
      await waitFor(() => expect((oldCopy as HTMLButtonElement).disabled).toBe(false));
      const refresh = deferred();
      held.set('principal.me', refresh.promise);
      const before = store.state.principal.invalidation;
      emit('principal:identity-changed', { principalId: 'self', identity });
      await waitFor(() => expect(store.state.principal.invalidation).toBe(before + 1));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(personIds()).toEqual([]);
      expect(selectPersonalDevices.select(store.state)).toEqual([]);
      expect(await mentions()).toEqual([]);
      await fireEvent.click(oldCopy);
      expect(clipboard).not.toHaveBeenCalled();
      expect(store.state.identity.currentIdentity).toEqual(identity);
      principalReply = { ...principal(role), login: 'fresh-profile', identity };
      held.delete('principal.me');
      refresh.resolve(principalReply);
      await loaded();
      await waitFor(() => expect(store.state.identity.currentLogin).toBe('fresh-profile'));
      expect(store.state.principal.snapshot?.principal.login).toBe('fresh-profile');
      expect(JSON.stringify(store.state)).not.toContain('synthetic-integration');
    },
  );

  it.each(['rekey', 'unlink'] as const)(
    'drops old list, member, snapshot and pairing replies during %s',
    async (change) => {
      const pending = new Map(
        ['client.list', 'workspace.members.list', 'presence.snapshot', 'pairing.getSelfInfo'].map(
          (method) => [method, deferred()],
        ),
      );
      for (const [method, read] of pending) held.set(method, read.promise);
      await start();
      await openPairing();
      for (const method of pending.keys())
        await waitFor(() => expect(calls(method).length).toBeGreaterThan(0));
      const admission = deferred();
      held.set('principal.me', admission.promise);
      emit('principal:identity-changed', {
        principalId: 'self',
        identity: change === 'rekey' ? identity : null,
      });
      await waitFor(() => expect(store.state.principal.snapshot).toBeNull());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      pending.get('client.list')!.resolve({ clients: [device('old-only', 'owner')] });
      pending.get('workspace.members.list')!.resolve({ members: [member('old-only', 'guest')] });
      pending.get('presence.snapshot')!.resolve({
        workspaceId,
        members: [{ ...member('old-only', 'guest'), focus: [], typing: [] }],
      });
      pending.get('pairing.getSelfInfo')!.resolve(pairing(role));
      await settle();
      expect(personIds()).toEqual([]);
      expect(selectPersonalDevices.select(store.state)).toEqual([]);
      expect(wire.qr).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();
      expect(store.state.identity.currentIdentity).toEqual(change === 'rekey' ? identity : null);
      held.clear();
      principalReply = {
        ...principal(role),
        login: 'fresh-profile',
        ...(change === 'rekey' ? { identity } : {}),
      };
      admission.resolve(principalReply);
      await loaded();
      expect(avatar('old-only')).toBeNull();
      await openPairing();
      await waitFor(() => expect(wire.qr).toHaveBeenCalledTimes(1));
    },
  );

  it('uses actual subscription-generation reconnect to cancel old reads and reject old-subscription events', async () => {
    await start();
    await loaded();
    const oldSubscription = firehose;
    const generation = store.state.workspaceEvents.subscriptionGeneration;
    const oldMembers = deferred();
    held.set('workspace.members.list', oldMembers.promise);
    emit('presence:changed', roster());
    const previous = calls('workspace.members.list').length;
    await waitFor(() => expect(calls('workspace.members.list').length).toBeGreaterThan(previous));
    const admission = deferred();
    held.set('principal.me', admission.promise);
    for (const reconnect of wire.reconnects) reconnect();
    await waitFor(() =>
      expect(store.state.workspaceEvents.subscriptionGeneration).toBe(generation + 1),
    );
    await waitFor(() => expect(personIds()).toEqual([]));
    const invalidation = store.state.principal.invalidation;
    emit('principal:identity-changed', { principalId: 'self', identity: null }, oldSubscription);
    await settle();
    expect(store.state.principal.invalidation).toBe(invalidation);
    expect(wire.unsubscribe).toHaveBeenCalledWith(oldSubscription, undefined);
    oldMembers.resolve({ members: [member('old-only', 'guest')] });
    held.clear();
    admission.resolve(principal(role));
    await loaded();
    expect(avatar('old-only')).toBeNull();
    expect(firehose).not.toBe(oldSubscription);
  });

  it('rejects a principal replacement within one admission and permits it only on a new backend context', async () => {
    await start();
    await loaded();
    principalReply = principal('guest', 'replacement');
    emit('principal:identity-changed', { principalId: 'self', identity: null });
    await waitFor(() => expect(store.state.principal.error).toBe('incompatible-response'));
    expect(personIds()).toEqual([]);
    expect(selectPersonalDevices.select(store.state)).toEqual([]);
    connect('different-host');
    await waitFor(() => expect(store.state.principal.snapshot?.principal.id).toBe('replacement'));
    expect(store.state.principal.snapshot?.principal.hostRole).toBe('guest');
  });

  it('clears both consumers on disconnect and cannot reuse a held principal read after reconnect', async () => {
    await start();
    await loaded();
    const stale = deferred();
    held.set('principal.me', stale.promise);
    emit('principal:identity-changed', { principalId: 'self', identity });
    await waitFor(() => expect(store.state.principal.snapshot).toBeNull());
    store.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    expect(personIds()).toEqual([]);
    expect(selectPersonalDevices.select(store.state)).toEqual([]);
    stale.resolve(principal('owner', 'old-connection-only'));
    held.clear();
    await settle();
    expect(store.state.principal.snapshot).toBeNull();
    connect();
    for (const reconnect of wire.reconnects) reconnect();
    await loaded();
    expect(store.state.principal.snapshot?.principal.id).toBe('self');
  });

  it('ignores malformed, unrelated and foreign-subscription identity events without granting authority', async () => {
    await start();
    await loaded();
    const before = store.state.principal;
    for (const data of [
      { principalId: 'other', identity },
      { principalId: '', identity: null },
      { principalId: 'self', identity: false },
      { principalId: 'self', identity: { ...identity, host: '' } },
      { principalId: 'self', identity: { ...identity, provider: 'unknown' } },
    ])
      emit('principal:identity-changed', data);
    emit('principal:identity-changed', { principalId: 'self', identity: null }, 'foreign');
    await settle();
    expect(store.state.principal).toBe(before);
    await loaded();
  });

  it.each(['focus', 'typing'] as const)(
    'retains actual mounted avatars and MemberProvider while a %s refresh is held or fails',
    async (pulse) => {
      await start();
      await loaded();
      const accepted = await mentions();
      expect(accepted.map((p) => p.id)).toContain('member-offline-guest');
      const read = deferred();
      held.set('workspace.members.list', read.promise);
      const before = calls('workspace.members.list').length;
      emit('presence:changed', {
        ...roster(),
        members: roster().members.map((p) => ({
          ...p,
          focus: [],
          typing:
            pulse === 'typing'
              ? [
                  {
                    source: 'other-window',
                    agentId: 'agent',
                    since: '2026-09-30T00:00:00Z',
                    pulse: 1,
                  },
                ]
              : [],
        })),
      });
      await waitFor(() => expect(calls('workspace.members.list').length).toBe(before + 1));
      expect(avatar('offline-guest')).not.toBeNull();
      expect(await mentions()).toEqual(accepted);
      held.delete('workspace.members.list');
      read.reject(new Error('Routine member refresh failed'));
      await settle();
      expect(personIds()).toEqual(['owner', 'host', 'offline-guest']);
      expect(avatar('offline-guest')).not.toBeNull();
      expect(await mentions()).toEqual(accepted);
    },
  );

  it('withholds modern avatar roles missing from both authoritative sources and rejects withheld principal authority', async () => {
    memberReply = { members: members().map((p) => ({ ...p, hostRole: undefined })) };
    snapshotReply = {
      ...roster(),
      members: roster().members.map((p) => ({ ...p, hostRole: undefined })),
    };
    await start();
    await waitFor(() => expect(calls('workspace.members.list')).toHaveLength(1));
    await settle();
    expect(personIds()).toEqual([]);
    expect(avatar('host')).toBeNull();
    principalReply = { ...principal(role), hostRole: undefined };
    emit('principal:identity-changed', { principalId: 'self', identity: null });
    await waitFor(() => expect(store.state.principal.error).toBe('incompatible-response'));
    expect(selectPersonalDevices.select(store.state)).toEqual([]);
    expect(await mentions()).toEqual([]);
    expect(
      screen.queryByRole('button', { name: m.settings_personalDevices_pair_label() }),
    ).toBeNull();
  });

  it('refreshes an offline promotion from an unchanged-roster guest notification without a global membership event', async () => {
    await start(true, 'guest');
    await loaded();
    const revision = store.state.principal.minimumRevision;
    memberReply = {
      members: members().map((p) =>
        p.principalId === 'offline-guest' ? member('offline-guest', 'member') : p,
      ),
    };
    emit('presence:changed', roster());
    await waitFor(() => expect(personIds()).toEqual(['owner', 'host']));
    expect(avatar('offline-guest')).toBeNull();
    expect(store.state.principal.minimumRevision).toBe(revision);
    expect(store.state.principal.snapshot?.principal.hostRole).toBe('guest');
    expect(
      calls('workspace.members.list').every(([, params]) => params.workspaceId === workspaceId),
    ).toBe(true);
  });

  it('drops foreign-workspace notifications and held removed-workspace replies before a same-ID rejoin', async () => {
    await start();
    await loaded();
    const old = deferred();
    held.set('workspace.members.list', old.promise);
    const before = calls('workspace.members.list').length;
    emit('presence:changed', roster('hidden-workspace'));
    emit('presence:changed', roster());
    await waitFor(() => expect(calls('workspace.members.list').length).toBe(before + 1));
    workspaces(false);
    await waitFor(() => expect(personIds()).toEqual([]));
    held.clear();
    old.resolve({ members: [member('removed-only', 'guest')] });
    await settle();
    expect(await mentions()).toEqual([]);
    workspaces();
    await loaded();
    expect(avatar('removed-only')).toBeNull();
    expect(
      calls('workspace.members.list').every(([, params]) => params.workspaceId === workspaceId),
    ).toBe(true);
  });

  it('does not load Devices or presence while off and retains saved access across disable/readmission', async () => {
    store.dispatch(
      guestSessionsListReceived({
        sessions: [
          {
            id: 'remote',
            label: 'Saved shared host',
            hostname: 'Shared host',
            host: '192.0.2.8',
            hosts: ['192.0.2.8'],
            port: 5181,
            fingerprint: 'AB',
            tcAddress: null,
            principalId: 'self',
            login: 'untrusted-saved-label',
            hostRole: 'member',
            tokenEncrypted: true,
            workspaces: [],
            updatedAt: 1,
          },
        ],
        openIds: ['remote'],
        connectedIds: ['remote'],
      }),
    );
    await start(false);
    await settle();
    for (const method of [
      'client.list',
      'pairing.getSelfInfo',
      'presence.snapshot',
      'workspace.members.list',
    ])
      expect(calls(method)).toEqual([]);
    expect(wire.invoke).not.toHaveBeenCalled();
    const saved = store.state.guestSessions;
    store.dispatch(setLabsMultiplayerEnabled(true));
    await loaded();
    const admission = deferred();
    held.set('principal.me', admission.promise);
    store.dispatch(setLabsMultiplayerEnabled(false));
    await waitFor(() => expect(personIds()).toEqual([]));
    expect(selectPersonalDevices.select(store.state)).toEqual([]);
    expect(store.state.guestSessions).toBe(saved);
    const reads = calls('presence.snapshot').length;
    emit('presence:changed', roster());
    store.dispatch(personalDevicesRefreshRequested());
    await settle();
    expect(calls('presence.snapshot')).toHaveLength(reads);
    store.dispatch(setLabsMultiplayerEnabled(true));
    await settle();
    expect(personIds()).toEqual([]);
    held.clear();
    admission.resolve(principal(role));
    await loaded();
    expect(store.state.guestSessions).toBe(saved);
  });
});

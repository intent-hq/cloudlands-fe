/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  connectionStatusChanged,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import {
  principalContextChanged,
  principalReceived,
  principalIdentityChanged,
  hostMembershipChanged,
} from '$store/renderer/slices/principal/principal-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';
import { refreshLiveClientsRequested } from '$store/renderer/slices/browser-clients/browser-clients-slice';
import type { HostRole } from '$shared/types/principal';
import { m } from '$shared/paraglide/messages.js';
import { personalDevicesSaga } from './personal-devices-saga';
import PersonalDevices from './PersonalDevices.svelte';
import { selectPersonalDevices } from './personal-devices-selectors';
import { principalSaga } from '$store/renderer/slices/principal/sagas/principal-saga';
import { identitySaga } from '$store/renderer/slices/identity/sagas/identity-saga';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import { websocketApiSaga } from '$store/renderer/slices/websocket-api/sagas/websocket-api-saga';
import { browserClientsSaga } from '$store/renderer/slices/browser-clients/sagas/browser-clients-saga';

const qr = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,c3ludGhldGlj'));
vi.mock('qrcode', () => ({ default: { toDataURL: qr } }));
const principal = (role: HostRole = 'member', id = 'person-b') => ({
  id,
  login: null,
  displayName: null,
  avatarUrl: null,
  isAdministrator: role === 'owner',
  hostRole: role,
  hostMembershipRevision: 1,
});
const uri = 'intent://pair?v=1&host=192.0.2.8&port=5181&fp=AB&token=synthetic-person-b';
const pairing = (role: HostRole = 'member', id = 'person-b') => ({
  version: 1,
  uri,
  hosts: ['192.0.2.8'],
  port: 5181,
  fingerprint: 'AB',
  token: 'synthetic-person-b',
  principal: principal(role, id),
});
const device = (id: string, person = 'person-b', role: HostRole = 'member') => ({
  clientId: id,
  name: id,
  principalId: person,
  hostRole: role,
  login: null,
  displayName: null,
  avatarUrl: null,
  capabilities: {},
  connections: 1,
  transports: ['wss'],
  connectedAt: '2026-09-30T12:00:00Z',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let stop: () => void;
let rpc = vi.fn();
let invoke = vi.fn();
let clipboard = vi.fn();
function admit(role: HostRole = 'member', id = 'person-b', host = 'remote-b') {
  store.dispatch(
    connectionsListReceived({
      connections: [
        {
          id: 'local',
          label: 'Local owner machine',
          host: null,
          port: null,
          fingerprint: null,
          isLocal: true,
          status: 'connected',
        },
        {
          id: host,
          label: 'Selected team host',
          host: '192.0.2.8',
          port: 5181,
          fingerprint: 'AB',
          isLocal: false,
          status: 'connected',
        },
      ],
      activeId: host,
      windowBackendId: host,
    }),
  );
  if (role !== 'owner')
    store.dispatch(
      guestSessionsListReceived({
        sessions: [
          {
            id: host,
            label: '192.0.2.8:5181',
            hostname: 'Invited team host',
            host: '192.0.2.8',
            hosts: ['192.0.2.8'],
            port: 5181,
            fingerprint: 'AB',
            tcAddress: null,
            principalId: id,
            login: 'untrusted-cached-login',
            hostRole: role,
            tokenEncrypted: true,
            workspaces: [],
            updatedAt: 1,
          },
        ],
        openIds: [host],
        connectedIds: [host],
      }),
    );
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed());
  const context = selectPrincipalConnectionContext.select(store.state)!;
  store.dispatch(principalContextChanged(context));
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      { context, invalidation: p.invalidation, presentationVersion: p.presentationVersion },
      {
        principal: principal(role, id),
        capabilities: {
          hostMembership: true,
          personalPairing: true,
          authenticatedDevices: true,
          collaborationIdentity: true,
        },
      },
    ),
  );
}
async function open() {
  await fireEvent.click(
    await screen.findByRole('button', { name: m.settings_personalDevices_pair_label() }),
  );
}
async function ready() {
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: m.settings_personalDevices_copy_label(),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
}
beforeEach(() => {
  qr.mockClear();
  clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  rpc = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'pairing.getSelfInfo') return pairing();
    if (method === 'client.list')
      return {
        clients: [device('phone'), device('tablet'), device('owner-laptop', 'person-a', 'owner')],
      };
    throw new Error(`Unexpected RPC ${method}`);
  });
  invoke = vi.fn(
    async (
      channel: string,
      params: { method: string; params?: unknown; localMachine?: boolean },
    ) => {
      if (channel !== 'backend:request') throw new Error(`Unexpected IPC ${channel}`);
      return { ok: true, result: await rpc(params.method) };
    },
  );
  window.electronAPI = {
    invoke,
    on: vi.fn(),
    offById: vi.fn(),
  } as unknown as Window['electronAPI'];
  store.init();
  store.dispatch(setLabsMultiplayerEnabled(true));
  stop = store.runSaga(personalDevicesSaga);
});
afterEach(() => {
  cleanup();
  stop();
  store.dispose();
});
describe('Devices current-person UI through the actual store and IPC transport', () => {
  it.each(['member', 'guest'] as const)(
    'ordinary Devices omits personal and local administrator RPCs for a remote %s',
    async (role) => {
      admit(role);
      const stopApi = store.runSaga(websocketApiSaga);
      try {
        render(DevicesSettings);
        await fireEvent.click(screen.getByRole('button', { name: m.settings_devices_add_label() }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(
          screen.queryByRole('region', { name: m.settings_personalDevices_title() }),
        ).toBeNull();
        expect(
          screen.queryByRole('button', { name: m.settings_personalDevices_pair_label() }),
        ).toBeNull();
        expect(rpc.mock.calls.map(([method]) => method)).not.toContain('client.list');
        expect(rpc.mock.calls.map(([method]) => method)).not.toContain('pairing.getSelfInfo');
        expect(invoke.mock.calls.filter(([, payload]) => payload?.localMachine)).toEqual([]);
        expect(rpc.mock.calls.map(([method]) => method)).not.toContain('settings.list');
      } finally {
        stopApi();
      }
    },
  );
  it('copies exactly the QR URI, reuses it on reopen, and never asks for local owner material', async () => {
    admit();
    render(PersonalDevices);
    await open();
    await ready();
    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_personalDevices_copy_label() }),
    );
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(uri));
    expect(qr.mock.calls[0][0]).toBe(uri);
    expect(JSON.stringify(store.state)).not.toContain('synthetic-person-b');
    await fireEvent.click(
      screen.getAllByRole('button', { name: m.settings_wsApi_close() }).at(-1)!,
    );
    await open();
    await ready();
    expect(rpc.mock.calls.filter(([method]) => method === 'pairing.getSelfInfo')).toHaveLength(1);
    expect(
      invoke.mock.calls.every(
        ([channel, payload]) =>
          channel === 'backend:request' && !payload.localMachine && payload.params === undefined,
      ),
    ).toBe(true);
    expect(rpc.mock.calls.map(([method]) => method)).not.toContain('server.pairingInfo');
  });
  it.each(['owner', 'member', 'guest'] as const)(
    'shows %s server access without a forge profile and respects roster privacy',
    async (role) => {
      admit(role);
      rpc.mockImplementation(async (method) =>
        method === 'client.list'
          ? {
              clients: [
                device('my-phone', 'person-b', role),
                device('other-phone', 'person-a', 'owner'),
              ],
            }
          : pairing(role),
      );
      render(PersonalDevices);
      await open();
      await ready();
      await screen.findByText('my-phone');
      if (role === 'guest') expect(screen.queryByText('other-phone')).toBeNull();
      else await screen.findByText('other-phone');
      expect(screen.getAllByText(/person-b/).length).toBeGreaterThan(0);
    },
  );
  it.each(['disable', 'host', 'person', 'disconnect', 'admission', 'revocation'] as const)(
    'clears the dialog and refuses a late pairing response after %s',
    async (change) => {
      const pending = deferred<unknown>();
      rpc.mockImplementation(async (method) =>
        method === 'pairing.getSelfInfo' ? pending.promise : { clients: [device('old-phone')] },
      );
      admit();
      render(PersonalDevices);
      await open();
      await waitFor(() =>
        expect(rpc.mock.calls.some(([m]) => m === 'pairing.getSelfInfo')).toBe(true),
      );
      if (change === 'disable') store.dispatch(setLabsMultiplayerEnabled(false));
      if (change === 'host') admit('member', 'person-c', 'remote-c');
      if (change === 'person') store.dispatch(principalIdentityChanged('person-b'));
      if (change === 'disconnect') store.dispatch(connectionStatusChanged('disconnected'));
      if (change === 'admission') store.dispatch(daemonEventsSubscribed());
      if (change === 'revocation')
        store.dispatch(
          hostMembershipChanged({
            principalId: 'person-b',
            revision: 2,
            action: 'removed',
            hostRole: 'guest',
          }),
        );
      pending.resolve(pairing());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(qr).not.toHaveBeenCalled();
      expect(clipboard).not.toHaveBeenCalled();
    },
  );
  it('default-off and missing authority issue no personal RPCs', async () => {
    store.dispatch(setLabsMultiplayerEnabled(false));
    admit();
    render(PersonalDevices);
    expect(
      screen.queryByRole('button', { name: m.settings_personalDevices_pair_label() }),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    store.dispatch(setLabsMultiplayerEnabled(true));
    expect(
      screen.queryByRole('button', { name: m.settings_personalDevices_pair_label() }),
    ).toBeNull();
  });
  it('retries a refused read without using an administrator fallback', async () => {
    let refused = true;
    rpc.mockImplementation(async (method) => {
      if (method === 'client.list') return { clients: [] };
      if (refused) throw new Error('revoked token must never be displayed');
      return pairing();
    });
    admit();
    render(PersonalDevices);
    await open();
    await screen.findByRole('alert');
    refused = false;
    await fireEvent.click(
      screen.getAllByRole('button', { name: m.settings_devices_retry_label() }).at(-1)!,
    );
    await ready();
    expect(rpc.mock.calls.filter(([method]) => method === 'pairing.getSelfInfo')).toHaveLength(2);
    expect(screen.queryByText(/revoked token/)).toBeNull();
  });
  it('clears loaded pairing and roster when Multiplayer is disabled, then fetches fresh material after readmission', async () => {
    admit();
    render(PersonalDevices);
    await open();
    await ready();
    await screen.findByText('phone');
    store.dispatch(setLabsMultiplayerEnabled(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('phone')).toBeNull();
    store.dispatch(setLabsMultiplayerEnabled(true));
    admit();
    await open();
    await ready();
    expect(rpc.mock.calls.filter(([method]) => method === 'pairing.getSelfInfo')).toHaveLength(2);
    expect(screen.queryByText('untrusted-cached-login')).toBeNull();
    expect(screen.getAllByText(/Invited team host/).length).toBeGreaterThan(0);
  });
  it('rejects a previous host roster arriving after a different host has loaded', async () => {
    const pending = deferred<unknown>();
    rpc.mockImplementationOnce(() => pending.promise);
    admit();
    render(PersonalDevices);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rpc.mockResolvedValue({ clients: [device('new-phone', 'person-c')] });
    admit('member', 'person-c', 'remote-c');
    await screen.findByText('new-phone');
    pending.resolve({ clients: [device('old-secret-device')] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('old-secret-device')).toBeNull();
  });
  it('store replacement cannot deliver old credentials into an identical new connection', async () => {
    const pending = deferred<unknown>();
    rpc.mockImplementation(async (method) =>
      method === 'pairing.getSelfInfo' ? pending.promise : { clients: [] },
    );
    admit();
    const view = render(PersonalDevices);
    await open();
    await waitFor(() =>
      expect(rpc.mock.calls.some(([method]) => method === 'pairing.getSelfInfo')).toBe(true),
    );
    view.unmount();
    stop();
    store.dispose();
    store.init();
    store.dispatch(setLabsMultiplayerEnabled(true));
    stop = store.runSaga(personalDevicesSaga);
    admit();
    render(PersonalDevices);
    pending.resolve(pairing());
    await Promise.resolve();
    expect(qr).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('missing preference keeps the personal surface closed despite admitted server capabilities', () => {
    stop();
    store.dispose();
    store.init();
    stop = store.runSaga(personalDevicesSaga);
    admit();
    render(PersonalDevices);
    expect(
      screen.queryByRole('button', { name: m.settings_personalDevices_pair_label() }),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('coalesces roster events and replaces rows after a disconnect', async () => {
    admit();
    render(PersonalDevices);
    await screen.findByText('phone');
    const pending = deferred<unknown>();
    rpc.mockImplementationOnce(() => pending.promise);
    store.dispatch(refreshLiveClientsRequested());
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    for (let i = 0; i < 5; i++) store.dispatch(refreshLiveClientsRequested());
    rpc.mockResolvedValue({ clients: [device('tablet')] });
    pending.resolve({ clients: [device('phone'), device('tablet')] });
    await waitFor(() => expect(screen.queryByText('phone')).toBeNull());
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it('does not promote a legacy device row without server identity into the authenticated roster', async () => {
    admit();
    rpc.mockResolvedValue({
      clients: [{ ...device('unverified-device'), principalId: undefined }],
    });
    render(PersonalDevices);
    await screen.findByRole('alert');
    expect(screen.queryByText('unverified-device')).toBeNull();
  });
  it('an earlier global browser-client read cannot overwrite the current personal roster', async () => {
    admit();
    const pending = deferred<unknown>();
    rpc.mockImplementationOnce(() => pending.promise);
    const stopBrowser = store.runSaga(browserClientsSaga);
    try {
      store.dispatch(refreshLiveClientsRequested());
      await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
      render(PersonalDevices);
      await screen.findByText('phone');
      pending.resolve({ clients: [device('stale-global-device')] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByText('stale-global-device')).toBeNull();
      expect(screen.getByText('phone')).toBeTruthy();
      store.dispatch(refreshLiveClientsRequested());
      await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    } finally {
      stopBrowser();
    }
  });
  it.each(['owner', 'member', 'guest'] as const)(
    'preserves tuple-distinct devices, grouped sockets, updates and removals for %s',
    async (role) => {
      admit(role);
      const own = { ...device('same', 'person-b', role), name: 'My phone', connections: 2 };
      const other = { ...device('same', 'person-a', 'owner'), name: 'Another phone' };
      rpc.mockResolvedValue({ clients: [own, other] });
      render(PersonalDevices);
      await screen.findByText('My phone');
      if (role === 'guest') expect(screen.queryByText('Another phone')).toBeNull();
      else await screen.findByText('Another phone');
      expect(
        selectPersonalDevices
          .select(store.state)
          .map(({ principalId, clientId, connections }) => [principalId, clientId, connections]),
      ).toEqual(
        role === 'guest'
          ? [['person-b', 'same', 2]]
          : [
              ['person-b', 'same', 2],
              ['person-a', 'same', 1],
            ],
      );
      rpc.mockResolvedValue({ clients: [{ ...other, name: 'Renamed other phone' }, own] });
      store.dispatch(refreshLiveClientsRequested());
      await waitFor(() =>
        expect(
          selectPersonalDevices.select(store.state).find((c) => c.principalId === 'person-a')?.name,
        ).toBe(role === 'guest' ? undefined : 'Renamed other phone'),
      );
      await screen.findByText('My phone');
      rpc.mockResolvedValue({ clients: [own] });
      store.dispatch(refreshLiveClientsRequested());
      await waitFor(() => expect(screen.queryByText('Renamed other phone')).toBeNull());
      expect(selectPersonalDevices.select(store.state)).toMatchObject([
        { principalId: 'person-b', clientId: 'same', connections: 2 },
      ]);
    },
  );

  it.each([
    ['rekey', false],
    ['unlink', false],
    ['rekey', true],
    ['unlink', true],
  ] as const)(
    'real %s notifications invalidate Devices with pairing held=%s and readmit freshly',
    async (change, held) => {
      const triple = {
        provider: 'gitlab' as const,
        host: 'gitlab.example.test',
        externalUserId: '7',
      };
      const revalidation = deferred<unknown>();
      const heldPairing = deferred<unknown>();
      let changing = false;
      let holdPairing = held;
      const fresh = {
        ...principal('owner'),
        login: change === 'rekey' ? 'new-person-label' : null,
        ...(change === 'rekey' ? { identity: triple } : {}),
      };
      rpc.mockImplementation(async (method) => {
        if (method === 'client.hello')
          return {
            server: {
              capabilities: {
                hostMembership: 1,
                personalPairing: 1,
                authenticatedDevices: 1,
                collaborationIdentity: 1,
              },
            },
          };
        if (method === 'principal.me')
          return changing
            ? revalidation.promise
            : { ...principal('owner'), login: 'old-person-label' };
        if (method === 'client.list') return { clients: [device('phone', 'person-b', 'owner')] };
        if (method === 'pairing.getSelfInfo')
          return holdPairing ? heldPairing.promise : { ...pairing('owner'), principal: fresh };
        throw new Error(`Unexpected RPC ${method}`);
      });
      admit('owner');
      store.dispatch(
        systemStatusSuccess(
          {
            running: true,
            listenMode: 'wss',
            protocolVersion: '10.8',
            host: { os: 'linux', arch: 'x64', locality: 'remote' },
          }, // protocol-version-ok: identity seam fixture
          '2026-09-30T12:00:00Z',
          store.state.daemonHealth.connectionGeneration,
        ),
      );
      const stopPrincipal = store.runSaga(principalSaga);
      const stopIdentity = store.runSaga(identitySaga);
      try {
        render(PersonalDevices);
        await screen.findByText(/old-person-label/);
        await open();
        if (!held) await ready();
        await waitFor(() =>
          expect(rpc.mock.calls.some(([method]) => method === 'pairing.getSelfInfo')).toBe(true),
        );
        const callsBefore = rpc.mock.calls.filter(([method]) => method === 'principal.me').length;
        changing = true;
        routeDaemonEventsNotification(
          'events.event',
          {
            subscriptionId: 'devices-firehose',
            event: {
              type: 'principal:identity-changed',
              data: { principalId: 'person-b', identity: change === 'rekey' ? triple : null },
            },
          },
          'devices-firehose',
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(store.state.principal.snapshot).toBeNull();
        expect(store.state.identity.currentIdentity).toEqual(change === 'rekey' ? triple : null);
        const qrCalls = qr.mock.calls.length;
        heldPairing.resolve(pairing('owner'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(qr).toHaveBeenCalledTimes(qrCalls);
        expect(clipboard).not.toHaveBeenCalled();
        expect(rpc.mock.calls.filter(([method]) => method === 'principal.me').length).toBe(
          callsBefore + 2,
        );
        revalidation.resolve(fresh);
        await waitFor(() =>
          expect(store.state.principal.snapshot?.principal.login).toBe(fresh.login),
        );
        await waitFor(() => expect(store.state.identity.currentLogin).toBe(fresh.login));
        expect(screen.queryByText(/old-person-label/)).toBeNull();
        holdPairing = false;
        await open();
        await ready();
        expect(rpc.mock.calls.filter(([method]) => method === 'pairing.getSelfInfo')).toHaveLength(
          2,
        );
      } finally {
        stopIdentity();
        stopPrincipal();
      }
    },
  );

  it('unrelated, malformed and foreign-subscription identity events cannot change admitted Devices authority', async () => {
    admit('owner');
    rpc.mockImplementation(async (method) => {
      if (method === 'client.hello')
        return {
          server: {
            capabilities: {
              hostMembership: 1,
              personalPairing: 1,
              authenticatedDevices: 1,
              collaborationIdentity: 1,
            },
          },
        };
      if (method === 'principal.me') return principal('owner');
      return method === 'client.list' ? { clients: [] } : pairing('owner');
    });
    const stopPrincipal = store.runSaga(principalSaga);
    try {
      render(PersonalDevices);
      await open();
      await ready();
      rpc.mockClear();
      const before = store.state.principal;
      const triple = { provider: 'gitlab', host: 'gitlab.example.test', externalUserId: '7' };
      for (const data of [
        { principalId: 'someone-else', identity: triple },
        { identity: null },
        { principalId: '', identity: null },
        { principalId: 7, identity: null },
        { principalId: 'person-b' },
        { principalId: 'person-b', identity: false },
        { principalId: 'person-b', identity: { ...triple, provider: 'unknown' } },
        { principalId: 'person-b', identity: { ...triple, host: '' } },
        { principalId: 'person-b', identity: { ...triple, externalUserId: '' } },
      ])
        routeDaemonEventsNotification(
          'events.event',
          {
            subscriptionId: 'devices-firehose',
            event: {
              type: 'principal:identity-changed',
              data,
            },
          },
          'devices-firehose',
        );
      routeDaemonEventsNotification(
        'events.event',
        {
          subscriptionId: 'foreign',
          event: {
            type: 'principal:identity-changed',
            data: { principalId: 'person-b', identity: null },
          },
        },
        'devices-firehose',
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.state.principal).toBe(before);
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(qr).toHaveBeenCalledTimes(1);
      expect(store.state.identity.currentIdentity).toEqual(triple);
      expect(rpc.mock.calls.map(([method]) => method)).not.toContain('principal.me');
    } finally {
      stopPrincipal();
    }
  });
});

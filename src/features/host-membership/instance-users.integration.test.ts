/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal, withHostPrincipal } from '../../test/fixtures/principal-state';
import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { hostUserPresenceSaga } from '$store/renderer/slices/host-membership/sagas/host-user-presence-saga';
import { hostMembershipSaga } from '$store/renderer/slices/host-membership/sagas/host-membership-saga';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import HostMembershipSettingsHost from './HostMembershipSettingsHost.svelte';
import type { LiveClient } from '$shared/types/browser-clients';

const wire = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: wire.request }));
const owner = {
  principalId: 'owner',
  hostRole: 'owner' as const,
  login: null,
  displayName: 'Owner',
  avatarUrl: null,
  addedAt: '2026-10-03T00:00:00Z',
};
const device = (clientId: string, principalId = 'owner'): LiveClient => ({
  clientId,
  principalId,
  hostRole: 'owner',
  login: null,
  displayName: null,
  avatarUrl: null,
  connections: 1,
  transports: ['wss'],
  capabilities: {},
  connectedAt: '2026-10-03T00:00:00Z',
});
let clients: LiveClient[];
let stop: () => void;
function admit() {
  admitLegacyPrincipal();
  const { principal } = withHostPrincipal(store.state);
  store.dispatch(
    principalReceived(
      {
        context: principal.context!,
        invalidation: principal.invalidation,
        presentationVersion: principal.presentationVersion,
      },
      principal.snapshot!,
    ),
  );
}
function event(type: string, subscriptionId = 'current') {
  routeDaemonEventsNotification(
    'events.event',
    { subscriptionId, event: { type, data: { clientId: 'device', capabilities: {} } } },
    'current',
  );
}
beforeEach(() => {
  clients = [device('desktop'), device('phone')];
  wire.request.mockReset().mockImplementation(async (method) => {
    if (method === 'host.members.list') return { members: [owner], revision: 1 };
    if (method === 'host.invite.list') return { invites: [] };
    if (method === 'client.list') return { clients };
    throw new Error(`Unexpected ${method}`);
  });
  store.init();
  store.dispatch(setLabsMultiplayerEnabled(true));
  admit();
  const stopMembership = store.runSaga(hostMembershipSaga);
  const stopPresence = store.runSaga(hostUserPresenceSaga);
  stop = () => {
    stopMembership();
    stopPresence();
  };
});
afterEach(() => {
  cleanup();
  stop();
  store.dispose();
});
it('reads authenticated instance clients without any workspace and keeps the owner online until the last device disconnects', async () => {
  render(HostMembershipSettingsHost);
  await waitFor(() => expect(wire.request).toHaveBeenCalledWith('client.list'));
  const list = await screen.findByRole('list', { name: 'Instance Users' });
  await waitFor(() => expect(within(list).getByText('Online')).toBeTruthy());
  clients = [device('phone')];
  event('client:disconnected');
  await waitFor(() =>
    expect(wire.request.mock.calls.filter(([method]) => method === 'client.list')).toHaveLength(2),
  );
  expect(within(list).getByText('Online')).toBeTruthy();
  clients = [];
  event('client:disconnected');
  await waitFor(() => expect(within(list).getByText('Offline')).toBeTruthy());
  clients = [device('new-phone')];
  event('client:connected');
  await waitFor(() => expect(within(list).getByText('Online')).toBeTruthy());
});
it('ignores events from a stale subscription and coalesces events while a read is in flight', async () => {
  let finish!: (value: { clients: LiveClient[] }) => void;
  wire.request.mockImplementation(async (method) => {
    if (method === 'host.members.list') return { members: [owner], revision: 1 };
    if (method === 'host.invite.list') return { invites: [] };
    if (method === 'client.list')
      return new Promise((resolve) => {
        finish = resolve;
      });
    throw new Error(`Unexpected ${method}`);
  });
  render(HostMembershipSettingsHost);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const count = () => wire.request.mock.calls.filter(([method]) => method === 'client.list').length;
  event('client:connected', 'old-subscription');
  expect(count()).toBe(1);
  event('client:connected');
  event('client:updated');
  event('client:disconnected');
  const stale = finish;
  stale({ clients: [] });
  await waitFor(() => expect(count()).toBe(2));
  expect(screen.queryByText('Offline', { exact: true })).toBeNull();
  finish({ clients: [device('live')] });
  await waitFor(() => expect(screen.getByText('Online', { exact: true })).toBeTruthy());
});
it('never turns a failed or malformed authenticated roster into observed offline and recovers quietly', async () => {
  render(HostMembershipSettingsHost);
  await waitFor(() => expect(screen.getByText('Online', { exact: true })).toBeTruthy());
  wire.request.mockImplementation(async () => {
    throw new Error('transport unavailable');
  });
  event('client:updated');
  await waitFor(() => expect(screen.getByText('Status unavailable', { exact: true })).toBeTruthy());
  expect(screen.queryByText('Offline', { exact: true })).toBeNull();
  wire.request.mockResolvedValue({ clients: [{ ...device('legacy'), principalId: undefined }] });
  event('client:updated');
  await waitFor(() => expect(store.state.hostMembership.presence.status).toBe('error'));
  expect(screen.queryByText('Offline', { exact: true })).toBeNull();
  wire.request.mockResolvedValue({ clients: [] });
  event('client:updated');
  await waitFor(() => expect(screen.getByText('Offline', { exact: true })).toBeTruthy());
});
it.each(['member', 'guest', 'capability'] as const)(
  'does not read a host client roster without owner admission: %s',
  async (kind) => {
    const snapshot = store.state.principal.snapshot!;
    store.dispatch(
      principalReceived(
        {
          context: store.state.principal.context!,
          invalidation: store.state.principal.invalidation,
          presentationVersion: store.state.principal.presentationVersion,
        },
        {
          ...snapshot,
          principal: {
            ...snapshot.principal,
            ...(kind === 'capability' ? {} : { hostRole: kind, isAdministrator: false }),
          },
          capabilities: { ...snapshot.capabilities, authenticatedDevices: kind !== 'capability' },
        },
      ),
    );
    render(HostMembershipSettingsHost);
    if (kind === 'capability') await screen.findByText('Status unavailable', { exact: true });
    else expect(screen.queryByTestId('host-membership-settings')).toBeNull();
    expect(wire.request.mock.calls.filter(([method]) => method === 'client.list')).toHaveLength(0);
  },
);
it('drops a pending read on reconnect and starts a fresh owner read after re-admission', async () => {
  const { backendReconnected } =
    await import('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice');
  let finish!: (value: { clients: LiveClient[] }) => void;
  wire.request.mockImplementation(async (method) => {
    if (method === 'host.members.list') return { members: [owner], revision: 1 };
    if (method === 'host.invite.list') return { invites: [] };
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  render(HostMembershipSettingsHost);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const stale = finish;
  store.dispatch(backendReconnected());
  await waitFor(() => expect(screen.queryByTestId('host-membership-settings')).toBeNull());
  admit();
  await waitFor(() => expect(finish).not.toBe(stale));
  stale({ clients: [device('old')] });
  expect(screen.queryByText('Online', { exact: true })).toBeNull();
  finish({ clients: [] });
  await waitFor(() => expect(screen.getByText('Offline', { exact: true })).toBeTruthy());
});
it.each(['role', 'backend', 'capability'] as const)(
  'cancels a stale host-wide read when %s changes',
  async (change) => {
    let finish!: (value: { clients: LiveClient[] }) => void;
    wire.request.mockImplementation(async (method) => {
      if (method === 'host.members.list') return { members: [owner], revision: 1 };
      if (method === 'host.invite.list') return { invites: [] };
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(HostMembershipSettingsHost);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const stale = finish;
    if (change === 'backend') {
      const { connectionsListReceived } =
        await import('$store/renderer/slices/connections/connections-slice');
      const { getItems } = await import('@themislib/themis/utils/collections/collection-utils');
      store.dispatch(
        connectionsListReceived({
          connections: getItems(store.state.connections.connections),
          activeId: 'other',
          windowBackendId: 'other',
        }),
      );
      await waitFor(() => expect(screen.queryByTestId('host-membership-settings')).toBeNull());
    } else {
      const snapshot = store.state.principal.snapshot!;
      store.dispatch(
        principalReceived(
          {
            context: store.state.principal.context!,
            invalidation: store.state.principal.invalidation,
            presentationVersion: store.state.principal.presentationVersion,
          },
          {
            ...snapshot,
            principal: {
              ...snapshot.principal,
              ...(change === 'role' ? { hostRole: 'member', isAdministrator: false } : {}),
            },
            capabilities: {
              ...snapshot.capabilities,
              authenticatedDevices: change !== 'capability',
            },
          },
        ),
      );
    }
    stale({ clients: [device('old')] });
    await waitFor(() => expect(store.state.hostMembership.presence.session).toBeNull());
    expect(screen.queryByText('Online', { exact: true })).toBeNull();
    expect(screen.queryByText('Offline', { exact: true })).toBeNull();
    if (change === 'backend') {
      admit();
      await waitFor(() => expect(finish).not.toBe(stale));
      finish({ clients: [] });
      await waitFor(() => expect(screen.getByText('Offline', { exact: true })).toBeTruthy());
    }
  },
);

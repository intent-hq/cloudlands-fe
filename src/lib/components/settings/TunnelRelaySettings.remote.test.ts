/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { websocketApiSaga } from '$store/renderer/slices/websocket-api/sagas/websocket-api-saga';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { admitLegacyPrincipal, withHostPrincipal } from '../../../test/fixtures/principal-state';
import { m } from '$shared/paraglide/messages.js';
import TunnelRelaySettings from './TunnelRelaySettings.svelte';

const mocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.error, success: mocks.success },
}));

let stop: () => void;
let relayUrl: string | null;
let listFails: boolean;
let invoke: ReturnType<typeof vi.fn>;

function connect(role: 'owner' | 'member', activeId = 'remote-a') {
  store.dispatch(
    connectionsListReceived({
      connections: [
        {
          id: 'local',
          label: 'Local',
          host: null,
          port: null,
          fingerprint: null,
          isLocal: true,
          status: 'connected',
        },
        {
          id: 'remote-a',
          label: 'Studio',
          host: '192.0.2.8',
          port: 5190,
          fingerprint: 'AB',
          isLocal: false,
          status: 'connected',
        },
      ],
      activeId,
      windowBackendId: activeId,
    }),
  );
  admitLegacyPrincipal();
  const state = withHostPrincipal(store.state, role).principal;
  store.dispatch(principalContextChanged(state.context));
  store.dispatch(
    principalReceived(
      {
        context: state.context!,
        invalidation: store.state.principal.invalidation,
        presentationVersion: store.state.principal.presentationVersion,
      },
      state.snapshot!,
    ),
  );
}

function relayCalls() {
  return invoke.mock.calls.filter(([, payload]) => payload?.method?.startsWith('settings.'));
}

beforeEach(() => {
  vi.clearAllMocks();
  relayUrl = null;
  listFails = false;
  invoke = vi.fn(
    async (
      channel: string,
      payload?: {
        method: string;
        params?: { changes: { path: string; value: string }[] };
        localMachine?: boolean;
      },
    ) => {
      if (channel !== 'backend:request') throw new Error(`Unexpected channel ${channel}`);
      if (payload?.method === 'settings.list') {
        if (listFails) throw new Error('settings.list exploded');
        return {
          ok: true,
          result: {
            revision: 1,
            settings:
              relayUrl === null
                ? []
                : [
                    {
                      path: 'server.tunnel.derpUrl',
                      value: relayUrl,
                      label: 'Relay',
                      description: '',
                      category: 'server',
                      type: 'string',
                      defaultValue: '',
                      origin: 'file',
                    },
                  ],
          },
        };
      }
      if (payload?.method === 'settings.update') {
        const change = payload.params!.changes[0];
        if (change.value.includes('dead')) throw new Error('no relay answered');
        relayUrl = change.value;
        return { ok: true, result: { revision: 2, applied: [{ ...change, origin: 'file' }] } };
      }
      throw new Error(`Unexpected method ${payload?.method}`);
    },
  );
  window.electronAPI = { ...window.electronAPI, invoke } as Window['electronAPI'];
  store.init();
  stop = store.runSaga(websocketApiSaga);
});

afterEach(() => {
  cleanup();
  stop();
  store.dispose();
});

async function relayInput() {
  render(TunnelRelaySettings);
  const input = (await screen.findByRole('textbox', {
    name: m.settings_tunnel_relay_label(),
  })) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}

it('edits the relay of the connected backend, not the local daemon', async () => {
  connect('owner');
  relayUrl = 'https://old.example.com/derpmap.json';
  const input = await relayInput();
  expect(input.value).toBe('https://old.example.com/derpmap.json');
  await fireEvent.input(input, { target: { value: 'https://relay.example.com/derpmap.json' } });
  await fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(relayUrl).toBe('https://relay.example.com/derpmap.json'));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith(m.settings_tunnel_relay_saved()));
  expect(relayCalls().filter(([, payload]) => payload.method === 'settings.update')).toEqual([
    [
      'backend:request',
      {
        method: 'settings.update',
        params: {
          changes: [
            { path: 'server.tunnel.derpUrl', value: 'https://relay.example.com/derpmap.json' },
          ],
        },
      },
    ],
  ]);
  expect(invoke.mock.calls.some(([, payload]) => payload?.localMachine)).toBe(false);
});

it('keeps the draft and says why when the remote backend refuses the relay', async () => {
  connect('owner');
  relayUrl = '';
  const input = await relayInput();
  await fireEvent.input(input, { target: { value: 'https://dead.example.com/derpmap.json' } });
  await fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('no relay answered')),
  );
  expect(input.value).toBe('https://dead.example.com/derpmap.json');
});

it('shows no relay on a remote backend without the setting', async () => {
  connect('owner');
  render(TunnelRelaySettings);
  await waitFor(() => expect(relayCalls()).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByRole('textbox', { name: m.settings_tunnel_relay_label() })).toBeNull();
  expect(mocks.error).not.toHaveBeenCalled();
});

it('neither reads nor shows the relay for a caller who does not own the backend', async () => {
  connect('member');
  relayUrl = 'https://relay.example.com/derpmap.json';
  render(TunnelRelaySettings);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('textbox', { name: m.settings_tunnel_relay_label() })).toBeNull();
  expect(relayCalls()).toEqual([]);
});

it('neither reads nor shows this machine’s relay for a caller denied host administration', async () => {
  connect('member', 'local');
  relayUrl = 'https://relay.example.com/derpmap.json';
  render(TunnelRelaySettings);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('textbox', { name: m.settings_tunnel_relay_label() })).toBeNull();
  expect(relayCalls()).toEqual([]);
});

it('hides the section without a toast when the relay cannot be read', async () => {
  connect('owner');
  listFails = true;
  render(TunnelRelaySettings);
  await waitFor(() => expect(relayCalls()).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('textbox', { name: m.settings_tunnel_relay_label() })).toBeNull();
  expect(mocks.error).not.toHaveBeenCalled();
});

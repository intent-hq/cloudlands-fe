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
import { admitLegacyPrincipal, withHostPrincipal } from '../../test/fixtures/principal-state';
import { m } from '$shared/paraglide/messages.js';
import { tick } from 'svelte';
import MobileSettings from './MobileSettings.svelte';

const mocks = vi.hoisted(() => ({
  qr: vi.fn(),
  error: vi.fn(),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.qr } }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.error, success: vi.fn() },
}));

const principal = {
  id: 'owner-b',
  login: null,
  displayName: 'Remote owner',
  avatarUrl: null,
  isAdministrator: true,
  hostRole: 'owner' as const,
  hostMembershipRevision: 1,
};
const remoteUri =
  'intent://pair?v=1&host=192.0.2.8&port=5190&fp=AB&token=synthetic-remote&tc=remote-route';
const response = {
  version: 1,
  uri: remoteUri,
  hosts: ['192.0.2.8'],
  port: 5190,
  fingerprint: 'AB',
  token: 'synthetic-remote',
  tcAddress: 'remote-route',
  principal,
};

let stop: () => void;
let enabled: boolean;
let pairing: ReturnType<typeof vi.fn>;
let invoke: ReturnType<typeof vi.fn>;
let clipboard: ReturnType<typeof vi.fn>;

function connect(id: string) {
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
        {
          id: 'remote-b',
          label: 'Server',
          host: '192.0.2.9',
          port: 5190,
          fingerprint: 'CD',
          isLocal: false,
          status: 'connected',
        },
      ],
      activeId: id,
      windowBackendId: id,
    }),
  );
  admitLegacyPrincipal();
  const state = withHostPrincipal(store.state).principal;
  store.dispatch(principalContextChanged(state.context));
  store.dispatch(
    principalReceived(
      {
        context: state.context!,
        invalidation: store.state.principal.invalidation,
        presentationVersion: store.state.principal.presentationVersion,
      },
      { ...state.snapshot!, principal },
    ),
  );
}

function copyButton() {
  return screen.getByRole('button', {
    name: m.settings_wsApi_shareLink_label(),
  }) as HTMLButtonElement;
}
function qrButton() {
  return screen.getByRole('button', { name: m.settings_wsApi_showQrCode() }) as HTMLButtonElement;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

beforeEach(() => {
  vi.clearAllMocks();
  enabled = true;
  pairing = vi.fn(async () => response);
  clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  mocks.qr.mockResolvedValue('data:image/png;base64,c3ludGhldGlj');
  invoke = vi.fn(
    async (
      channel: string,
      payload?: {
        method: string;
        params?: { changes: { path: string; value: boolean }[] };
        localMachine?: boolean;
      },
    ) => {
      if (channel !== 'backend:request') throw new Error(`Unexpected channel ${channel}`);
      if (payload?.method === 'settings.list')
        return {
          ok: true,
          result: {
            revision: 1,
            settings: [
              {
                path: 'server.wsApi.enabled',
                value: enabled,
                label: 'Remote connections',
                description: '',
                category: 'server',
                type: 'boolean',
                defaultValue: false,
                origin: 'file',
              },
            ],
          },
        };
      if (payload?.method === 'pairing.getSelfInfo') return { ok: true, result: await pairing() };
      if (payload?.method === 'settings.update') {
        enabled = payload.params!.changes[0].value;
        return {
          ok: true,
          result: {
            revision: 2,
            applied: [{ path: 'server.wsApi.enabled', value: enabled, origin: 'file' }],
          },
        };
      }
      throw new Error(`Unexpected method ${payload?.method}`);
    },
  );
  window.electronAPI = { ...window.electronAPI, invoke } as Window['electronAPI'];
  store.init();
  stop = store.runSaga(websocketApiSaga);
  connect('remote-a');
});

afterEach(() => {
  cleanup();
  stop();
  store.dispose();
});

it('copies and encodes the connected device’s exact pairing URI without reading the local daemon', async () => {
  render(MobileSettings);
  await waitFor(() => expect(copyButton().disabled).toBe(false));
  expect(invoke.mock.calls).toEqual([
    ['backend:request', { method: 'settings.list', params: undefined }],
    ['backend:request', { method: 'pairing.getSelfInfo', params: undefined }],
  ]);
  await fireEvent.click(copyButton());
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(remoteUri));
  await fireEvent.click(qrButton());
  await screen.findByRole('dialog');
  expect(mocks.qr).toHaveBeenCalledWith(remoteUri, expect.anything());
  expect(JSON.stringify(store.state.settingsEvents)).not.toContain('synthetic-remote');
});

it('disables mobile actions when the connected device has remote access off', async () => {
  enabled = false;
  render(MobileSettings);
  await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  expect(copyButton().disabled).toBe(true);
  expect(qrButton().disabled).toBe(true);
  await fireEvent.click(copyButton());
  await fireEvent.click(qrButton());
  expect(pairing).not.toHaveBeenCalled();
  expect(clipboard).not.toHaveBeenCalled();
  expect(mocks.qr).not.toHaveBeenCalled();
});

it('enables and disables remote access on the connected machine and refreshes its pairing details', async () => {
  enabled = false;
  render(MobileSettings);
  const toggle = screen.getByRole('switch', {
    name: m.settings_wsApi_enable_label(),
  }) as HTMLButtonElement;
  await waitFor(() => expect(toggle.disabled).toBe(false));
  expect(copyButton().disabled).toBe(true);
  await fireEvent.click(toggle);
  await waitFor(() => expect(copyButton().disabled).toBe(false));
  expect(invoke).toHaveBeenCalledWith('backend:request', {
    method: 'settings.update',
    params: { changes: [{ path: 'server.wsApi.enabled', value: true }] },
  });
  await fireEvent.click(copyButton());
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(remoteUri));
  await fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  expect(invoke).toHaveBeenCalledWith('backend:request', {
    method: 'settings.update',
    params: { changes: [{ path: 'server.wsApi.enabled', value: false }] },
  });
  expect(copyButton().disabled).toBe(true);
  expect(qrButton().disabled).toBe(true);
  expect(invoke.mock.calls.every(([, payload]) => !payload.localMachine)).toBe(true);
});

it('keeps pairing disabled when the connected machine rolls back enabling remote access', async () => {
  enabled = false;
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (channel, payload) =>
    payload?.method === 'settings.update'
      ? {
          ok: true,
          result: {
            revision: 2,
            applied: [{ path: 'server.wsApi.enabled', value: false, origin: 'file' }],
          },
        }
      : original(channel, payload),
  );
  render(MobileSettings);
  const toggle = screen.getByRole('switch', {
    name: m.settings_wsApi_enable_label(),
  }) as HTMLButtonElement;
  await waitFor(() => expect(toggle.disabled).toBe(false));
  await fireEvent.click(toggle);
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  expect(copyButton().disabled).toBe(true);
  expect(pairing).not.toHaveBeenCalled();
});

it.each(['member', 'guest'] as const)(
  'does not expose owner remote-access controls to a %s',
  async (role) => {
    const state = store.state.principal;
    store.dispatch(
      principalReceived(
        {
          context: state.context!,
          invalidation: state.invalidation,
          presentationVersion: state.presentationVersion,
        },
        {
          ...state.snapshot!,
          principal: {
            ...principal,
            hostRole: role,
            isAdministrator: false,
            hostMembershipRevision: 2,
          },
        },
      ),
    );
    render(MobileSettings);
    await tick();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  },
);

it('discards a delayed pairing response after switching devices and closes the QR on a switch to local', async () => {
  const pending = deferred<typeof response>();
  const nextUri = remoteUri
    .replace('192.0.2.8', '192.0.2.9')
    .replace('synthetic-remote', 'synthetic-next');
  pairing
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue({
      ...response,
      uri: nextUri,
      hosts: ['192.0.2.9'],
      token: 'synthetic-next',
    });
  render(MobileSettings);
  await waitFor(() => expect(pairing).toHaveBeenCalledOnce());
  connect('remote-b');
  await waitFor(() => expect(copyButton().disabled).toBe(false));
  pending.resolve(response);
  await pending.promise;
  await fireEvent.click(copyButton());
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(nextUri));
  await fireEvent.click(qrButton());
  await screen.findByRole('dialog');
  enabled = false;
  connect('local');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(copyButton().disabled).toBe(true);
  expect(clipboard).not.toHaveBeenCalledWith(remoteUri);
});

it('ignores QR generation that finishes after the device changes', async () => {
  const pending = deferred<string>();
  mocks.qr.mockReturnValueOnce(pending.promise);
  render(MobileSettings);
  await waitFor(() => expect(qrButton().disabled).toBe(false));
  await fireEvent.click(qrButton());
  await waitFor(() => expect(mocks.qr).toHaveBeenCalledOnce());
  enabled = false;
  connect('remote-b');
  await waitFor(() => expect(copyButton().disabled).toBe(true));
  pending.resolve('data:image/png;base64,b2xk');
  await pending.promise;
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps pairing unavailable after an error and retries without exposing credentials or falling back locally', async () => {
  pairing.mockRejectedValueOnce(new Error('secret-response-token'));
  render(MobileSettings);
  const retry = await screen.findByRole('button', { name: m.settings_devices_retry_label() });
  expect(copyButton().disabled).toBe(true);
  expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('secret-response-token');
  await fireEvent.click(retry);
  await waitFor(() => expect(copyButton().disabled).toBe(false));
  await fireEvent.click(copyButton());
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(remoteUri));
  expect(invoke.mock.calls.every(([, payload]) => !payload.localMachine)).toBe(true);
});

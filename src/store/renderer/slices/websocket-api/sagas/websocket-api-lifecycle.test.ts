/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { settingsHydrationSaga } from '../../settings-events/sagas/settings-hydration-saga';
import { connectionsSaga } from '../../connections/sagas/connections-saga';
import {
  settingsFormOpened,
  settingsFormClosed,
} from '../../settings-events/settings-events-slice';
import {
  selectSettingsForm,
  selectSettingsFormOperation,
} from '../../settings-events/settings-events-selectors';
import { websocketApiRequested } from '../websocket-api-slice';
import type { WebSocketApiIntent } from '../websocket-api-types';
import type { AppSettingChange } from '$lib/client/app-client';
import {
  registerWebsocketCredentials,
  readWebsocketToken,
} from '$features/settings/websocket-api-credentials';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import WebSocketApiSettings from '$lib/components/settings/WebSocketApiSettings.svelte';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  backend: vi.fn(),
  ipc: vi.fn(),
  clipboard: vi.fn(),
  qr: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backend,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  BackendError: class extends Error {},
}));
vi.mock('$features/settings/settings-hydration-service', () => ({ applySettingsChanges: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: mocks.notify, error: mocks.notify },
}));
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.qr } }));

const identity = { formId: 'api-lifecycle', sessionId: 'first' };
const request = (requestId: string, resource = 'save') => ({ ...identity, requestId, resource });
const pairing = {
  token: 'synthetic-lifecycle-token',
  port: 5181,
  path: '/ws',
  certFingerprint: 'AA:BB',
  localIps: ['192.0.2.10'],
  availableIps: ['192.0.2.10'],
  hostname: 'fixture',
};
const selfState = { published: true, suppressed: false, selfConnectionId: 'self' };
let settings: Record<string, boolean | number | string[]>;
let stopSettings: () => void;
let stopConnections: () => void;

beforeEach(() => {
  vi.resetAllMocks();
  settings = {
    'server.wsApi.enabled': true,
    'server.wsApi.port': 5181,
    'server.bindAddress': ['0.0.0.0'],
    'server.tunnel.enabled': true,
    'server.tunnel.only': false,
  };
  mocks.backend.mockImplementation(
    async (method: string, params?: { changes: AppSettingChange[] }) => {
      if (method === 'settings.list')
        return {
          revision: 0,
          settings: Object.entries(settings).map(([path, value]) => ({
            path,
            value,
            label: path,
            description: '',
            category: 'server',
            type: typeof value === 'object' ? 'string' : typeof value,
            defaultValue: value,
            origin: 'default',
          })),
        };
      if (method === 'server.pairingInfo')
        return { ...pairing, port: settings['server.wsApi.port'] };
      if (method === 'server.rotateToken') return { token: 'synthetic-rotated-token' };
      if (method === 'settings.update') return { revision: 1, applied: params?.changes };
      throw new Error('Unexpected wire method');
    },
  );
  mocks.ipc.mockImplementation(async (channel: string) => {
    if (channel === 'connections:list')
      return { connections: [], activeId: 'local', windowBackendId: 'local' };
    if (channel === 'connections:sync-get-state')
      return { supported: true, enabled: true, status: null };
    if (channel === 'connections:self-published-state') return selfState;
    if (channel === 'connections:refresh-self') return { refreshed: true };
    if (channel === 'connections:publish-self')
      return {
        connection: {
          id: 'self',
          label: 'Fixture machine',
          host: '192.0.2.10',
          port: 5181,
          fingerprint: 'AA:BB',
          isLocal: false,
        },
      };
    if (channel === 'connections:unpublish-self') return { removed: true };
    throw new Error('Unexpected publication channel');
  });
  mocks.clipboard.mockResolvedValue(undefined);
  mocks.qr.mockResolvedValue('data:image/png;base64,c3ludGhldGlj');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.clipboard },
  });
  window.electronAPI = { invoke: mocks.ipc } as typeof window.electronAPI;
  store.init();
  stopConnections = store.runSaga(connectionsSaga);
  stopSettings = store.runSaga(settingsHydrationSaga);
});

afterEach(() => {
  cleanup();
  stopSettings();
  stopConnections();
  store.dispose();
  __resetSettingsReadCacheForTests();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('API production-owner lifecycle', () => {
  const mutations: {
    name: string;
    intent: WebSocketApiIntent;
    method: string;
    changes?: AppSettingChange[];
    publication: string;
  }[] = [
    {
      name: 'rotation',
      intent: { kind: 'rotate', connectionId: 'remote' },
      method: 'server.rotateToken',
      publication: 'connections:refresh-self',
    },
    {
      name: 'port',
      intent: { kind: 'port', port: 6200, connectionId: 'local' },
      method: 'settings.update',
      changes: [{ path: 'server.wsApi.port', value: 6200 }],
      publication: 'connections:refresh-self',
    },
    {
      name: 'listen targets',
      intent: { kind: 'listen', ips: ['127.0.0.1'], tunnel: true, connectionId: 'local' },
      method: 'settings.update',
      changes: [
        { path: 'server.bindAddress', value: ['127.0.0.1'] },
        { path: 'server.tunnel.enabled', value: true },
        { path: 'server.tunnel.only', value: false },
      ],
      publication: 'connections:refresh-self',
    },
    {
      name: 'tunnel',
      intent: { kind: 'tunnel', connectionId: 'local' },
      method: 'settings.update',
      changes: [
        { path: 'server.bindAddress', value: ['0.0.0.0'] },
        { path: 'server.tunnel.enabled', value: false },
        { path: 'server.tunnel.only', value: false },
      ],
      publication: 'connections:refresh-self',
    },
    {
      name: 'disable',
      intent: { kind: 'toggle', enabled: false, connectionId: 'local' },
      method: 'settings.update',
      changes: [{ path: 'server.wsApi.enabled', value: false }],
      publication: 'connections:unpublish-self',
    },
    {
      name: 'enable',
      intent: { kind: 'toggle', enabled: true, connectionId: 'local' },
      method: 'settings.update',
      changes: [{ path: 'server.wsApi.enabled', value: true }],
      publication: 'connections:publish-self',
    },
  ];

  it.each(mutations)(
    'finishes $name publication after close-before-ack without delivering to the reopened form',
    async ({ intent, method, changes, publication }) => {
      if (intent.kind === 'toggle' && intent.enabled) {
        settings['server.wsApi.enabled'] = false;
        const invoke = mocks.ipc.getMockImplementation()!;
        mocks.ipc.mockImplementation((channel: string) =>
          channel === 'connections:self-published-state'
            ? { ...selfState, published: false, selfConnectionId: null }
            : invoke(channel),
        );
      }
      store.dispatch(settingsFormOpened(identity, 'websocket-api'));
      registerWebsocketCredentials(identity.formId, identity.sessionId, () => {});
      store.dispatch(
        websocketApiRequested(request('load', 'load'), {
          kind: 'load',
          connectionId: intent.connectionId,
        }),
      );
      await vi.waitFor(() =>
        expect(selectSettingsFormOperation.select(store.state, identity, 'load')?.status).toBe(
          'succeeded',
        ),
      );
      const ack = Promise.withResolvers<unknown>();
      const backend = mocks.backend.getMockImplementation()!;
      mocks.backend.mockImplementation((name: string, params?: unknown, options?: unknown) =>
        name === method ? ack.promise : backend(name, params, options),
      );
      mocks.backend.mockClear();
      mocks.ipc.mockClear();
      mocks.notify.mockClear();
      store.dispatch(websocketApiRequested(request('mutation'), intent));
      await vi.waitFor(() =>
        expect(mocks.backend).toHaveBeenCalledWith(
          ...(changes ? [method, { changes }] : [method, undefined, { localMachine: true }]),
        ),
      );
      store.dispatch(settingsFormClosed(identity));
      const reopened = { ...identity, sessionId: 'reopened' };
      store.dispatch(settingsFormOpened(reopened, 'websocket-api'));
      registerWebsocketCredentials(reopened.formId, reopened.sessionId, () => {});
      for (const change of changes ?? [])
        settings[change.path] = change.value as boolean | number | string[];
      ack.resolve(
        changes ? { revision: 1, applied: changes } : { token: 'synthetic-rotated-token' },
      );
      await vi.waitFor(() =>
        expect(mocks.ipc.mock.calls.filter(([channel]) => channel === publication)).toHaveLength(1),
      );
      expect(mocks.ipc).toHaveBeenCalledWith(publication);
      expect(selectSettingsForm.select(store.state, reopened)?.values).toEqual({});
      expect(selectSettingsFormOperation.select(store.state, reopened, 'save')).toBeUndefined();
      expect(readWebsocketToken({ ...reopened, resource: 'save', requestId: 'read' })).toBe('');
      expect(JSON.stringify(store.state).includes('synthetic-rotated-token')).toBe(false);
      if (publication === 'connections:refresh-self') expect(mocks.notify).not.toHaveBeenCalled();
    },
  );

  it.each(['copy', 'qr'] as const)(
    'keeps hydration usable after %s during pairing and publication',
    async (kind) => {
      const paired = Promise.withResolvers<typeof pairing>();
      const published = Promise.withResolvers<typeof selfState>();
      const backend = mocks.backend.getMockImplementation()!;
      const invoke = mocks.ipc.getMockImplementation()!;
      mocks.backend.mockImplementation((method: string, params?: unknown, options?: unknown) =>
        method === 'server.pairingInfo' ? paired.promise : backend(method, params, options),
      );
      mocks.ipc.mockImplementation((channel: string) =>
        channel === 'connections:self-published-state' ? published.promise : invoke(channel),
      );
      render(WebSocketApiSettings, { expanded: true });
      await vi.waitFor(() =>
        expect(mocks.backend).toHaveBeenCalledWith('server.pairingInfo', undefined, undefined),
      );
      await fireEvent.click(
        await screen.findByRole('button', { name: m.settings_devices_advanced_label() }),
      );
      const effect = () =>
        fireEvent.click(
          kind === 'copy'
            ? screen.getByTitle(m.settings_wsApi_copyToken())
            : screen.getByRole('button', { name: m.settings_wsApi_showQrCode() }),
        );
      await effect();
      await vi.waitFor(() =>
        expect(kind === 'copy' ? mocks.clipboard : mocks.notify).toHaveBeenCalledTimes(1),
      );
      paired.resolve(pairing);
      await vi.waitFor(() =>
        expect(mocks.ipc).toHaveBeenCalledWith('connections:self-published-state'),
      );
      await effect();
      await vi.waitFor(() =>
        expect(kind === 'copy' ? mocks.clipboard : mocks.notify).toHaveBeenCalledTimes(2),
      );
      published.resolve(selfState);
      const share = screen.getByRole('button', { name: m.settings_wsApi_shareLink_label() });
      await waitFor(() => expect((share as HTMLButtonElement).disabled).toBe(false));
      await fireEvent.click(share);
      await vi.waitFor(() =>
        expect(mocks.clipboard.mock.calls.some(([text]) => text.includes('port=5181'))).toBe(true),
      );
      await fireEvent.click(screen.getByRole('button', { name: m.settings_wsApi_showQrCode() }));
      await screen.findByRole('img', { name: m.settings_wsApi_qrImageAlt() });
      expect(mocks.qr).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(store.state).includes(pairing.token)).toBe(false);
    },
  );
});

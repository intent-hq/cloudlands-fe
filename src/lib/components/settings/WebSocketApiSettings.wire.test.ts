/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import WebSocketApiSettings from './WebSocketApiSettings.svelte';
import { m } from '$shared/paraglide/messages.js';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';

const mocks = vi.hoisted(() => ({
  backend: vi.fn(),
  start: async () => {},
  stop: async () => {},
  activeId: 'local',
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backend,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  BackendError: class extends Error {},
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$store/renderer/store', async () => {
  const { createConnectionsHarness } =
    await import('$store/renderer/slices/connections/test-harness');
  const harness = createConnectionsHarness(
    () => ({ windowBackendId: mocks.activeId }),
    undefined,
    true,
  );
  mocks.start = harness.start;
  mocks.stop = harness.stop;
  return { store: harness.store };
});

describe('API settings wire contract', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    window.electronAPI = {
      invoke: async (channel: string) => {
        if (channel === 'connections:list')
          return { connections: [], activeId: 'local', windowBackendId: 'local' };
        if (channel === 'connections:sync-get-state')
          return { supported: false, enabled: false, status: null };
        if (channel === 'connections:self-published-state')
          return { published: false, suppressed: false, selfConnectionId: null };
        if (channel === 'connections:refresh-self') return { refreshed: false };
        throw new Error('Unexpected test IPC channel');
      },
    } as typeof window.electronAPI;
    mocks.activeId = 'local';
    await mocks.start();
  });
  afterEach(async () => {
    cleanup();
    await mocks.stop();
    __resetSettingsReadCacheForTests();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it.each(['local', 'remote'])(
    'routes %s windows to the local daemon and preserves exact settings/server payloads',
    async (connectionId) => {
      mocks.activeId = connectionId;
      let port = 5181;
      mocks.backend.mockImplementation(
        async (
          method: string,
          params: { changes?: { path: string; value: number }[] } | undefined,
        ) => {
          if (method === 'settings.list')
            return {
              settings: [
                { path: 'server.wsApi.enabled', value: true, type: 'boolean' },
                { path: 'server.wsApi.port', value: port, type: 'number' },
              ],
            };
          if (method === 'server.pairingInfo')
            return {
              token: 'synthetic-token',
              certFingerprint: 'AA:BB',
              port,
              path: '/ws',
              localIps: ['192.0.2.10'],
              hostname: 'fixture',
            };
          if (method === 'settings.update') {
            port = params!.changes![0].value;
            return { applied: params!.changes };
          }
          if (method === 'server.rotateToken') return { token: 'synthetic-rotated-token' };
          throw new Error('Unexpected test wire method');
        },
      );
      render(WebSocketApiSettings, { expanded: true });
      await screen.findByRole('button', { name: m.settings_wsApi_showQrCode() });
      await fireEvent.click(
        screen.getByRole('button', { name: m.settings_devices_advanced_label() }),
      );
      const input = screen.getByRole('spinbutton', { name: 'Port' });
      await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
      await fireEvent.input(input, { target: { value: '5182' } });
      await fireEvent.click(screen.getByRole('button', { name: m.settings_wsApi_port_save() }));
      await waitFor(() =>
        expect(mocks.backend.mock.calls.some(([method]) => method === 'settings.update')).toBe(
          true,
        ),
      );
      const update = mocks.backend.mock.calls.find(([method]) => method === 'settings.update')!;
      expect(update[1]).toEqual({ changes: [{ path: 'server.wsApi.port', value: 5182 }] });
      expect(
        mocks.backend.mock.calls.find(([method]) => method === 'server.pairingInfo')?.slice(1),
      ).toEqual([undefined, connectionId === 'local' ? undefined : { localMachine: true }]);
      if (connectionId !== 'local') expect(update[2]).toEqual({ localMachine: true });
      await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
      expect((input as HTMLInputElement).value).toBe('5182');
      await fireEvent.click(screen.getByTitle(m.settings_wsApi_regenerateToken()));
      await waitFor(() =>
        expect(mocks.backend.mock.calls.some(([method]) => method === 'server.rotateToken')).toBe(
          true,
        ),
      );
      expect(
        mocks.backend.mock.calls.find(([method]) => method === 'server.rotateToken')?.slice(1),
      ).toEqual([undefined, connectionId === 'local' ? undefined : { localMachine: true }]);
    },
  );
});

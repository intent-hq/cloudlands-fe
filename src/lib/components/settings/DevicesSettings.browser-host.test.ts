/**
 * @vitest-environment jsdom
 *
 * Settings → Machines on a page served by intent-web (`connections.manage`):
 * the host dials remotes itself, so a remote's tunnel setting loads through
 * the host API without this tab holding a connection, and the tunnel field
 * says when the host cannot use tailcat.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';
import { store } from '$store/renderer/store';
import { connectionsSaga } from '$store/renderer/slices/connections/sagas/connections-saga';

vi.mock('$lib/client', () => ({
  localMachineClient: {
    settings: { list: vi.fn(async () => []), update: vi.fn() },
    server: { pairingInfo: vi.fn(), rotateToken: vi.fn() },
  },
  appClient: {
    settings: { list: vi.fn(async () => []), update: vi.fn() },
    server: { pairingInfo: vi.fn(), rotateToken: vi.fn() },
  },
}));
vi.mock('$features/settings/settings-hydration-service', () => ({ applySettingsChanges: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

import DevicesSettings from './DevicesSettings.svelte';

const REMOTE: ConnectionRecord = {
  id: 'remote-1',
  label: 'Build box',
  accent: 'indigo',
  host: '192.0.2.5',
  port: 8443,
  fingerprint: 'AA:BB',
  isLocal: false,
};

type ConfigGlobal = typeof globalThis & { __INTENT_RUNTIME_CONFIG__?: unknown };
let requests: string[];
let stopSaga: (() => void) | undefined;

function serve(tailcatAvailable: boolean) {
  (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__ = {
    backendId: 'remote-1',
    intentdWsUrl: '/intentd/ws/remote-1',
    connectionsUrl: '/__intent-web/connections',
    hostCapabilities: ['connections.manage'],
    tailcatAvailable,
    localAvailable: false,
  };
  store.init();
  stopSaga = store.runSaga(connectionsSaga);
  return render(DevicesSettings, { initialEditedMachine: 'remote-1' });
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal('electronAPI', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      requests.push(`${init.method ?? 'GET'} ${url}`);
      const body = url.endsWith('/tunnel')
        ? { supported: true, enabled: false }
        : { connections: [REMOTE], activeId: 'remote-1', windowBackendId: 'remote-1' };
      return new Response(JSON.stringify(body));
    }),
  );
});

afterEach(() => {
  cleanup();
  stopSaga?.();
  stopSaga = undefined;
  delete (globalThis as ConfigGlobal).__INTENT_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
});

describe('DevicesSettings on an intent-web host', () => {
  it('loads the tunnel setting through the host and notes missing tailcat', async () => {
    serve(false);
    await waitFor(() =>
      expect(requests).toContain('GET /__intent-web/connections/remote-1/tunnel'),
    );
    expect(screen.getByRole('note').textContent).toContain(
      m.settings_devices_tailcatUnavailable_note(),
    );
    // No live connection is needed: the switch becomes usable once the host answers.
    await waitFor(() =>
      expect(
        screen
          .getByRole('switch', { name: m.settings_tunnel_enable_label() })
          .hasAttribute('disabled'),
      ).toBe(false),
    );
  });

  it('shows no tailcat note when the host can dial tunnels', async () => {
    serve(true);
    await waitFor(() =>
      expect(requests).toContain('GET /__intent-web/connections/remote-1/tunnel'),
    );
    expect(screen.queryByText(m.settings_devices_tailcatUnavailable_note())).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 *
 * T4 — settings toggle + sync status UI. Covers: load-on-mount, the
 * macOS-only gate (`supported` from main; disabled toggle + explanation
 * elsewhere), the enable/disable dispatch with the exact payload, and the
 * status line states (checking / active / unavailable with the helper's
 * message).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeychainSyncStateResult } from '$shared/types/connections';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  start: async () => {},
  stop: async () => {},
  syncState: { value: null as KeychainSyncStateResult | null },
  dispatched: [] as { type: string; payload: unknown[] }[],
  readable: <T>(get: () => T) => ({
    subscribe(run: (v: T) => void) {
      run(get());
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createConnectionsHarness } =
    await import('$store/renderer/slices/connections/test-harness');
  const harness = createConnectionsHarness(
    () => ({ keychainSync: mocks.syncState.value }),
    (action) => mocks.dispatched.push(action),
  );
  mocks.start = harness.start;
  mocks.stop = harness.stop;
  return { store: harness.store };
});

import BackendSyncSettings from './BackendSyncSettings.svelte';

const ACTIVE: KeychainSyncStateResult = {
  supported: true,
  enabled: true,
  status: { state: 'active' },
};

describe('BackendSyncSettings', () => {
  beforeEach(async () => {
    window.electronAPI = {
      ...window.electronAPI,
      on: vi.fn(() => 'listener'),
      offById: vi.fn(),
      invoke: vi.fn(async (channel: string, params?: any) => {
        if (channel === 'connections:list')
          return { connections: [], activeId: 'local', windowBackendId: 'local' };
        if (channel === 'connections:sync-get-state') return mocks.syncState.value;
        if (channel === 'connections:sync-set-enabled')
          return { ...mocks.syncState.value, enabled: params.enabled };
        throw new Error(`Unexpected channel ${channel}`);
      }),
    } as Window['electronAPI'];
    await mocks.start();
  });
  afterEach(async () => {
    cleanup();
    await mocks.stop();
    mocks.syncState.value = null;
    mocks.dispatched.length = 0;
  });

  it('dispatches the state load on mount', async () => {
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(
        mocks.dispatched.some((a) => a.type === 'connections/loadKeychainSyncStateRequested'),
      ).toBe(true);
    });
  });

  it('disables the toggle before the state has loaded', () => {
    render(BackendSyncSettings);
    const toggle = screen.getByRole('switch');
    expect(toggle.hasAttribute('disabled') || toggle.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );
  });

  it('renders a disabled toggle + explanation on unsupported platforms', async () => {
    mocks.syncState.value = { supported: false, enabled: false, status: null };
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(screen.getByText(m.settings_backendSync_unsupported_description())).toBeTruthy();
    });
    const toggle = screen.getByRole('switch');
    expect(toggle.hasAttribute('disabled') || toggle.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );
  });

  it('renders an enabled ON toggle and the active status on macOS', async () => {
    mocks.syncState.value = ACTIVE;
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    });
    expect(screen.getByText(m.settings_backendSync_status_active())).toBeTruthy();
  });

  it('shows the degraded note when active with write errors', async () => {
    mocks.syncState.value = {
      supported: true,
      enabled: true,
      status: { state: 'active', errorCount: 2 },
    };
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(screen.getByText(m.settings_backendSync_status_active())).toBeTruthy();
    });
    expect(screen.getByText(m.settings_backendSync_status_degraded())).toBeTruthy();
  });

  it('hides the degraded note on a clean active status', async () => {
    mocks.syncState.value = ACTIVE;
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(screen.getByText(m.settings_backendSync_status_active())).toBeTruthy();
    });
    expect(screen.queryByText(m.settings_backendSync_status_degraded())).toBeNull();
  });

  it('shows the checking line while enabled with no verdict yet', async () => {
    mocks.syncState.value = { supported: true, enabled: true, status: null };
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(screen.getByText(m.settings_backendSync_status_checking())).toBeTruthy();
    });
  });

  it('shows the unavailable status plus the helper-reported message', async () => {
    mocks.syncState.value = {
      supported: true,
      enabled: true,
      status: { state: 'unavailable', reason: 'helper-missing', message: 'unsigned dev build' },
    };
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(screen.getByText(m.settings_backendSync_status_unavailable())).toBeTruthy();
    });
    expect(screen.getByText('unsigned dev build')).toBeTruthy();
  });

  it('hides the status line entirely while sync is disabled', async () => {
    mocks.syncState.value = { supported: true, enabled: false, status: { state: 'active' } };
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    });
    expect(screen.queryByText(m.settings_backendSync_status_active())).toBeNull();
  });

  it('dispatches setKeychainSyncEnabled with the exact payload on toggle', async () => {
    mocks.syncState.value = { supported: true, enabled: false, status: null };
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false);
    });

    await fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      const action = mocks.dispatched.find(
        (a) => a.type === 'connections/setKeychainSyncEnabledRequested',
      );
      expect(action).toBeDefined();
      expect(action!.payload).toEqual([true]);
      expect(window.electronAPI!.invoke).toHaveBeenCalledWith('connections:sync-set-enabled', {
        enabled: true,
      });
    });
  });

  it('rolls back a failed toggle and permits a retry without remounting', async () => {
    mocks.syncState.value = { supported: true, enabled: false, status: null };
    const invoke = vi.mocked(window.electronAPI!.invoke);
    const original = invoke.getMockImplementation()!;
    let fail = true;
    invoke.mockImplementation(async (channel, ...args) => {
      if (channel === 'connections:sync-set-enabled' && fail) throw new Error('fixture failure');
      return original(channel, ...args);
    });
    render(BackendSyncSettings);
    const toggle = screen.getByRole('switch');
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
    await fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText(m.settings_backendSync_saveError())).toBeTruthy());
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.hasAttribute('disabled')).toBe(false);
    fail = false;
    await fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText(m.settings_backendSync_saveError())).toBeNull());
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'connections:sync-set-enabled'),
    ).toEqual([
      ['connections:sync-set-enabled', { enabled: true }],
      ['connections:sync-set-enabled', { enabled: true }],
    ]);
  });
});

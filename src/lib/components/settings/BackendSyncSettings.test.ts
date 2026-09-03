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
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KeychainSyncStateResult } from '$shared/types/connections';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  syncState: { value: null as KeychainSyncStateResult | null },
  dispatched: [] as { type: string; payload: unknown[] }[],
  readable: <T>(get: () => T) => ({
    subscribe(run: (v: T) => void) {
      run(get());
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    state: {},
    dispatch: (action: { type: string; payload: unknown[] }) => {
      mocks.dispatched.push(action);
      return { ...action, promise: Promise.resolve(mocks.syncState.value) };
    },
  },
}));

vi.mock('$store/renderer/slices/connections/connections-selectors', () => {
  const selector = () => mocks.readable(() => mocks.syncState.value);
  selector.select = () => mocks.syncState.value;
  return { selectKeychainSyncState: selector };
});

import BackendSyncSettings from './BackendSyncSettings.svelte';

const ACTIVE: KeychainSyncStateResult = {
  supported: true,
  enabled: true,
  status: { state: 'active' },
};

describe('BackendSyncSettings', () => {
  afterEach(() => {
    cleanup();
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
    const toggle = screen.getByRole('button', { name: m.settings_backendSync_toggle_label() });
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
    const toggle = screen.getByRole('button', { name: m.settings_backendSync_toggle_label() });
    expect(toggle.hasAttribute('disabled') || toggle.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );
  });

  it('renders an enabled ON toggle and the active status on macOS', async () => {
    mocks.syncState.value = ACTIVE;
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: m.settings_backendSync_toggle_label() })
          .getAttribute('aria-pressed'),
      ).toBe('true');
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
      expect(
        screen
          .getByRole('button', { name: m.settings_backendSync_toggle_label() })
          .getAttribute('aria-pressed'),
      ).toBe('false');
    });
    expect(screen.queryByText(m.settings_backendSync_status_active())).toBeNull();
  });

  it('dispatches setKeychainSyncEnabled with the exact payload on toggle', async () => {
    mocks.syncState.value = { supported: true, enabled: false, status: null };
    render(BackendSyncSettings);
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: m.settings_backendSync_toggle_label() })
          .hasAttribute('disabled'),
      ).toBe(false);
    });

    await fireEvent.click(
      screen.getByRole('button', { name: m.settings_backendSync_toggle_label() }),
    );
    await waitFor(() => {
      const action = mocks.dispatched.find(
        (a) => a.type === 'connections/setKeychainSyncEnabledRequested',
      );
      expect(action).toBeDefined();
      expect(action!.payload).toEqual([true]);
    });
  });
});

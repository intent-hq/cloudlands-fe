/**
 * @vitest-environment jsdom
 *
 * Browser access settings: loads main's state on mount, toggles through
 * `browser-access:set-enabled`, shows the access key and the listening address
 * once running, validates and saves the port, resets the key, and
 * explains start failures and builds without the web UI.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { m } from '$shared/paraglide/messages.js';
import type { BrowserAccessState } from '$shared/types/browser-access';

import { store } from '$store/renderer/store';
import { browserAccessSaga } from '$store/renderer/slices/browser-access/sagas/browser-access-saga';

import BrowserAccessSettings from './BrowserAccessSettings.svelte';

const OFF: BrowserAccessState = {
  available: true,
  enabled: false,
  port: 47120,
  running: false,
  error: null,
  accessKey: 'key-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};
const ON: BrowserAccessState = { ...OFF, enabled: true, running: true };

let current: BrowserAccessState;
let invoke: ReturnType<typeof vi.fn>;
let stopStore: (() => void) | undefined;
let stopSaga: (() => void) | undefined;

beforeEach(() => {
  current = OFF;
  invoke = vi.fn(async (channel: string, params?: { enabled?: boolean; port?: number }) => {
    if (channel === 'browser-access:get-state') return current;
    if (channel === 'browser-access:set-enabled') {
      current = params?.enabled ? ON : OFF;
      return current;
    }
    if (channel === 'browser-access:set-port') {
      current = { ...current, port: params?.port ?? current.port };
      return current;
    }
    if (channel === 'browser-access:reset-key') {
      current = { ...current, accessKey: 'key-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' };
      return current;
    }
    return null;
  });
  window.electronAPI = {
    ...window.electronAPI,
    invoke,
    on: vi.fn(() => 'id'),
    offById: vi.fn(),
  } as never;
  stopStore = store.init();
  stopSaga = store.runSaga(browserAccessSaga);
});

afterEach(() => {
  cleanup();
  stopSaga?.();
  stopStore?.();
});

function toggle(): HTMLElement {
  return screen.getByRole('switch', { name: m.settings_browserAccess_toggle_label() });
}

describe('BrowserAccessSettings', () => {
  it('loads the state and stays compact while off', async () => {
    render(BrowserAccessSettings);
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));
    expect(invoke).toHaveBeenCalledWith('browser-access:get-state', {});
    expect(screen.queryByTestId('browser-access-key')).toBeNull();
  });

  it('turns on and shows the key and the listening address', async () => {
    render(BrowserAccessSettings);
    await waitFor(() => expect((toggle() as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(toggle());
    await waitFor(() => expect(screen.getByTestId('browser-access-key')).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith('browser-access:set-enabled', { enabled: true });
    expect(screen.getByText(ON.accessKey)).toBeTruthy();
    expect(
      screen.getByText(
        m.settings_browserAccess_running_description({ address: '127.0.0.1:47120' }),
      ),
    ).toBeTruthy();
  });

  it('validates the port and saves a valid one on blur', async () => {
    current = ON;
    render(BrowserAccessSettings);
    const port = await screen.findByRole('spinbutton', {
      name: m.settings_browserAccess_port_label(),
    });
    await fireEvent.input(port, { target: { value: '80' } });
    await fireEvent.blur(port);
    expect(
      await screen.findByText(m.settings_browserAccess_port_invalid({ min: 1024, max: 65535 })),
    ).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith('browser-access:set-port', expect.anything());
    await fireEvent.input(port, { target: { value: '50000' } });
    await fireEvent.blur(port);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('browser-access:set-port', { port: 50000 }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          m.settings_browserAccess_running_description({ address: '127.0.0.1:50000' }),
        ),
      ).toBeTruthy(),
    );
  });

  it('resets the access key', async () => {
    current = ON;
    render(BrowserAccessSettings);
    const reset = await screen.findByRole('button', {
      name: m.settings_browserAccess_resetKey_label(),
    });
    await fireEvent.click(reset);
    await waitFor(() =>
      expect(screen.getByText('key-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')).toBeTruthy(),
    );
  });

  it('explains a busy port', async () => {
    current = { ...ON, running: false, error: 'port-in-use' };
    render(BrowserAccessSettings);
    expect(
      await screen.findByText(m.settings_browserAccess_portInUse_error({ port: 47120 })),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        m.settings_browserAccess_running_description({ address: '127.0.0.1:47120' }),
      ),
    ).toBeNull();
  });

  it('disables the switch when the build has no web UI', async () => {
    current = { ...OFF, available: false };
    render(BrowserAccessSettings);
    expect(
      await screen.findByText(m.settings_browserAccess_unavailable_description()),
    ).toBeTruthy();
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
  });
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { connectionTunnelSaga } from '$store/renderer/slices/connections/sagas/connection-tunnel-saga';
import RemoteTunnelSettings from './RemoteTunnelSettings.svelte';

const invoke = vi.fn();
let stop: () => void;
let enabled: boolean;
let previousApi: typeof window.electronAPI;

beforeEach(() => {
  enabled = false;
  invoke.mockReset();
  invoke.mockImplementation(async (channel, params) => {
    if (channel === 'connections:set-tunnel') enabled = params.enabled;
    else if (channel !== 'connections:get-tunnel') throw new Error('Unexpected channel');
    return { supported: true, enabled };
  });
  previousApi = window.electronAPI;
  window.electronAPI = { invoke } as typeof window.electronAPI;
  store.init();
  stop = store.runSaga(connectionTunnelSaga);
});

afterEach(() => {
  cleanup();
  stop();
  store.dispose();
  window.electronAPI = previousApi;
});

function renderSettings(connected = true) {
  return render(RemoteTunnelSettings, {
    deviceId: 'remote-2',
    connected,
    onConnect: vi.fn(),
  });
}

function toggle() {
  return screen.getByRole('switch', { name: m.settings_tunnel_enable_label() });
}

async function ready() {
  await waitFor(() => expect(toggle().hasAttribute('disabled')).toBe(false));
}

describe('remote Tailcat settings', () => {
  it('loads the saved setting and persists enable and disable on the selected remote', async () => {
    const first = renderSettings();
    await ready();
    expect(invoke).toHaveBeenCalledWith('connections:get-tunnel', { id: 'remote-2' });
    expect(toggle().getAttribute('aria-checked')).toBe('false');

    await fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    expect(invoke).toHaveBeenCalledWith('connections:set-tunnel', {
      id: 'remote-2',
      enabled: true,
    });

    first.unmount();
    renderSettings();
    await ready();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));
    expect(invoke).toHaveBeenLastCalledWith('connections:set-tunnel', {
      id: 'remote-2',
      enabled: false,
    });
  });

  it('shows the pending choice and prevents duplicate writes until the server responds', async () => {
    renderSettings();
    await ready();
    const pending = Promise.withResolvers<{ supported: boolean; enabled: boolean }>();
    invoke.mockReturnValueOnce(pending.promise);
    await fireEvent.click(toggle());
    await waitFor(() => expect(toggle().hasAttribute('disabled')).toBe(true));
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(toggle());
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'connections:set-tunnel'),
    ).toHaveLength(1);
    pending.resolve({ supported: true, enabled: true });
    await ready();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('retains the saved value on failure and allows a retry', async () => {
    enabled = true;
    renderSettings();
    await ready();
    invoke.mockRejectedValueOnce(new Error('Remote update failed'));
    await fireEvent.click(toggle());
    await screen.findByRole('alert');
    await ready();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(toggle());
    await waitFor(() => {
      expect(toggle().getAttribute('aria-checked')).toBe('false');
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(
      invoke.mock.calls.filter(([channel]) => channel === 'connections:set-tunnel'),
    ).toHaveLength(2);
  });

  it('does not read or write a disconnected remote and offers Connect', async () => {
    const onConnect = vi.fn();
    const view = render(RemoteTunnelSettings, {
      deviceId: 'remote-2',
      connected: false,
      onConnect,
    });
    expect(toggle().hasAttribute('disabled')).toBe(true);
    await fireEvent.click(toggle());
    expect(invoke).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: m.settings_devices_connect_label() }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    await view.rerender({ connected: true });
    await ready();
    expect(invoke).toHaveBeenCalledWith('connections:get-tunnel', { id: 'remote-2' });
    await view.rerender({ connected: false });
    expect(toggle().hasAttribute('disabled')).toBe(true);
  });

  it('keeps the switch disabled until a failed load is retried successfully', async () => {
    invoke.mockRejectedValueOnce(new Error('Remote unavailable'));
    renderSettings();
    await screen.findByRole('alert');
    expect(toggle().hasAttribute('disabled')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: m.settings_devices_retry_label() }));
    await ready();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('omits the setting when an older remote does not support tunnels', async () => {
    invoke.mockResolvedValue({ supported: false, enabled: false });
    renderSettings();
    await waitFor(() => expect(screen.queryByRole('switch')).toBeNull());
    expect(invoke.mock.calls).toEqual([['connections:get-tunnel', { id: 'remote-2' }]]);
  });

  it('does not deliver an old device response into a different edit session', async () => {
    const pending = Promise.withResolvers<{ supported: boolean; enabled: boolean }>();
    invoke.mockReturnValueOnce(pending.promise);
    const view = renderSettings();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await view.rerender({ deviceId: 'remote-3' });
    await ready();
    pending.resolve({ supported: true, enabled: true });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(toggle());
    await ready();
    expect(invoke).toHaveBeenLastCalledWith('connections:set-tunnel', {
      id: 'remote-3',
      enabled: true,
    });
  });
});

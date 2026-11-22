/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import TunnelRelaySettings from './TunnelRelaySettings.svelte';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  pairingInfo: vi.fn(),
  localList: vi.fn(),
  localUpdate: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  localMachineClient: {
    settings: { list: mocks.localList, update: mocks.localUpdate },
    server: { pairingInfo: vi.fn(), rotateToken: vi.fn() },
  },
  appClient: {
    settings: { list: mocks.list, update: mocks.update },
    server: { pairingInfo: mocks.pairingInfo, rotateToken: vi.fn() },
  },
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: toast }));

const connectionState = vi.hoisted(() => ({
  start: async () => {},
  stop: async () => {},
}));
vi.mock('$store/renderer/store', async () => {
  const { createConnectionsHarness } =
    await import('$store/renderer/slices/connections/connections.test-helpers');
  const harness = createConnectionsHarness(
    () => ({ windowBackendId: 'local' }),
    () => {},
    true,
  );
  connectionState.start = harness.start;
  connectionState.stop = harness.stop;
  return { store: harness.store };
});

const invoke = vi.hoisted(() => vi.fn());

const RELAY = 'https://relay.example.com/derpmap.json';
function rows(derpUrl: string | null) {
  return [
    { path: 'server.wsApi.enabled', value: false },
    { path: 'server.tunnel.enabled', value: true },
    ...(derpUrl === null ? [] : [{ path: 'server.tunnel.derpUrl', value: derpUrl }]),
  ];
}
async function relayInput() {
  render(TunnelRelaySettings);
  const input = (await screen.findByRole('textbox', {
    name: m.settings_tunnel_relay_label(),
  })) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}
const saveButton = () => screen.queryByRole('button', { name: m.settings_wsApi_port_save() });

describe('TunnelRelaySettings on this machine', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'connections:list')
        return { connections: [], activeId: 'local', windowBackendId: 'local' };
      if (channel === 'connections:sync-get-state')
        return { supported: false, enabled: false, status: null };
      if (channel === 'connections:self-published-state')
        return { published: false, suppressed: false, selfConnectionId: null };
      if (channel === 'connections:refresh-self') return { refreshed: true };
      throw new Error(`unexpected invoke: ${channel}`);
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
    await connectionState.start();
  });

  afterEach(async () => {
    cleanup();
    await connectionState.stop();
    window.location.hash = '';
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows the saved relay without reading pairing data or the local-machine client', async () => {
    mocks.list.mockResolvedValue(rows(RELAY));
    const input = await relayInput();
    expect(input.value).toBe(RELAY);
    expect(saveButton()).toBeNull();
    expect(screen.getByRole('region', { name: m.settings_section_network() })).toBeTruthy();
    expect(mocks.pairingInfo).not.toHaveBeenCalled();
    expect(mocks.localList).not.toHaveBeenCalled();
  });

  it('renders nothing on a daemon without the setting', async () => {
    mocks.list.mockResolvedValue(rows(null));
    render(TunnelRelaySettings);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('textbox', { name: m.settings_tunnel_relay_label() })).toBeNull();
    expect(screen.queryByRole('region', { name: m.settings_section_network() })).toBeNull();
  });

  it('saves a trimmed relay map URL and refreshes the published record', async () => {
    mocks.list.mockResolvedValue(rows(''));
    const input = await relayInput();
    await fireEvent.input(input, { target: { value: `  ${RELAY} ` } });
    mocks.update.mockResolvedValueOnce([{ path: 'server.tunnel.derpUrl', value: RELAY }]);
    mocks.list.mockResolvedValue(rows(RELAY));
    await fireEvent.click(saveButton()!);

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith([{ path: 'server.tunnel.derpUrl', value: RELAY }]),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(m.settings_tunnel_relay_saved()),
    );
    await waitFor(() => expect(saveButton()).toBeNull());
    expect(input.value).toBe(RELAY);
    expect(invoke).toHaveBeenCalledWith('connections:refresh-self');
    expect(mocks.localUpdate).not.toHaveBeenCalled();
  });

  it('clears the relay to go back to the default relays', async () => {
    mocks.list.mockResolvedValue(rows(RELAY));
    const input = await relayInput();
    await fireEvent.input(input, { target: { value: '' } });
    mocks.update.mockResolvedValueOnce([{ path: 'server.tunnel.derpUrl', value: '' }]);
    mocks.list.mockResolvedValue(rows(''));
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith([{ path: 'server.tunnel.derpUrl', value: '' }]),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(m.settings_tunnel_relay_cleared()),
    );
  });

  it('refuses a value that is not an http(s) URL, without a write', async () => {
    mocks.list.mockResolvedValue(rows(''));
    const input = await relayInput();
    await fireEvent.input(input, { target: { value: 'h' } });
    expect(screen.queryByText(m.settings_tunnel_relay_invalid())).toBeNull();
    await fireEvent.blur(input);
    expect(screen.getByText(m.settings_tunnel_relay_invalid())).toBeTruthy();
    for (const value of ['relay.example.com', 'ftp://relay.example.com/map', 'https://']) {
      await fireEvent.input(input, { target: { value } });
      expect(screen.getByText(m.settings_tunnel_relay_invalid())).toBeTruthy();
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
      await fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('says in plain words when the daemon cannot reach the relay, and keeps the draft', async () => {
    mocks.list.mockResolvedValue(rows(''));
    const input = await relayInput();
    await fireEvent.input(input, { target: { value: RELAY } });
    mocks.update.mockRejectedValueOnce(new Error('no relay answered'));
    await fireEvent.click(saveButton()!);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        m.settings_tunnel_relay_saveError({ error: 'no relay answered' }),
      ),
    );
    expect(input.value).toBe(RELAY);
    expect(invoke).not.toHaveBeenCalledWith('connections:refresh-self');
  });

  it('focuses the field for #tunnel-relay', async () => {
    mocks.list.mockResolvedValue(rows(RELAY));
    window.location.hash = '#tunnel-relay';
    const input = await relayInput();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});

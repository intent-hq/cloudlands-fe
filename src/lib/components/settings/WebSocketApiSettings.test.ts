/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import WebSocketApiSettings from './WebSocketApiSettings.svelte';

const isNetworkSelected = (element: HTMLElement): boolean =>
  element.getAttribute('aria-selected') === 'true';

// Mock appClient - use vi.hoisted to avoid hoisting issues
const mocks = vi.hoisted(() => ({
  mockSettingsList: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockPairingInfo: vi.fn(),
  mockRotateToken: vi.fn(),
  localSettingsList: vi.fn(),
  localSettingsUpdate: vi.fn(),
  localPairingInfo: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  localMachineClient: {
    settings: { list: mocks.localSettingsList, update: mocks.localSettingsUpdate },
    server: { pairingInfo: mocks.localPairingInfo, rotateToken: vi.fn() },
  },
  appClient: {
    settings: {
      list: mocks.mockSettingsList,
      update: mocks.mockSettingsUpdate,
    },
    server: {
      pairingInfo: mocks.mockPairingInfo,
      rotateToken: mocks.mockRotateToken,
    },
  },
}));

// Mock toast
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: mockToast,
}));

// Mock the lazily-imported qrcode module so QR tests can assert the pairing URI.
const qrMocks = vi.hoisted(() => ({
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,'),
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: qrMocks.toDataURL },
}));

// Mock the store so selectCurrentConnectionId resolves; tests flip
// `connectionState.activeId` and call `connectionState.emit()` to simulate a
// connection switch while the component stays mounted. Dispatches of the
// keychain-sync async actions resolve `connectionState.syncState` through the
// createAsyncAction `.promise` contract.
const connectionState = vi.hoisted(() => ({
  activeId: 'local',
  emit: () => {},
  syncState: { supported: true, enabled: true, status: null } as {
    supported: boolean;
    enabled: boolean;
    status: unknown;
  },
  dispatched: [] as { type: string }[],
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({
    state: () => ({ connections: { windowBackendId: connectionState.activeId } }),
    dispatch: (action: { type: string }) => {
      connectionState.dispatched.push(action);
      return { ...action, promise: Promise.resolve(connectionState.syncState) };
    },
  });
  connectionState.emit = () => store.emitState();
  return { store };
});

// Publish-self IPC surface (renderer → main via window.electronAPI.invoke).
const ipcMocks = vi.hoisted(() => ({
  selfState: { published: false, suppressed: false, selfConnectionId: null } as {
    published: boolean;
    suppressed: boolean;
    selfConnectionId: string | null;
  },
  invoke: vi.fn(),
}));

function installElectronApi() {
  ipcMocks.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'connections:self-published-state') return { ...ipcMocks.selfState };
    if (channel === 'connections:publish-self') {
      return { connection: { id: 'mock-self' } };
    }
    if (channel === 'connections:refresh-self') return { refreshed: true };
    if (channel === 'connections:unpublish-self') return { removed: true };
    throw new Error(`unexpected invoke: ${channel}`);
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = { invoke: ipcMocks.invoke };
}

// Existing configuration tests exercise controls after opening their disclosure.
async function openNetworks() {
  const input = await screen.findByRole('combobox', { name: m.settings_listenTargets_label() });
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  await fireEvent.focus(input);
}
async function pickNetwork(name: string) {
  await fireEvent.pointerUp(screen.getByRole('option', { name }), {
    button: 0,
    pointerType: 'mouse',
  });
}

async function renderExpandedSettings() {
  const view = render(WebSocketApiSettings);
  const advanced = screen.queryByRole('button', { name: m.settings_devices_advanced_label() });
  if (advanced) await fireEvent.click(advanced);
  return view;
}

describe('WebSocketApiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionState.activeId = 'local';
    connectionState.syncState = { supported: true, enabled: true, status: null };
    connectionState.dispatched.length = 0;
    ipcMocks.selfState = { published: false, suppressed: false, selfConnectionId: null };
    installElectronApi();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('starts Advanced collapsed and preserves a port draft when toggled', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);
    render(WebSocketApiSettings);
    const advanced = screen.getByRole('button', { name: m.settings_devices_advanced_label() });
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: 'Port' })).toBeNull();
    await fireEvent.click(advanced);
    const port = await screen.findByRole('spinbutton', { name: 'Port' });
    await fireEvent.input(port, { target: { value: '5182' } });
    await fireEvent.click(advanced);
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: 'Port' })).toBeNull();
    await fireEvent.click(advanced);
    expect((screen.getByRole('spinbutton', { name: 'Port' }) as HTMLInputElement).value).toBe(
      '5182',
    );
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
  });

  describe('mobile pairing dialog', () => {
    async function renderPairing() {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.mockPairingInfo.mockResolvedValue({
        token: 'fixture-token',
        port: 5181,
        certFingerprint: 'AA:BB',
        localIps: ['192.0.2.10'],
        hostname: 'fixture-device',
      });
      await renderExpandedSettings();
      await screen.findByRole('button', { name: m.settings_wsApi_showQrCode() });
    }

    it('removes the sensitive pairing image after 30 seconds without a settings write', async () => {
      await renderPairing();
      vi.useFakeTimers();
      await fireEvent.click(screen.getByRole('button', { name: m.settings_wsApi_showQrCode() }));
      await vi.dynamicImportSettled();
      await tick();
      expect(screen.getByRole('dialog')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(screen.getByRole('img', { name: m.settings_wsApi_qrImageAlt() })).toBeTruthy();
      await vi.advanceTimersByTimeAsync(1);
      // Allow the shared dialog's bounded exit transition to finish.
      await vi.advanceTimersByTimeAsync(1000);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('img', { name: m.settings_wsApi_qrImageAlt() })).toBeNull();
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it.each(['button', 'escape'] as const)(
      'dismisses by %s and keeps a newly opened code for a fresh expiry period',
      async (method) => {
        await renderPairing();
        vi.useFakeTimers();
        const open = screen.getByRole('button', { name: m.settings_wsApi_showQrCode() });
        await fireEvent.click(open);
        await vi.dynamicImportSettled();
        await tick();
        expect(screen.getByRole('dialog')).toBeTruthy();
        await vi.advanceTimersByTimeAsync(10_000);
        if (method === 'button') {
          await fireEvent.click(screen.getByText(m.settings_wsApi_close(), { selector: 'span' }));
        } else if (method === 'backdrop') {
          await vi.advanceTimersByTimeAsync(20);
          await fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!, {
            button: 0,
            pointerType: 'mouse',
            clientX: 1,
            clientY: 1,
          });
          await vi.advanceTimersByTimeAsync(20);
        } else {
          await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        }
        // Allow the shared dialog's bounded exit transition to finish.
        await vi.advanceTimersByTimeAsync(1000);
        expect(screen.queryByRole('dialog')).toBeNull();
        await fireEvent.click(open);
        await vi.dynamicImportSettled();
        await tick();
        expect(screen.getByRole('dialog')).toBeTruthy();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(screen.getByRole('dialog')).toBeTruthy();
        await vi.advanceTimersByTimeAsync(10_000);
        // Allow the shared dialog's bounded exit transition to finish.
        await vi.advanceTimersByTimeAsync(1000);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
      },
    );
  });

  it('shows toast.error when settings.update rejects on toggle enable', async () => {
    // Arrange: initial state with WSS disabled
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    await renderExpandedSettings();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

    // Mock settings.update to reject (daemon error)
    mocks.mockSettingsUpdate.mockRejectedValueOnce(
      new Error(
        'Port 5181 is already in use — choose a different port or stop the process using it',
      ),
    );

    // Act: toggle enable
    const toggle = screen.getByRole('switch');
    await fireEvent.click(toggle);

    // Assert: settings.update was called with exact payload
    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'server.wsApi.enabled', value: true },
      ]);
    });

    // Assert: toast.error was called with the daemon's error message
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringContaining('Port 5181 is already in use'),
      );
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('shows toast.error with daemon message when settings.update returns rolled-back value', async () => {
    // Arrange: initial state with WSS disabled
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    await renderExpandedSettings();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

    // Mock settings.update to succeed but return rolled-back value (daemon hook failed)
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'server.wsApi.enabled', value: false }, // rolled back!
    ]);

    // Act: toggle enable
    const toggle = screen.getByRole('switch');
    await fireEvent.click(toggle);

    // Assert: toast.error was called (daemon rolled back the setting)
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('allows configuring the port under Advanced even when WSS is disabled', async () => {
    // Arrange: WSS disabled
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    await renderExpandedSettings();

    // Assert: port row is visible
    await waitFor(() => {
      expect(screen.getByText('Port')).toBeTruthy();
    });
  });

  it('shows Save button when port value differs from persisted setting, and clicking Save calls settings.update', async () => {
    // Arrange: WSS disabled, port 5181
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    mocks.mockSettingsUpdate.mockResolvedValueOnce([{ path: 'server.wsApi.port', value: 5182 }]);

    await renderExpandedSettings();

    // Wait for port input to be visible
    const portInput = await waitFor(() => screen.getByDisplayValue('5181') as HTMLInputElement);

    // Act: change port value
    await fireEvent.input(portInput, { target: { value: '5182' } });

    // Assert: Save button appears
    const saveButton = await waitFor(() => screen.getByText('Save'));
    expect(saveButton).toBeTruthy();

    // Act: click Save
    await fireEvent.click(saveButton);

    // Assert: settings.update was called with exact payload
    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'server.wsApi.port', value: 5182 },
      ]);
    });

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('hides Save button when the persisted port value is retyped (#814)', async () => {
    // Arrange: WSS disabled, port 5181
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    await renderExpandedSettings();

    // Wait for port input to be visible
    const portInput = await waitFor(() => screen.getByDisplayValue('5181') as HTMLInputElement);

    // Act: change port value so the Save button appears
    await fireEvent.input(portInput, { target: { value: '5182' } });
    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Act: retype the persisted value (number input coerces the bound value to a number)
    await fireEvent.input(portInput, { target: { value: '5181' } });

    // Assert: Save button is hidden again
    await waitFor(() => {
      expect(screen.queryByText('Save')).toBeNull();
    });
  });

  it('renders the TLS fingerprint truncated with the full value on the title tooltip', async () => {
    // User decision reversing cloudlands-fe#1979: the fingerprint shows as a
    // truncated single line; the full value stays reachable via the tooltip.
    const fullFingerprint =
      'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: true },
      { path: 'server.wsApi.port', value: 5181 },
    ]);
    mocks.mockPairingInfo.mockResolvedValue({
      token: 'tok-1234567890',
      port: 5181,
      certFingerprint: fullFingerprint,
      localIps: ['192.168.1.2'],
      hostname: 'my-mac',
    });

    await renderExpandedSettings();

    await waitFor(() => {
      expect(screen.getByText(`${fullFingerprint.slice(0, 23)}…`)).toBeTruthy();
    });
    expect(screen.getByTitle(fullFingerprint)).toBeTruthy();
    expect(screen.queryByText(fullFingerprint)).toBeNull();
  });

  describe('self-entry refresh triggers (token rotation, port change)', () => {
    const PAIRING = {
      token: 'tok-1234567890',
      port: 5181,
      certFingerprint: 'AA:BB',
      localIps: ['192.168.1.2'],
      hostname: 'my-mac',
    };

    /** Render with WSS enabled on the local connection. */
    async function renderEnabled() {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await waitFor(() => expect(mocks.mockPairingInfo).toHaveBeenCalled());
    }

    it('token regeneration fires connections:refresh-self', async () => {
      await renderEnabled();
      mocks.mockRotateToken.mockResolvedValue({ token: 'tok-new' });

      await fireEvent.click(screen.getByTitle('Regenerate token'));

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:refresh-self');
      });
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('a failed token rotation never fires connections:refresh-self', async () => {
      await renderEnabled();
      mocks.mockRotateToken.mockRejectedValue(new Error('daemon says no'));

      await fireEvent.click(screen.getByTitle('Regenerate token'));

      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:refresh-self');
    });

    it('a port save while enabled fires connections:refresh-self', async () => {
      await renderEnabled();
      mocks.mockSettingsUpdate.mockResolvedValueOnce([{ path: 'server.wsApi.port', value: 5182 }]);
      mocks.mockPairingInfo.mockResolvedValue({ ...PAIRING, port: 5182 });

      const portInput = await waitFor(() => screen.getByDisplayValue('5181') as HTMLInputElement);
      await fireEvent.input(portInput, { target: { value: '5182' } });
      await fireEvent.click(await waitFor(() => screen.getByText('Save')));

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:refresh-self');
      });
    });

    it('a port save while WSS is disabled never fires connections:refresh-self', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: false },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      await renderExpandedSettings();
      mocks.mockSettingsUpdate.mockResolvedValueOnce([{ path: 'server.wsApi.port', value: 5182 }]);

      const portInput = await waitFor(() => screen.getByDisplayValue('5181') as HTMLInputElement);
      await fireEvent.input(portInput, { target: { value: '5182' } });
      await fireEvent.click(await waitFor(() => screen.getByText('Save')));

      await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:refresh-self');
    });
  });

  describe('host settings from a remote window', () => {
    beforeEach(() => {
      connectionState.activeId = 'remote-1';
      mocks.localSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: false },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.localSettingsUpdate.mockImplementation(async (changes) => changes);
    });

    it('loads no settings until Edit expands the panel', async () => {
      const view = render(WebSocketApiSettings, { expanded: false });
      expect(screen.queryByRole('switch')).toBeNull();
      expect(mocks.localSettingsList).not.toHaveBeenCalled();
      await view.rerender({ expanded: true });
      await waitFor(() => expect(mocks.localSettingsList).toHaveBeenCalled());
      expect(screen.getByRole('switch')).toBeTruthy();
      expect(mocks.mockSettingsList).not.toHaveBeenCalled();
      expect(mocks.mockPairingInfo).not.toHaveBeenCalled();
    });

    it('saves host port changes using the local client', async () => {
      await renderExpandedSettings();
      await waitFor(() => expect(mocks.localSettingsList).toHaveBeenCalled());
      await fireEvent.input(screen.getByRole('spinbutton', { name: 'Port' }), {
        target: { value: '5182' },
      });
      await fireEvent.click(screen.getByRole('button', { name: m.settings_wsApi_port_save() }));
      await waitFor(() =>
        expect(mocks.localSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.wsApi.port', value: 5182 },
        ]),
      );
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('hides host controls again when Edit closes', async () => {
      const view = render(WebSocketApiSettings, { expanded: true });
      await waitFor(() => expect(mocks.localSettingsList).toHaveBeenCalled());
      await view.rerender({ expanded: false });
      expect(screen.queryByRole('switch')).toBeNull();
      expect(
        screen.queryByRole('button', { name: m.settings_devices_advanced_label() }),
      ).toBeNull();
    });
  });

  it('copies the complete TLS fingerprint', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: true },
      { path: 'server.wsApi.port', value: 5181 },
    ]);
    const fingerprint = Array.from({ length: 32 }, () => 'AB').join(':');
    mocks.mockPairingInfo.mockResolvedValue({
      token: 'test-token',
      certFingerprint: fingerprint,
      port: 5181,
      path: '/ws',
      localIps: ['192.0.2.1'],
      hostname: 'host',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await renderExpandedSettings();
    await fireEvent.click(
      await screen.findByRole('button', { name: m.settings_wsApi_copyFingerprint_label() }),
    );
    expect(writeText).toHaveBeenCalledWith(fingerprint);
  });

  describe('auto-publish on WSS toggle-on (opt-out sync, no modal)', () => {
    const PAIRING = {
      token: 'tok-1234567890',
      port: 5181,
      certFingerprint: 'AA:BB',
      localIps: ['192.168.1.2'],
      hostname: 'my-mac',
    };

    /** Render with WSS off, then toggle it on (settings.update accepted). */
    async function toggleOn() {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: false },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: true },
      ]);
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await fireEvent.click(screen.getByRole('switch'));
    }

    it('auto-publishes without a modal when sync is on and self is unpublished', async () => {
      await toggleOn();

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:publish-self');
        expect(mockToast.success).toHaveBeenCalledWith('Backend published to iCloud Keychain');
      });
      // No opt-in modal is ever shown.
      expect(screen.queryByRole('dialog')).toBeNull();
      // Auto-publish never flips the sync pref itself.
      expect(
        connectionState.dispatched.some((a) =>
          a.type.startsWith('connections/setKeychainSyncEnabled'),
        ),
      ).toBe(false);
    });

    it('does not publish on unsupported platforms (non-macOS)', async () => {
      connectionState.syncState = { supported: false, enabled: false, status: null };
      await toggleOn();

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:self-published-state');
      });
      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:publish-self');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not publish (and shows no prompt) when sync is explicitly disabled', async () => {
      connectionState.syncState = { supported: true, enabled: false, status: null };
      await toggleOn();

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:self-published-state');
      });
      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:publish-self');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(
        connectionState.dispatched.some((a) =>
          a.type.startsWith('connections/setKeychainSyncEnabled'),
        ),
      ).toBe(false);
    });

    it('does not publish when self is already published', async () => {
      ipcMocks.selfState = { published: true, suppressed: false, selfConnectionId: 'self-1' };
      await toggleOn();

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:self-published-state');
      });
      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:publish-self');
    });

    it('does not publish when auto-publish is suppressed', async () => {
      ipcMocks.selfState = { published: false, suppressed: true, selfConnectionId: null };
      await toggleOn();

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:self-published-state');
      });
      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:publish-self');
    });

    it('shows an error toast when the auto-publish fails; the toggle stays on', async () => {
      ipcMocks.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'connections:publish-self') throw new Error('keychain write failed');
        return { ...ipcMocks.selfState };
      });
      await toggleOn();

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          expect.stringContaining('keychain write failed'),
        );
      });
      // The publish failure never rolls back the WSS toggle.
      expect((screen.getByRole('switch') as HTMLElement).getAttribute('aria-checked')).toBe('true');
    });

    it('shows the publish row with a re-publish label when suppressed', async () => {
      // Suppressed + sync on: no auto-modal, but the explicit button offers
      // re-publish (spec: re-publishing clears the suppression, button-only).
      ipcMocks.selfState = { published: false, suppressed: true, selfConnectionId: null };
      await toggleOn();

      const button = await waitFor(() => screen.getByRole('button', { name: 'Re-publish' }));
      await fireEvent.click(button);

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:publish-self');
        expect(mockToast.success).toHaveBeenCalled();
      });
      // Once published, the row is gone.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Re-publish' })).toBeNull();
      });
    });
  });

  describe('silent auto-unpublish on WSS toggle-off', () => {
    const PAIRING = {
      token: 'tok-1234567890',
      port: 5181,
      certFingerprint: 'AA:BB',
      localIps: ['192.168.1.2'],
      hostname: 'my-mac',
    };

    /** Render with WSS on (publish state loaded), then toggle it off. */
    async function toggleOff() {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:self-published-state');
      });

      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: false },
      ]);
      await fireEvent.click(screen.getByRole('switch'));
      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.wsApi.enabled', value: false },
        ]);
      });
    }

    it('silently unpublishes when a published self entry exists (no modal)', async () => {
      ipcMocks.selfState = { published: true, suppressed: false, selfConnectionId: 'self-1' };
      await toggleOff();

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:unpublish-self');
        expect(mockToast.success).toHaveBeenCalledWith('Backend removed from iCloud Keychain');
      });
      // No confirmation modal — the removal is silent and automatic.
      expect(screen.queryByRole('dialog')).toBeNull();
      // The removal goes through the dedicated unpublish IPC, never the
      // suppression-latching forget path.
      expect(connectionState.dispatched.some((a) => a.type === 'connections/forgetRequested')).toBe(
        false,
      );
    });

    it('does not unpublish (and shows no toast) when no self entry is published', async () => {
      ipcMocks.selfState = { published: false, suppressed: false, selfConnectionId: null };
      await toggleOff();

      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:unpublish-self');
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('does not unpublish on unsupported platforms (non-macOS)', async () => {
      connectionState.syncState = { supported: false, enabled: false, status: null };
      ipcMocks.selfState = { published: true, suppressed: false, selfConnectionId: 'self-1' };
      await toggleOff();

      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:unpublish-self');
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('shows an error toast when the unpublish fails; the toggle stays off', async () => {
      ipcMocks.selfState = { published: true, suppressed: false, selfConnectionId: 'self-1' };
      ipcMocks.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'connections:self-published-state') return { ...ipcMocks.selfState };
        if (channel === 'connections:unpublish-self') throw new Error('keychain delete failed');
        return { refreshed: true };
      });
      await toggleOff();

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          expect.stringContaining('keychain delete failed'),
        );
      });
      // The unpublish failure never rolls back the WSS toggle.
      expect((screen.getByRole('switch') as HTMLElement).getAttribute('aria-checked')).toBe(
        'false',
      );
    });

    it('shows no success toast when unpublish reports removed: false (stale local state)', async () => {
      ipcMocks.selfState = { published: true, suppressed: false, selfConnectionId: 'self-1' };
      ipcMocks.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'connections:self-published-state') return { ...ipcMocks.selfState };
        if (channel === 'connections:unpublish-self') return { removed: false };
        return { refreshed: true };
      });
      await toggleOff();

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:unpublish-self');
      });
      // Nothing was actually removed — claiming "removed from Keychain" would
      // be a lie (PR #1781 review).
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('disables the toggle while a transition (incl. the awaited unpublish) is in flight', async () => {
      ipcMocks.selfState = { published: true, suppressed: false, selfConnectionId: 'self-1' };
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:self-published-state');
      });

      // Hold the toggle-off's auto-unpublish open: the switch must be disabled
      // for the whole transition so a rapid off→on cannot interleave with the
      // queued unpublish (PR #1781 review).
      let releaseUnpublish: (value: { removed: boolean }) => void;
      ipcMocks.invoke.mockImplementation(async (channel: string) => {
        if (channel === 'connections:self-published-state') return { ...ipcMocks.selfState };
        if (channel === 'connections:unpublish-self') {
          return new Promise((resolve) => {
            releaseUnpublish = resolve;
          });
        }
        return { refreshed: true };
      });
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: false },
      ]);
      await fireEvent.click(screen.getByRole('switch'));
      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:unpublish-self');
      });
      expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);

      // A click during the transition is a no-op (no second settings.update).
      await fireEvent.click(screen.getByRole('switch'));
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledTimes(1);

      releaseUnpublish!({ removed: true });
      await waitFor(() => {
        expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false);
      });
    });

    it('publish-in-session, toggle-off unpublishes, toggle-on auto-publishes again', async () => {
      // Start unpublished.
      ipcMocks.selfState = { published: false, suppressed: false, selfConnectionId: null };
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: false },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

      // Toggle WSS on → auto-publish.
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: true },
      ]);
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await fireEvent.click(screen.getByRole('switch'));
      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:publish-self');
      });
      // The busy guard keeps the switch disabled until the whole transition
      // (incl. the awaited auto-publish) settles — wait it out before the
      // next toggle, like a user would.
      await waitFor(() => {
        expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false);
      });

      // Toggle WSS off in the SAME session: the silent auto-unpublish fires.
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: false },
      ]);
      await fireEvent.click(screen.getByRole('switch'));
      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:unpublish-self');
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => {
        expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false);
      });

      // Toggle WSS back on: the removal did NOT latch the "do not
      // auto-publish" marker, so the auto-publish fires again.
      ipcMocks.invoke.mockClear();
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: true },
      ]);
      await fireEvent.click(screen.getByRole('switch'));
      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:publish-self');
      });
    });
  });

  describe('listen targets + tunnel (PR #2030 review)', () => {
    const PAIRING = {
      token: 'tok-1234567890',
      port: 5181,
      certFingerprint: 'AA:BB',
      localIps: ['192.168.1.2', '10.0.0.5'],
      hostname: 'my-mac',
    };

    /** settings.list rows for an enabled WSS daemon; tunnel rows optional. */
    function settingsRows(tunnel?: { enabled: boolean; only: boolean }) {
      const rows: { path: string; value: unknown }[] = [
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
        { path: 'server.bindAddress', value: ['192.168.1.2'] },
      ];
      if (tunnel) {
        rows.push({ path: 'server.tunnel.enabled', value: tunnel.enabled });
        rows.push({ path: 'server.tunnel.only', value: tunnel.only });
        rows.push({ path: 'server.tunnel.derpUrl', value: '' });
      }
      return rows;
    }

    it('omits server.tunnel.* from the update batch on daemons without tunnel support', async () => {
      // Old daemon: no server.tunnel.* rows → tunnelSupported=false. An
      // IP-only change must not batch the unknown tunnel paths (atomic
      // settings.update would reject the whole batch).
      mocks.mockSettingsList.mockResolvedValue(settingsRows());
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await openNetworks();

      mocks.mockSettingsUpdate.mockResolvedValueOnce([]);
      await pickNetwork('10.0.0.5');

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ['192.168.1.2', '10.0.0.5', '127.0.0.1'] },
        ]);
      });
    });

    it('includes the tunnel paths in the batch when the daemon supports them', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: false, only: false }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await openNetworks();

      mocks.mockSettingsUpdate.mockResolvedValueOnce([]);
      await pickNetwork('10.0.0.5');

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ['192.168.1.2', '10.0.0.5', '127.0.0.1'] },
          { path: 'server.tunnel.enabled', value: false },
          { path: 'server.tunnel.only', value: false },
        ]);
      });
    });

    it('a successful listen-targets save fires connections:refresh-self', async () => {
      // The bind IPs feed the published hosts list, so the self entry must
      // re-upsert after the save (same fail-soft trigger as port/token).
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: false, only: false }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await openNetworks();

      mocks.mockSettingsUpdate.mockResolvedValueOnce([]);
      await pickNetwork('10.0.0.5');

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:refresh-self');
      });
    });

    it('a successful tunnel toggle fires connections:refresh-self', async () => {
      // Toggling the tunnel changes the daemon's tc address, which is a
      // published field on the self record.
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: false, only: false }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() })).toBeTruthy(),
      );

      mocks.mockSettingsUpdate.mockResolvedValueOnce([]);
      await fireEvent.click(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() }));

      await waitFor(() => {
        expect(ipcMocks.invoke).toHaveBeenCalledWith('connections:refresh-self');
      });
    });

    it('a failed listen-targets save never fires connections:refresh-self', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: false, only: false }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await openNetworks();

      mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('daemon says no'));
      await pickNetwork('10.0.0.5');

      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:refresh-self');
    });

    it('enabling the tunnel toggle persists a bindAddress that includes 127.0.0.1', async () => {
      // The tailcat sidecar forwards tunnel connections to 127.0.0.1, so
      // turning the tunnel on must write loopback into server.bindAddress.
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: false, only: false }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() })).toBeTruthy(),
      );

      mocks.mockSettingsUpdate.mockResolvedValueOnce([]);
      await fireEvent.click(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() }));

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ['192.168.1.2', '127.0.0.1'] },
          { path: 'server.tunnel.enabled', value: true },
          { path: 'server.tunnel.only', value: false },
        ]);
      });
    });

    it('disabling the tunnel toggle from tunnel-only restores the persisted bind IPs plus loopback', async () => {
      // Tunnel-only has no direct listeners; toggling the tunnel off must
      // re-activate the persisted bindAddress (loopback-repaired) so zero
      // targets never persist.
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: true, only: true }));
      mocks.mockPairingInfo.mockResolvedValue({ ...PAIRING, tcAddress: 'tc-key-abc' });
      await renderExpandedSettings();
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() })).toBeTruthy(),
      );

      mocks.mockSettingsUpdate.mockResolvedValueOnce([]);
      await fireEvent.click(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() }));

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ['192.168.1.2', '127.0.0.1'] },
          { path: 'server.tunnel.enabled', value: false },
          { path: 'server.tunnel.only', value: false },
        ]);
      });
    });

    it('hides the tunnel toggle on daemons without tunnel support', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows());
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await openNetworks();

      expect(screen.queryByRole('switch', { name: m.settings_tunnel_enable_label() })).toBeNull();
    });

    it('renders no DERP relay URL field (config.toml only)', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: true, only: false }));
      mocks.mockPairingInfo.mockResolvedValue({ ...PAIRING, tcAddress: 'tc-key-abc' });
      await renderExpandedSettings();
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() })).toBeTruthy(),
      );

      expect(screen.queryByRole('textbox', { name: /derp/i })).toBeNull();
      expect(screen.queryByLabelText(/derp/i)).toBeNull();
    });

    it('load-repair: a bindAddress without loopback renders 127.0.0.1 checked+locked and the next change persists it', async () => {
      // Daemon state persisted before the always-bound rule: tunnel enabled
      // but server.bindAddress carries only a specific IP.
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: true, only: false }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await openNetworks();

      const loopback = screen.getByRole('option', {
        name: m.settings_listenTargets_loopback_label(),
      }) as HTMLButtonElement;
      expect(isNetworkSelected(loopback)).toBe(true);
      expect(loopback.hasAttribute('data-disabled')).toBe(true);

      mocks.mockSettingsUpdate.mockResolvedValueOnce([]);
      await pickNetwork('10.0.0.5');

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ['192.168.1.2', '10.0.0.5', '127.0.0.1'] },
          { path: 'server.tunnel.enabled', value: true },
          { path: 'server.tunnel.only', value: false },
        ]);
      });
    });

    it('renders the tunnel-only posture on reload: no direct listeners are presented', async () => {
      // server.tunnel.only=true deliberately leaves server.bindAddress
      // persisted for later restoration — the UI must not present those IPs
      // as selected networks while tunnel-only is active.
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: true, only: true }));
      mocks.mockPairingInfo.mockResolvedValue({ ...PAIRING, tcAddress: 'tc-key-abc' });
      await renderExpandedSettings();

      await waitFor(() =>
        expect(
          screen
            .getByRole('switch', { name: m.settings_tunnel_enable_label() })
            .getAttribute('aria-checked'),
        ).toBe('true'),
      );
      await openNetworks();
      expect(isNetworkSelected(screen.getByRole('option', { name: '192.168.1.2' }))).toBe(false);
      expect(screen.getByText(m.settings_listenTargets_tunnelOnly_note())).toBeTruthy();
    });

    it('includes tc= in the QR pairing URI when the daemon reports a tunnel address', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: true, only: false }));
      mocks.mockPairingInfo.mockResolvedValue({ ...PAIRING, tcAddress: 'tc-key-abc' });
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByText(m.settings_wsApi_showQrCode())).toBeTruthy());

      await fireEvent.click(screen.getByText(m.settings_wsApi_showQrCode()));

      await waitFor(() => {
        expect(qrMocks.toDataURL).toHaveBeenCalledWith(
          expect.stringContaining('&tc=tc-key-abc'),
          expect.anything(),
        );
      });
    });

    it('omits tc= from the QR pairing URI when the daemon reports none', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows());
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByText(m.settings_wsApi_showQrCode())).toBeTruthy());

      await fireEvent.click(screen.getByText(m.settings_wsApi_showQrCode()));

      await waitFor(() => expect(qrMocks.toDataURL).toHaveBeenCalled());
      expect(qrMocks.toDataURL.mock.calls[0][0]).not.toContain('tc=');
    });

    it('copies the Tailcat address from the row copy button', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: true, only: false }));
      mocks.mockPairingInfo.mockResolvedValue({ ...PAIRING, tcAddress: 'tc-key-abc' });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByText('tc-key-abc')).toBeTruthy());

      await fireEvent.click(screen.getByTitle(m.settings_tunnel_tcAddress_copy()));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('tc-key-abc'));
    });

    it('hides the Tailcat address row when the daemon reports none', async () => {
      // Old daemons (no tcAddress in pairing info) and tunnel-down states
      // render no row at all.
      mocks.mockSettingsList.mockResolvedValue(settingsRows());
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();

      await waitFor(() =>
        expect(screen.getByText(m.settings_wsApi_tlsFingerprint_label())).toBeTruthy(),
      );
      expect(screen.queryByText(m.settings_tunnel_tcAddress_label())).toBeNull();
    });

    it('hides the Tailcat address row while the tunnel toggle is off, even if an address is reported', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ enabled: false, only: false }));
      mocks.mockPairingInfo.mockResolvedValue({ ...PAIRING, tcAddress: 'tc-key-abc' });
      await renderExpandedSettings();

      await waitFor(() =>
        expect(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() })).toBeTruthy(),
      );
      expect(screen.queryByText(m.settings_tunnel_tcAddress_label())).toBeNull();
      expect(screen.queryByText('tc-key-abc')).toBeNull();
    });
  });

  describe('share link', () => {
    const expectedLink =
      'intent://pair?token=token%2B%26%3F&host=192.0.2.10,2001%3Adb8%3A%3A1&port=5181&path=/ws&certFingerprint=AA%3ABB';
    async function renderPairing(tcAddress = '') {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.mockPairingInfo.mockResolvedValue({
        token: 'token+&?',
        port: 5181,
        certFingerprint: 'AA:BB',
        localIps: ['192.0.2.10', '2001:db8::1'],
        hostname: 'my-mac',
        tcAddress,
      });
      render(WebSocketApiSettings);
      const button = await screen.findByRole('button', {
        name: m.settings_wsApi_shareLink_label(),
      });
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      return button;
    }

    it.each(['', 'tc-key+/='])(
      'copies exactly the QR pairing URI, with tunnel address %s',
      async (tcAddress) => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        const button = await renderPairing(tcAddress);
        await fireEvent.click(button);
        const expected = expectedLink + (tcAddress ? '&tc=tc-key%2B%2F%3D' : '');
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
        expect(mockToast.success).toHaveBeenCalledWith(m.settings_wsApi_shareLink_copied());
        await fireEvent.click(screen.getByRole('button', { name: m.settings_wsApi_showQrCode() }));
        await waitFor(() =>
          expect(qrMocks.toDataURL).toHaveBeenCalledWith(expected, expect.anything()),
        );
      },
    );

    it('reports a clipboard failure without claiming success or opening the QR overlay', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
      Object.assign(navigator, { clipboard: { writeText } });
      const button = await renderPairing();
      await fireEvent.click(button);
      await waitFor(() =>
        expect(mockToast.error).toHaveBeenCalledWith(m.settings_wsApi_shareLink_copyError()),
      );
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(qrMocks.toDataURL).not.toHaveBeenCalled();
    });

    it('does not offer copying before pairing details have loaded', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      let resolvePairing!: (value: unknown) => void;
      mocks.mockPairingInfo.mockReturnValue(
        new Promise((resolve) => {
          resolvePairing = resolve;
        }),
      );
      render(WebSocketApiSettings);
      const button = await screen.findByRole('button', {
        name: m.settings_wsApi_shareLink_label(),
      });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      resolvePairing({
        token: 'token',
        port: 5181,
        certFingerprint: '',
        localIps: [],
        hostname: 'my-mac',
      });
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    });
  });

  describe('Available Networks', () => {
    const PAIRING = {
      token: 'tok-1234567890',
      port: 5181,
      certFingerprint: 'AA:BB',
      localIps: ['192.168.1.2', '10.0.0.5'],
      hostname: 'my-mac',
    };
    const LOCAL_NETWORK = () => m.settings_wsApi_localNetworkAccess_label();

    function settingsRows(opts: {
      enabled?: boolean;
      bindAddress?: string[] | null;
      tunnel?: { enabled: boolean; only: boolean };
    }) {
      const rows: { path: string; value: unknown }[] = [
        { path: 'server.wsApi.enabled', value: opts.enabled ?? true },
        { path: 'server.wsApi.port', value: 5181 },
      ];
      if (opts.bindAddress !== null) {
        rows.push({ path: 'server.bindAddress', value: opts.bindAddress ?? ['192.168.1.2'] });
      }
      if (opts.tunnel) {
        rows.push({ path: 'server.tunnel.enabled', value: opts.tunnel.enabled });
        rows.push({ path: 'server.tunnel.only', value: opts.tunnel.only });
        rows.push({ path: 'server.tunnel.derpUrl', value: '' });
      }
      return rows;
    }

    it.each([['127.0.0.1'], ['192.168.1.2'], ['0.0.0.0']])(
      'keeps the multiselect usable for bind address %s',
      async (ip) => {
        mocks.mockSettingsList.mockResolvedValue(settingsRows({ bindAddress: [ip] }));
        mocks.mockPairingInfo.mockResolvedValue(PAIRING);
        await renderExpandedSettings();
        await openNetworks();
        expect(screen.queryByRole('switch', { name: LOCAL_NETWORK() })).toBeNull();
        expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
      },
    );

    it.each(['192.168.1.2', '127.0.0.1'])('selecting %s replaces All interfaces', async (ip) => {
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ bindAddress: ['0.0.0.0'], tunnel: { enabled: true, only: false } }),
      );
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await openNetworks();
      const ips = ip === '127.0.0.1' ? [ip] : [ip, '127.0.0.1'];
      mocks.mockSettingsUpdate.mockResolvedValue([]);
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ bindAddress: ips, tunnel: { enabled: true, only: false } }),
      );
      await pickNetwork(ip === '127.0.0.1' ? m.settings_listenTargets_loopback_label() : ip);
      await waitFor(() =>
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ips },
          { path: 'server.tunnel.enabled', value: true },
          { path: 'server.tunnel.only', value: false },
        ]),
      );
      await waitFor(() =>
        expect(
          isNetworkSelected(
            screen.getByRole('option', {
              name: m.settings_listenTargets_allInterfaces_label(),
            }),
          ),
        ).toBe(false),
      );
    });

    it('narrows All interfaces to localhost and then adds specific networks without hiding the selector', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ bindAddress: ['0.0.0.0'], tunnel: { enabled: true, only: false } }),
      );
      mocks.mockPairingInfo.mockResolvedValue({
        ...PAIRING,
        localIps: [],
        availableIps: ['192.168.1.2', '10.0.0.5'],
      });
      await renderExpandedSettings();
      await openNetworks();
      mocks.mockSettingsUpdate.mockResolvedValue([]);
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ bindAddress: ['127.0.0.1'], tunnel: { enabled: true, only: false } }),
      );
      await pickNetwork(m.settings_listenTargets_allInterfaces_label());
      await waitFor(() =>
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ['127.0.0.1'] },
          { path: 'server.tunnel.enabled', value: true },
          { path: 'server.tunnel.only', value: false },
        ]),
      );
      await waitFor(() =>
        expect(
          screen
            .getByRole('combobox', { name: m.settings_listenTargets_label() })
            .hasAttribute('disabled'),
        ).toBe(false),
      );
      await openNetworks();
      expect(screen.getByRole('option', { name: '10.0.0.5' }).hasAttribute('data-disabled')).toBe(
        false,
      );
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({
          bindAddress: ['127.0.0.1', '10.0.0.5'],
          tunnel: { enabled: true, only: false },
        }),
      );
      await pickNetwork('10.0.0.5');
      await waitFor(() =>
        expect(mocks.mockSettingsUpdate).toHaveBeenLastCalledWith([
          { path: 'server.bindAddress', value: ['127.0.0.1', '10.0.0.5'] },
          { path: 'server.tunnel.enabled', value: true },
          { path: 'server.tunnel.only', value: false },
        ]),
      );
      await waitFor(() =>
        expect(isNetworkSelected(screen.getByRole('option', { name: '10.0.0.5' }))).toBe(true),
      );
    });

    it.each([true, false])(
      'uses availableIps when present (%s) and keeps pairing hosts bound-only',
      async (withAvailableIps) => {
        mocks.mockSettingsList.mockResolvedValue(
          settingsRows({ bindAddress: ['192.168.1.2', '127.0.0.1'] }),
        );
        mocks.mockPairingInfo.mockResolvedValue({
          ...PAIRING,
          localIps: ['192.168.1.2'],
          ...(withAvailableIps ? { availableIps: ['192.168.1.2', '10.0.0.5'] } : {}),
        });
        await renderExpandedSettings();
        await openNetworks();
        expect(isNetworkSelected(screen.getByRole('option', { name: '192.168.1.2' }))).toBe(true);
        expect(screen.queryByRole('option', { name: '10.0.0.5' }) !== null).toBe(withAvailableIps);
        await fireEvent.keyDown(
          screen.getByRole('combobox', { name: m.settings_listenTargets_label() }),
          { key: 'Escape' },
        );
        await fireEvent.click(screen.getByText(m.settings_wsApi_showQrCode()));
        await waitFor(() => expect(qrMocks.toDataURL).toHaveBeenCalled());
        expect(qrMocks.toDataURL.mock.calls[0][0]).toContain('&host=192.168.1.2&');
        expect(qrMocks.toDataURL.mock.calls[0][0]).not.toContain('10.0.0.5');
      },
    );

    it('offers no network control when bindAddress is unsupported', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ bindAddress: null }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await waitFor(() =>
        expect(screen.getByText(m.settings_wsApi_tlsFingerprint_label())).toBeTruthy(),
      );
      expect(screen.queryByRole('combobox', { name: m.settings_listenTargets_label() })).toBeNull();
    });

    it('selecting All interfaces from tunnel-only enables direct listeners and preserves the tunnel', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ bindAddress: ['192.168.1.2'], tunnel: { enabled: true, only: true } }),
      );
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await openNetworks();
      mocks.mockSettingsUpdate.mockResolvedValue([]);
      await pickNetwork(m.settings_listenTargets_allInterfaces_label());
      await waitFor(() =>
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ['0.0.0.0'] },
          { path: 'server.tunnel.enabled', value: true },
          { path: 'server.tunnel.only', value: false },
        ]),
      );
    });

    it('preserves an IPv6 wildcard when toggling the tunnel', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ bindAddress: ['::'], tunnel: { enabled: false, only: false } }),
      );
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() })).toBeTruthy(),
      );
      mocks.mockSettingsUpdate.mockResolvedValue([]);
      await fireEvent.click(screen.getByRole('switch', { name: m.settings_tunnel_enable_label() }));
      await waitFor(() =>
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'server.bindAddress', value: ['::'] },
          { path: 'server.tunnel.enabled', value: true },
          { path: 'server.tunnel.only', value: false },
        ]),
      );
    });

    it('disables the multiselect while the Remote Access toggle is saving', async () => {
      mocks.mockSettingsList.mockResolvedValue(settingsRows({}));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await renderExpandedSettings();
      const toggle = await screen.findByRole('switch', { name: m.settings_wsApi_enable_label() });
      await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
      let resolveUpdate!: (value: unknown) => void;
      mocks.mockSettingsUpdate.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
      );
      await fireEvent.click(toggle);
      expect(
        (
          screen.getByRole('combobox', {
            name: m.settings_listenTargets_label(),
          }) as HTMLInputElement
        ).disabled,
      ).toBe(true);
      resolveUpdate([{ path: 'server.wsApi.enabled', value: false }]);
      await waitFor(() =>
        expect(
          screen.queryByRole('combobox', { name: m.settings_listenTargets_label() }),
        ).toBeNull(),
      );
    });

    it('first enable from a loopback-only daemon defaults bindAddress to [0.0.0.0] with the tunnel untouched', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({
          enabled: false,
          bindAddress: ['127.0.0.1'],
          tunnel: { enabled: false, only: false },
        }),
      );
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: true },
      ]);
      mocks.mockSettingsUpdate.mockResolvedValueOnce([]);
      // Post-enable re-sync still reports loopback-only; the re-sync after the
      // default write reports the widened bind set.
      mocks.mockSettingsList.mockResolvedValueOnce(
        settingsRows({ bindAddress: ['127.0.0.1'], tunnel: { enabled: false, only: false } }),
      );
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ bindAddress: ['0.0.0.0'], tunnel: { enabled: false, only: false } }),
      );
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await fireEvent.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenNthCalledWith(1, [
          { path: 'server.wsApi.enabled', value: true },
        ]);
        expect(mocks.mockSettingsUpdate).toHaveBeenNthCalledWith(2, [
          { path: 'server.bindAddress', value: ['0.0.0.0'] },
        ]);
      });
      // The bind change rebinds listeners → pairing info is re-fetched.
      await waitFor(() => expect(mocks.mockPairingInfo).toHaveBeenCalledTimes(2));
      await openNetworks();
      expect(
        isNetworkSelected(
          screen.getByRole('option', {
            name: m.settings_listenTargets_allInterfaces_label(),
          }),
        ),
      ).toBe(true);
      expect(
        screen
          .getByRole('switch', { name: m.settings_tunnel_enable_label() })
          .getAttribute('aria-checked'),
      ).toBe('false');
    });

    it('first enable leaves a bindAddress already customized beyond loopback alone', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ enabled: false, bindAddress: ['192.168.1.2'] }),
      );
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: true },
      ]);
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ bindAddress: ['192.168.1.2'] }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await fireEvent.click(screen.getByRole('switch', { name: m.settings_wsApi_enable_label() }));

      await openNetworks();
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ path: 'server.bindAddress' })]),
      );
    });

    it('a failed first-enable default surfaces a toast without rolling back the WebSocket API toggle', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ enabled: false, bindAddress: ['127.0.0.1'] }),
      );
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: true },
      ]);
      mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('daemon says no'));
      mocks.mockSettingsList.mockResolvedValue(settingsRows({ bindAddress: ['127.0.0.1'] }));
      mocks.mockPairingInfo.mockResolvedValue(PAIRING);
      await fireEvent.click(screen.getByRole('switch'));

      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
      expect(
        screen
          .getByRole('switch', { name: m.settings_wsApi_enable_label() })
          .getAttribute('aria-checked'),
      ).toBe('true');
    });

    it('first enable skips the 0.0.0.0 default when tunnel-only is persisted', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({
          enabled: false,
          bindAddress: ['127.0.0.1'],
          tunnel: { enabled: true, only: true },
        }),
      );
      await renderExpandedSettings();
      await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'server.wsApi.enabled', value: true },
      ]);
      mocks.mockSettingsList.mockResolvedValue(
        settingsRows({ bindAddress: ['127.0.0.1'], tunnel: { enabled: true, only: true } }),
      );
      mocks.mockPairingInfo.mockResolvedValue({ ...PAIRING, tcAddress: 'tc-key-abc' });
      await fireEvent.click(screen.getByRole('switch', { name: m.settings_wsApi_enable_label() }));

      await openNetworks();
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ path: 'server.bindAddress' })]),
      );
      expect(screen.getByText(m.settings_listenTargets_tunnelOnly_note())).toBeTruthy();
    });
  });
});

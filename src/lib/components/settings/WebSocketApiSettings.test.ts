/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import WebSocketApiSettings from './WebSocketApiSettings.svelte';

// Mock appClient - use vi.hoisted to avoid hoisting issues
const mocks = vi.hoisted(() => ({
  mockSettingsList: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockPairingInfo: vi.fn(),
  mockRotateToken: vi.fn(),
}));

vi.mock('$lib/client', () => ({
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

vi.mock('svelte-sonner', () => ({
  toast: mockToast,
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
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows toast.error when settings.update rejects on toggle enable', async () => {
    // Arrange: initial state with WSS disabled
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    render(WebSocketApiSettings);

    await waitFor(() => {
      expect(screen.getByText('Enable WebSocket API')).toBeTruthy();
    });

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
    });
  });

  it('shows toast.error with daemon message when settings.update returns rolled-back value', async () => {
    // Arrange: initial state with WSS disabled
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    render(WebSocketApiSettings);

    await waitFor(() => {
      expect(screen.getByText('Enable WebSocket API')).toBeTruthy();
    });

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
    });
  });

  it('always shows port row even when WSS is disabled', async () => {
    // Arrange: WSS disabled
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    render(WebSocketApiSettings);

    // Assert: port row is visible
    await waitFor(() => {
      expect(screen.getByText('Port')).toBeTruthy();
    });
  });

  it('delegates the outer surface and padding to SettingsSection', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    const { container } = render(WebSocketApiSettings);
    await waitFor(() => expect(screen.getByText('Port')).toBeTruthy());

    const root = container.querySelector('[data-settings-websocket-api]');
    expect(root?.className).toContain('gap-4');
    expect(root?.className).not.toContain('bg-card');
    expect(root?.className).not.toContain('divide-y');
    expect(root?.querySelector('.px-6')).toBeNull();
  });

  it('shows Save button when port value differs from persisted setting, and clicking Save calls settings.update', async () => {
    // Arrange: WSS disabled, port 5181
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    mocks.mockSettingsUpdate.mockResolvedValueOnce([{ path: 'server.wsApi.port', value: 5182 }]);

    render(WebSocketApiSettings);

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

    // Assert: success toast was shown
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('saved'));
    });
  });

  it('hides Save button when the persisted port value is retyped (#814)', async () => {
    // Arrange: WSS disabled, port 5181
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    render(WebSocketApiSettings);

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
      render(WebSocketApiSettings);
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
      render(WebSocketApiSettings);
      mocks.mockSettingsUpdate.mockResolvedValueOnce([{ path: 'server.wsApi.port', value: 5182 }]);

      const portInput = await waitFor(() => screen.getByDisplayValue('5181') as HTMLInputElement);
      await fireEvent.input(portInput, { target: { value: '5182' } });
      await fireEvent.click(await waitFor(() => screen.getByText('Save')));

      await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
      expect(ipcMocks.invoke).not.toHaveBeenCalledWith('connections:refresh-self');
    });
  });

  describe('remote connection (intent-hq/monorepo#1852)', () => {
    it('renders info-only panel, never calls the daemon, and shows no error toast', async () => {
      // Arrange: active connection is remote
      connectionState.activeId = 'remote-1';

      render(WebSocketApiSettings);

      // Assert: info-only panel is rendered
      await waitFor(() => {
        expect(
          screen.getByText(
            'WebSocket API settings are managed on the machine running the daemon and are only available when connected locally.',
          ),
        ).toBeTruthy();
      });

      // Assert: no interactive controls (toggle, port input)
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.queryByText('Port')).toBeNull();

      // Assert: no daemon calls at all — server.pairingInfo is local-only
      expect(mocks.mockSettingsList).not.toHaveBeenCalled();
      expect(mocks.mockPairingInfo).not.toHaveBeenCalled();

      // Assert: no error toast
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('keeps local behavior unchanged: loads settings and pairing info when enabled', async () => {
      // Arrange: local connection (default), WSS enabled
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);
      mocks.mockPairingInfo.mockResolvedValue({
        token: 'tok-1234567890',
        port: 5181,
        certFingerprint: 'AA:BB',
        localIps: ['192.168.1.2'],
        hostname: 'my-mac',
      });

      render(WebSocketApiSettings);

      // Assert: toggle rendered and pairing info fetched
      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeTruthy();
        expect(mocks.mockPairingInfo).toHaveBeenCalled();
      });

      // Assert: no remote info panel, no error toast
      expect(
        screen.queryByText(
          'WebSocket API settings are managed on the machine running the daemon and are only available when connected locally.',
        ),
      ).toBeNull();
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('remote→local switch while mounted triggers a fresh status load', async () => {
      // Arrange: start remote — no daemon calls
      connectionState.activeId = 'remote-1';
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'server.wsApi.enabled', value: false },
        { path: 'server.wsApi.port', value: 5181 },
      ]);

      render(WebSocketApiSettings);

      await waitFor(() => {
        expect(
          screen.getByText(
            'WebSocket API settings are managed on the machine running the daemon and are only available when connected locally.',
          ),
        ).toBeTruthy();
      });
      expect(mocks.mockSettingsList).not.toHaveBeenCalled();

      // Act: switch to local while the component stays mounted
      connectionState.activeId = 'local';
      connectionState.emit();

      // Assert: fresh status load ran and the controls rendered
      await waitFor(() => {
        expect(mocks.mockSettingsList).toHaveBeenCalled();
        expect(screen.getByRole('switch')).toBeTruthy();
      });
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('local→remote switch mid-loadStatus never calls pairingInfo and shows no toast', async () => {
      // Arrange: local connection; settings.list resolves only when we say so
      let resolveSettingsList!: (value: { path: string; value: unknown }[]) => void;
      mocks.mockSettingsList.mockReturnValue(
        new Promise<{ path: string; value: unknown }[]>((resolve) => {
          resolveSettingsList = resolve;
        }),
      );

      render(WebSocketApiSettings);

      await waitFor(() => {
        expect(mocks.mockSettingsList).toHaveBeenCalled();
      });

      // Act: switch to remote while settings.list is still in flight, then
      // resolve it with wsApi enabled (which would normally fetch pairingInfo)
      connectionState.activeId = 'remote-1';
      connectionState.emit();
      resolveSettingsList([
        { path: 'server.wsApi.enabled', value: true },
        { path: 'server.wsApi.port', value: 5181 },
      ]);

      // Assert: info-only panel rendered; the stale load was dropped
      await waitFor(() => {
        expect(
          screen.getByText(
            'WebSocket API settings are managed on the machine running the daemon and are only available when connected locally.',
          ),
        ).toBeTruthy();
      });
      expect(mocks.mockPairingInfo).not.toHaveBeenCalled();
      expect(mockToast.error).not.toHaveBeenCalled();
    });
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
      render(WebSocketApiSettings);
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
      render(WebSocketApiSettings);
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
      render(WebSocketApiSettings);
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
      render(WebSocketApiSettings);
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
});

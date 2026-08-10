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

// Mock the store so selectActiveConnectionId resolves; tests flip
// `connectionState.activeId` to simulate a remote connection.
const connectionState = vi.hoisted(() => ({ activeId: 'local' }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  return {
    get store() {
      return createAppStoreMock({
        state: () => ({ connections: { activeId: connectionState.activeId } }),
      });
    },
  };
});

describe('WebSocketApiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionState.activeId = 'local';
  });

  afterEach(() => {
    cleanup();
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
      new Error('Port 5181 is already in use — choose a different port or stop the process using it')
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
        expect.stringContaining('Port 5181 is already in use')
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

  it('shows Save button when port value differs from persisted setting, and clicking Save calls settings.update', async () => {
    // Arrange: WSS disabled, port 5181
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);

    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'server.wsApi.port', value: 5182 },
    ]);

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
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('saved')
      );
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

  describe('remote connection (intent-hq/monorepo#1852)', () => {
    it('renders info-only panel, never calls the daemon, and shows no error toast', async () => {
      // Arrange: active connection is remote
      connectionState.activeId = 'remote-1';

      render(WebSocketApiSettings);

      // Assert: info-only panel is rendered
      await waitFor(() => {
        expect(
          screen.getByText(
            'WebSocket API settings are managed on the machine running the daemon and are only available when connected locally.'
          )
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
          'WebSocket API settings are managed on the machine running the daemon and are only available when connected locally.'
        )
      ).toBeNull();
      expect(mockToast.error).not.toHaveBeenCalled();
    });
  });
});

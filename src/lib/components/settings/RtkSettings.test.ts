/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import RtkSettings from './RtkSettings.svelte';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';

// Mock appClient and IPC invoke
const mocks = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockTerminalsCreate: vi.fn(),
  mockTerminalsWrite: vi.fn(),
  mockInvoke: vi.fn(),
  mockDispatch: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: mocks.mockSettingsGet,
      update: mocks.mockSettingsUpdate,
    },
    terminals: {
      create: mocks.mockTerminalsCreate,
      write: mocks.mockTerminalsWrite,
    },
  },
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: mocks.mockInvoke,
}));

// Mock store - minimal implementation
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.mockDispatch,
    createSelector: vi.fn((fn) => fn),
    state: {},
  },
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: mocks.mockToastError, warning: vi.fn() },
}));

describe('RtkSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads rtk.enabled from daemon settings catalog on mount', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: true });
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });

    render(RtkSettings);

    await waitFor(() => {
      expect(mocks.mockSettingsGet).toHaveBeenCalledWith('rtk.enabled');
    });
  });

  it('defaults to false when settings.get returns no value', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: undefined });
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });

    render(RtkSettings);

    const toggle = await screen.findByRole('switch');
    expect(toggle.getAttribute('data-state')).toBe('off');
  });

  it('calls settings.update with correct arguments when toggle is clicked', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: false });
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'rtk.enabled', value: true }]);

    render(RtkSettings);

    const toggle = await screen.findByRole('switch');
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'rtk.enabled', value: true },
      ]);
    });
  });

  it('toggles from enabled to disabled', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: true });
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'rtk.enabled', value: false }]);

    render(RtkSettings);

    const toggle = await screen.findByRole('switch');
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'rtk.enabled', value: false },
      ]);
    });
  });

  it('checks rtk availability via system:check-rtk IPC', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: false });
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });

    render(RtkSettings);

    await waitFor(() => {
      expect(mocks.mockInvoke).toHaveBeenCalledWith(SYSTEM_CHANNELS.CHECK_RTK, undefined);
    });
  });

  it('disables toggle when rtk is not available', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: false });
    mocks.mockInvoke.mockResolvedValue({ data: { available: false } });

    render(RtkSettings);

    const toggle = await screen.findByRole('switch');
    expect(toggle.hasAttribute('disabled')).toBe(true);
  });

  it('shows "rtk is not installed" message when unavailable', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: false });
    mocks.mockInvoke.mockResolvedValue({ data: { available: false } });

    render(RtkSettings);

    await waitFor(() => {
      expect(screen.getByText(/rtk is not installed/)).toBeTruthy();
    });
  });

  it('handles settings.get null return (real client behavior on transport failure)', async () => {
    mocks.mockSettingsGet.mockResolvedValue(null);
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });

    render(RtkSettings);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load RTK settings from the daemon/)).toBeTruthy();
    });
  });

  // Review fix (PR #705): a failed daemon-first `terminal.create` must not
  // fabricate a local-id tab or toggle the overlay — Redux terminal tabs are
  // keyed by daemon-assigned ids that hydration (`terminal.list`) matches.
  describe('installRtk create-failure fallback', () => {
    async function renderUnavailableAndClickInstall() {
      mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: false });
      mocks.mockInvoke.mockResolvedValue({ data: { available: false } });

      render(RtkSettings);

      const installButton = await screen.findByText('brew install rtk');
      await fireEvent.click(installButton);
      await waitFor(() => {
        expect(mocks.mockTerminalsCreate).toHaveBeenCalled();
      });
    }

    it('does not dispatch any terminal action when terminal.create reports failure', async () => {
      mocks.mockTerminalsCreate.mockResolvedValue({ success: false, error: 'boom' });

      await renderUnavailableAndClickInstall();

      expect(mocks.mockDispatch).not.toHaveBeenCalled();
      expect(mocks.mockToastError).toHaveBeenCalled();
    });

    it('does not dispatch any terminal action when terminal.create throws', async () => {
      mocks.mockTerminalsCreate.mockRejectedValue(new Error('transport down'));

      await renderUnavailableAndClickInstall();

      expect(mocks.mockDispatch).not.toHaveBeenCalled();
      expect(mocks.mockToastError).toHaveBeenCalled();
    });

    it('dispatches daemon-id-keyed tab actions on success', async () => {
      mocks.mockTerminalsCreate.mockResolvedValue({ success: true, id: 'pty-daemon-7' });
      mocks.mockTerminalsWrite.mockResolvedValue({ success: true });

      await renderUnavailableAndClickInstall();

      await waitFor(() => {
        expect(mocks.mockDispatch).toHaveBeenCalled();
      });
      const dispatched = mocks.mockDispatch.mock.calls.map(
        (call) => call[0] as { type: string; payload: unknown[] },
      );
      const addAction = dispatched.find((action) => action.type === 'terminals/addTerminal');
      expect(addAction?.payload[1]).toBe('pty-daemon-7');
      expect(mocks.mockToastError).not.toHaveBeenCalled();
    });
  });

  it('reverts toggle state when settings.update fails', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'rtk.enabled', value: false });
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });
    mocks.mockSettingsUpdate.mockRejectedValue(new Error('Network error'));

    render(RtkSettings);

    const toggle = await screen.findByRole('switch');
    expect(toggle.getAttribute('data-state')).toBe('off');

    await fireEvent.click(toggle);

    await waitFor(() => {
      // Toggle should remain off since update failed
      expect(toggle.getAttribute('data-state')).toBe('off');
      // Error message should be displayed
      expect(screen.getByText(/Failed to save RTK setting/)).toBeTruthy();
    });

    // settings.update should have been attempted
    expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
      { path: 'rtk.enabled', value: true },
    ]);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import RtkSettings from './RtkSettings.svelte';

// Mock appClient and IPC invoke
const mocks = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: mocks.mockSettingsGet,
      update: mocks.mockSettingsUpdate,
    },
  },
}));

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: mocks.mockInvoke,
}));

// Mock store - minimal implementation
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: vi.fn(),
    createSelector: vi.fn((fn) => fn),
    state: {},
  },
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

  it('issues settings.update with exact request shape when toggle is clicked', async () => {
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
      expect(mocks.mockInvoke).toHaveBeenCalledWith('system:check-rtk', undefined);
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

  it('handles settings.get errors gracefully', async () => {
    mocks.mockSettingsGet.mockRejectedValue(new Error('Network error'));
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });

    render(RtkSettings);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load RTK settings from the daemon/)).toBeTruthy();
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

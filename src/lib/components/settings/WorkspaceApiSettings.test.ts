/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import WorkspaceApiSettings from './WorkspaceApiSettings.svelte';

// Mock appClient - use vi.hoisted to avoid hoisting issues
const mocks = vi.hoisted(() => ({
  mockSettingsList: vi.fn(),
  mockSettingsUpdate: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      list: mocks.mockSettingsList,
      update: mocks.mockSettingsUpdate,
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

describe('WorkspaceApiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default daemon state (PROTOCOL §5.12 settings.list entries)
    mocks.mockSettingsList.mockResolvedValue([
      { path: 'workspaceApi.maxOutputChars', value: 100000 },
      { path: 'workspaceApi.toonOutput', value: true },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('toggling TOON output off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'workspaceApi.toonOutput', value: false },
    ]);

    render(WorkspaceApiSettings);

    const toggle = await waitFor(() => screen.getByRole('switch'));
    await fireEvent.click(toggle);

    // Assert: settings.update was called with exact payload
    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspaceApi.toonOutput', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('shows toast.error and reverts toggle when the daemon returns a rolled-back value', async () => {
    // Daemon rolled back to true when toggling off
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'workspaceApi.toonOutput', value: true },
    ]);

    render(WorkspaceApiSettings);

    const toggle = await waitFor(() => screen.getByRole('switch'));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    // Toggle remains checked (rolled back to true)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('shows Save when max output chars differs, and clicking Save sends the exact request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'workspaceApi.maxOutputChars', value: 250000 },
    ]);

    render(WorkspaceApiSettings);

    const input = await waitFor(() => screen.getByDisplayValue('100000') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '250000' } });

    const saveButton = await waitFor(() => screen.getByText('Save'));
    await fireEvent.click(saveButton);

    // Assert: settings.update was called with exact payload
    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspaceApi.maxOutputChars', value: 250000 },
      ]);
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('saved'));
    });
  });

  it('shows validation error and disables Save for a non-zero value below 1000', async () => {
    render(WorkspaceApiSettings);

    const input = await waitFor(() => screen.getByDisplayValue('100000') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '500' } });

    // Validation message is shown and Save is disabled
    const saveButton = await waitFor(() => screen.getByText('Save') as HTMLButtonElement);
    expect(saveButton.disabled).toBe(true);
    expect(
      screen.getByText('Must be 0 (unlimited) or an integer between 1000 and 10,000,000'),
    ).toBeTruthy();
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('accepts 0 as unlimited and sends it on Save', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'workspaceApi.maxOutputChars', value: 0 },
    ]);

    render(WorkspaceApiSettings);

    const input = await waitFor(() => screen.getByDisplayValue('100000') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '0' } });

    const saveButton = await waitFor(() => screen.getByText('Save'));
    await fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspaceApi.maxOutputChars', value: 0 },
      ]);
    });
  });

  it('shows toast.error with the daemon message and reverts input when settings.update rejects', async () => {
    mocks.mockSettingsUpdate.mockRejectedValueOnce(
      new Error('workspaceApi.maxOutputChars must be 0 or between 1000 and 10000000'),
    );

    render(WorkspaceApiSettings);

    const input = await waitFor(() => screen.getByDisplayValue('100000') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '250000' } });

    const saveButton = await waitFor(() => screen.getByText('Save'));
    await fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringContaining('workspaceApi.maxOutputChars must be 0'),
      );
    });

    // Input reverts to the persisted value
    await waitFor(() => {
      expect(screen.getByDisplayValue('100000')).toBeTruthy();
    });
  });
});

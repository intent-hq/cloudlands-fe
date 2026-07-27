/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import GitWorkspaceSettings from './GitWorkspaceSettings.svelte';

// Mock appClient - use vi.hoisted to avoid hoisting issues
const mocks = vi.hoisted(() => ({
  mockSettingsList: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockCapabilities: vi.fn(),
  mockDispatch: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      list: mocks.mockSettingsList,
      update: mocks.mockSettingsUpdate,
    },
    system: {
      capabilities: mocks.mockCapabilities,
    },
  },
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.mockDispatch },
}));

vi.mock('$store/renderer/slices/workspace-settings/workspace-settings-slice', () => ({
  refreshAutoCommitSettings: () => ({ type: 'workspaceSettings/refreshAutoCommitSettings' }),
}));

const GIT_CRED_PATH = 'sourceControl.github.exposeGitCredentialToChildren';
const GIT_CRED_LABEL = /Git credentials in terminals & agents/;

const baseSettings = [
  { path: 'workspace.worktreesLocation', value: '' },
  { path: 'workspace.sshKeyPath', value: '' },
  { path: 'workspace.defaultShell', value: 'auto' },
  { path: 'workspace.autoFetch', value: false },
  { path: 'git.autoCommit', value: true },
  { path: 'workspace.cowIsolation', value: false },
  { path: 'workspace.branchPrefix', value: '' },
];

describe('GitWorkspaceSettings — git credential toggle (§5.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCapabilities.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the toggle checked when the daemon reports the setting as true', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement
    );
    expect(toggle.checked).toBe(true);
  });

  it('renders the toggle unchecked when the daemon reports the setting as false', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: false },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement
    );
    expect(toggle.checked).toBe(false);
  });

  it('renders the toggle unchecked when the daemon reports a non-boolean value (fail-safe)', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: null },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement
    );
    expect(toggle.checked).toBe(false);
  });

  it('hides the toggle when the daemon does not report the setting (older daemon)', async () => {
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);

    render(GitWorkspaceSettings);

    // Wait for load to settle (a sibling toggle is rendered), then assert absence.
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Auto-fetch updates/ })).toBeTruthy();
    });
    expect(screen.queryByRole('checkbox', { name: GIT_CRED_LABEL })).toBeNull();
  });

  it('persists a toggle-off via settings.update with the exact payload', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: GIT_CRED_PATH, value: false }]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(() => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: GIT_CRED_PATH, value: false },
      ]);
    });
  });

  it('surfaces a save error when settings.update rejects', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);
    mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('boom'));

    render(GitWorkspaceSettings);

    const toggle = await waitFor(() => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText('Failed to save settings. Please try again.')).toBeTruthy();
    });
  });
});

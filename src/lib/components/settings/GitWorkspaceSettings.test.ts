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
const COW_LABEL = /Use Copy-on-Write isolation/;

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
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement,
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
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement,
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
      () => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }) as HTMLInputElement,
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

  it('shows the git-credential description as a visible subheading, not a title tooltip', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(() => screen.getByRole('checkbox', { name: GIT_CRED_LABEL }));
    const description = screen.getByText(/credential helper scoped to HTTPS\s+github\.com remotes/);
    expect(description).toBeTruthy();
    expect(description.closest('[title]')).toBeNull();
    expect(description.id).toBe('git-credentials-description');
    expect(toggle.getAttribute('aria-describedby')).toBe('git-credentials-description');
  });
});

describe('GitWorkspaceSettings — CoW isolation toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the toggle with an Experimental pill when capabilities report cowSupported', async () => {
    mocks.mockCapabilities.mockResolvedValue({ cowSupported: true });

    render(GitWorkspaceSettings);

    const toggle = await waitFor(
      () => screen.getByRole('checkbox', { name: COW_LABEL }) as HTMLInputElement,
    );
    expect(toggle.checked).toBe(false);
    const pill = screen.getByText('Experimental');
    expect(pill).toBeTruthy();
    expect(pill.classList.contains('rounded-full')).toBe(true);
  });

  it('shows a visible description without "instant" wording or a title tooltip', async () => {
    mocks.mockCapabilities.mockResolvedValue({ cowSupported: true });

    render(GitWorkspaceSettings);

    const description = await waitFor(() =>
      screen.getByText(/copy-on-write clones of the repository/),
    );
    expect(description.textContent).toMatch(/CoW sandbox/);
    expect(description.textContent).toMatch(
      /APFS on macOS,\s+btrfs\/XFS-reflink on\s+Linux,\s+ReFS\/Dev Drive on Windows/,
    );
    expect(description.textContent).not.toMatch(/instant/i);
    expect(description.closest('[title]')).toBeNull();
    expect(description.id).toBe('cow-isolation-description');
    const toggle = screen.getByRole('checkbox', { name: COW_LABEL });
    expect(toggle.getAttribute('aria-describedby')).toBe('cow-isolation-description');
  });

  it('hides the toggle when capabilities do not report cowSupported', async () => {
    mocks.mockCapabilities.mockResolvedValue({});
    // Include the git-credential setting so a load-gated sibling row appears —
    // waiting for it guarantees both the settings load and the earlier-scheduled
    // capabilities probe have resolved before asserting absence.
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);

    render(GitWorkspaceSettings);

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: GIT_CRED_LABEL })).toBeTruthy();
    });
    expect(screen.queryByRole('checkbox', { name: COW_LABEL })).toBeNull();
    expect(screen.queryByText('Experimental')).toBeNull();
  });

  it('hides the toggle when capabilities report cowSupported as false', async () => {
    mocks.mockCapabilities.mockResolvedValue({ cowSupported: false });
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: GIT_CRED_PATH, value: true },
    ]);

    render(GitWorkspaceSettings);

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: GIT_CRED_LABEL })).toBeTruthy();
    });
    expect(screen.queryByRole('checkbox', { name: COW_LABEL })).toBeNull();
    expect(screen.queryByText('Experimental')).toBeNull();
  });

  it('persists a toggle-on via settings.update with the exact payload', async () => {
    mocks.mockCapabilities.mockResolvedValue({ cowSupported: true });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'workspace.cowIsolation', value: true }]);

    render(GitWorkspaceSettings);

    const toggle = await waitFor(() => screen.getByRole('checkbox', { name: COW_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.cowIsolation', value: true },
      ]);
    });
  });
});

describe('GitWorkspaceSettings — resetToDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCapabilities.mockResolvedValue({ cowSupported: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('resets cowIsolation to false and persists the default via settings.update', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings.filter((setting) => setting.path !== 'workspace.cowIsolation'),
      { path: 'workspace.cowIsolation', value: true },
    ]);
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'workspace.cowIsolation', value: false }]);

    const { component } = render(GitWorkspaceSettings);

    const toggle = await waitFor(
      () => screen.getByRole('checkbox', { name: COW_LABEL }) as HTMLInputElement,
    );
    expect(toggle.checked).toBe(true);

    component.resetToDefaults();

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.cowIsolation', value: false },
      ]);
      expect(toggle.checked).toBe(false);
    });
  });
});

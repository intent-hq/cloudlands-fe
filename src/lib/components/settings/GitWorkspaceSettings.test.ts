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
  // Picker service seam: invoke openModal (remote-modal case) so tests drive
  // selection through the mocked DirectoryPickerModal.
  pickDirectory: vi.fn(async ({ openModal }: { openModal: () => void }) => openModal()),
  pickFile: vi.fn(async ({ openModal }: { openModal: () => void }) => openModal()),
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

vi.mock('$lib/directory-picker-service', () => ({
  pickDirectory: mocks.pickDirectory,
  pickFile: mocks.pickFile,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

// The real modal reads directory listings from the store; stub it with the
// existing mock that renders a "mock select" button reporting /Users/me/src.
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (
    await import('$features/onboarding/messages/__tests__/mocks/MockDirectoryPickerModal.svelte')
  ).default,
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


describe('GitWorkspaceSettings — default shell select', () => {
  const SHELL_TRIGGER = { name: /Default Shell/ };
  const withShell = (value: string) =>
    baseSettings.map((setting) =>
      setting.path === 'workspace.defaultShell' ? { ...setting, value } : setting,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCapabilities.mockResolvedValue({});
    mocks.mockSettingsUpdate.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the trigger with the Auto-detect label when the value is auto', async () => {
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);
    render(GitWorkspaceSettings);

    const trigger = await waitFor(() => screen.getByRole('button', SHELL_TRIGGER));
    expect(trigger.textContent).toContain('Auto-detect (System Default)');
  });

  it('falls back to the raw value for an unknown/custom shell', async () => {
    mocks.mockSettingsList.mockResolvedValue(withShell('/opt/homebrew/bin/nu'));
    render(GitWorkspaceSettings);

    const trigger = await waitFor(() => screen.getByRole('button', SHELL_TRIGGER));
    expect(trigger.textContent).toContain('/opt/homebrew/bin/nu');
  });

  it('persists a selection via settings.update with the exact payload', async () => {
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);
    render(GitWorkspaceSettings);

    const trigger = await waitFor(() => screen.getByRole('button', SHELL_TRIGGER));
    await fireEvent.click(trigger);

    const option = await waitFor(() => screen.getByRole('button', { name: 'Zsh' }));
    await fireEvent.click(option);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.defaultShell', value: '/bin/zsh' },
      ]);
    });
    expect(screen.getByRole('button', SHELL_TRIGGER).textContent).toContain('Zsh');
  });

  it('resetToDefaults resets the value to auto and the trigger label reflects it', async () => {
    mocks.mockSettingsList.mockResolvedValue(withShell('/bin/zsh'));
    const { component } = render(GitWorkspaceSettings);

    const trigger = await waitFor(() => screen.getByRole('button', SHELL_TRIGGER));
    expect(trigger.textContent).toContain('Zsh');

    component.resetToDefaults();

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.defaultShell', value: 'auto' },
      ]);
      expect(screen.getByRole('button', SHELL_TRIGGER).textContent).toContain(
        'Auto-detect (System Default)',
      );
    });
  });
});

describe('GitWorkspaceSettings — path picker fields (PathSettingField)', () => {
  const REDACTED = '********';
  const withValues = (overrides: Record<string, unknown>) =>
    baseSettings.map((setting) =>
      setting.path in overrides ? { ...setting, value: overrides[setting.path] } : setting,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockCapabilities.mockResolvedValue({});
    mocks.mockSettingsUpdate.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('worktrees location: confirm-OK opens the directory picker and writes the picked path', async () => {
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);
    render(GitWorkspaceSettings);

    const browse = await waitFor(() => screen.getByRole('button', { name: 'Choose folder' }));
    await fireEvent.click(browse);

    // New-workspaces-only warning is shown before any picker opens.
    expect(screen.getByText(/applies only to newly created workspaces/)).toBeTruthy();
    expect(mocks.pickDirectory).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(mocks.pickDirectory).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByTestId('mock-picker-select'));
    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.worktreesLocation', value: '/Users/me/src' },
      ]);
    });
  });

  it('worktrees location: confirm-Cancel opens no picker and writes nothing', async () => {
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);
    render(GitWorkspaceSettings);

    const browse = await waitFor(() => screen.getByRole('button', { name: 'Choose folder' }));
    await fireEvent.click(browse);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText(/applies only to newly created workspaces/)).toBeNull();
    });
    expect(mocks.pickDirectory).not.toHaveBeenCalled();
    expect(mocks.pickFile).not.toHaveBeenCalled();
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('worktrees location: clear writes an empty value', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      withValues({ 'workspace.worktreesLocation': '/data/worktrees' }),
    );
    render(GitWorkspaceSettings);

    await waitFor(() => screen.getByRole('button', { name: 'Choose folder' }));
    const [clearWorktrees] = screen.getAllByRole('button', {
      name: 'Clear path and restore default',
    });
    await fireEvent.click(clearWorktrees);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.worktreesLocation', value: '' },
      ]);
    });
  });

  it('ssh key path: file picker opens without confirm, hinting ~/.ssh, and writes the picked path', async () => {
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);
    render(GitWorkspaceSettings);

    const browse = await waitFor(() => screen.getByRole('button', { name: 'Choose file' }));
    await fireEvent.click(browse);

    await waitFor(() => expect(mocks.pickFile).toHaveBeenCalledOnce());
    expect(mocks.pickFile.mock.calls[0][0]).toMatchObject({ defaultPath: '~/.ssh' });
    // No confirm dialog for the SSH key field.
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();

    await fireEvent.click(screen.getByTestId('mock-picker-select'));
    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.sshKeyPath', value: '/Users/me/src' },
      ]);
    });
  });

  it('ssh key path: clear writes an empty value (not the redacted placeholder)', async () => {
    mocks.mockSettingsList.mockResolvedValue(withValues({ 'workspace.sshKeyPath': REDACTED }));
    render(GitWorkspaceSettings);

    await waitFor(() => screen.getByRole('button', { name: 'Choose file' }));
    const [, clearSsh] = screen.getAllByRole('button', {
      name: 'Clear path and restore default',
    });
    await fireEvent.click(clearSsh);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.sshKeyPath', value: '' },
      ]);
    });
  });

  it('never writes the redacted sshKeyPath back when saving an unrelated change', async () => {
    mocks.mockSettingsList.mockResolvedValue(withValues({ 'workspace.sshKeyPath': REDACTED }));
    render(GitWorkspaceSettings);

    const autoFetch = await waitFor(() =>
      screen.getByRole('checkbox', { name: /Auto-fetch updates/ }),
    );
    await fireEvent.click(autoFetch);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'workspace.autoFetch', value: true },
      ]);
    });
  });
});

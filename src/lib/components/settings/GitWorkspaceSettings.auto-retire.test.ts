/**
 * @vitest-environment jsdom
 *
 * Auto-retire setting (`workspace.autoRetireArchivedAfterDays`, PROTOCOL §5.12):
 * absent/null means off, a positive integer number of days means on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import GitWorkspaceSettings from './GitWorkspaceSettings.svelte';
import { warmImport } from '../../../test/warm-import';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { settingsFormSaga } from '$store/renderer/slices/settings-events/sagas/settings-form-saga';

const mocks = vi.hoisted(() => ({
  mockSettingsList: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockCapabilities: vi.fn(),
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

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

warmImport(() => import('../ui/__tests__/mocks/Fa.svelte'));

const AUTO_RETIRE_PATH = 'workspace.autoRetireArchivedAfterDays';

const baseSettings = [
  { path: 'workspace.worktreesLocation', value: '' },
  { path: 'workspace.sshKeyPath', value: '' },
  { path: 'workspace.defaultShell', value: 'auto' },
  { path: 'git.autoCommit', value: true },
  { path: 'workspace.cowIsolation', value: false },
  { path: 'workspace.branchPrefix', value: '' },
];

const toggleName = () => m.settings_gitWorkspace_autoRetire_label();
const daysName = () => m.settings_gitWorkspace_autoRetireDays_label();

function findToggle() {
  return waitFor(() => screen.getByRole('switch', { name: toggleName() }));
}

function findDays() {
  return waitFor(() => screen.getByRole('spinbutton', { name: daysName() }) as HTMLInputElement);
}

let stop: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  store.init();
  stop = store.runSaga(settingsFormSaga);
  mocks.mockCapabilities.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  stop();
  store.dispose();
});

describe('GitWorkspaceSettings — auto-retire archived workspaces', () => {
  it('shows the toggle off and hides the days input when the setting is unset', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: null },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await findToggle();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: daysName() })).toBeNull();
  });

  it('shows the toggle on with the configured number of days', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: 14 },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await findToggle();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect((await findDays()).value).toBe('14');
  });

  it('explains that retired workspaces lose their files but keep conversations', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: null },
    ]);

    render(GitWorkspaceSettings);

    const toggle = await findToggle();
    const descriptionId = toggle.getAttribute('aria-describedby');
    const description = descriptionId ? document.getElementById(descriptionId) : null;
    expect(description?.textContent).toContain(m.settings_gitWorkspace_autoRetire_description());
    expect(m.settings_gitWorkspace_autoRetire_description()).toMatch(/files/);
    expect(m.settings_gitWorkspace_autoRetire_description()).toMatch(/conversations/);
  });

  it('hides the control when the daemon does not report the setting (older daemon)', async () => {
    mocks.mockSettingsList.mockResolvedValue([...baseSettings]);

    render(GitWorkspaceSettings);

    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: /Enable auto-commit for new workspaces/ }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole('switch', { name: toggleName() })).toBeNull();
  });

  it('turning the toggle on writes the default of 7 days', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: null },
    ]);
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: AUTO_RETIRE_PATH, value: 7 }]);

    render(GitWorkspaceSettings);

    await fireEvent.click(await findToggle());

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: AUTO_RETIRE_PATH, value: 7 }]),
    );
    expect((await findDays()).value).toBe('7');
  });

  it('turning the toggle off unsets the setting (null)', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: 10 },
    ]);
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: AUTO_RETIRE_PATH, value: null }]);

    render(GitWorkspaceSettings);

    const toggle = await findToggle();
    await fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: AUTO_RETIRE_PATH, value: null },
      ]),
    );
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByRole('spinbutton', { name: daysName() })).toBeNull();
  });

  it('writes a valid number of days on blur', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: 7 },
    ]);
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: AUTO_RETIRE_PATH, value: 30 }]);

    render(GitWorkspaceSettings);

    const days = await findDays();
    await fireEvent.input(days, { target: { value: '30' } });
    await fireEvent.blur(days);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: AUTO_RETIRE_PATH, value: 30 },
      ]),
    );
    expect(screen.queryByText(m.settings_gitWorkspace_autoRetireDays_invalid())).toBeNull();
  });

  it.each([
    ['zero', '0'],
    ['negative', '-3'],
    ['fractional', '1.5'],
    ['empty', ''],
  ])('rejects a %s number of days without writing it', async (_label, value) => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: 7 },
    ]);

    render(GitWorkspaceSettings);

    const days = await findDays();
    await fireEvent.input(days, { target: { value } });
    await fireEvent.blur(days);

    await waitFor(() =>
      expect(screen.getByText(m.settings_gitWorkspace_autoRetireDays_invalid())).toBeTruthy(),
    );
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('does not leak a rejected days value into a later unrelated save', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: 7 },
    ]);
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'git.autoCommit', value: false }]);

    render(GitWorkspaceSettings);

    const days = await findDays();
    await fireEvent.input(days, { target: { value: '0' } });
    await fireEvent.blur(days);
    await fireEvent.click(
      screen.getByRole('switch', { name: /Enable auto-commit for new workspaces/ }),
    );

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'git.autoCommit', value: false },
      ]),
    );
  });

  it('resetToDefaults turns auto-retire off', async () => {
    mocks.mockSettingsList.mockResolvedValue([
      ...baseSettings,
      { path: AUTO_RETIRE_PATH, value: 7 },
    ]);
    mocks.mockSettingsUpdate.mockImplementation(async (changes) => changes);

    const { component } = render(GitWorkspaceSettings);
    const toggle = await findToggle();
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    component.resetToDefaults();

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([{ path: AUTO_RETIRE_PATH, value: null }]),
      ),
    );
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });
});

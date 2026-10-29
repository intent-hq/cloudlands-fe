/**
 * @vitest-environment jsdom
 *
 * Archiving settings (PROTOCOL §5.12):
 * - `workspace.autoArchiveIdleAfterDays`: `0` (the default) or absent means
 *   off, a positive integer number of days means on.
 * - `workspace.purgeArchivedAfterDays`: absent/null means off, a positive
 *   integer number of days means on.
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

const AUTO_ARCHIVE_PATH = 'workspace.autoArchiveIdleAfterDays';
const PURGE_PATH = 'workspace.purgeArchivedAfterDays';

const baseSettings = [
  { path: 'workspace.worktreesLocation', value: '' },
  { path: 'workspace.sshKeyPath', value: '' },
  { path: 'workspace.defaultShell', value: 'auto' },
  { path: 'git.autoCommit', value: true },
  { path: 'workspace.cowIsolation', value: false },
  { path: 'workspace.branchPrefix', value: '' },
];

const rows = {
  archive: {
    path: AUTO_ARCHIVE_PATH,
    toggle: () => m.settings_gitWorkspace_autoArchive_label(),
    days: () => m.settings_gitWorkspace_autoArchiveDays_label(),
    off: 0,
  },
  purge: {
    path: PURGE_PATH,
    toggle: () => m.settings_gitWorkspace_purge_label(),
    days: () => m.settings_gitWorkspace_purgeDays_label(),
    off: null,
  },
} as const;

function findToggle(name: string) {
  return waitFor(() => screen.getByRole('switch', { name }));
}

function findDays(name: string) {
  return waitFor(() => screen.getByRole('spinbutton', { name }) as HTMLInputElement);
}

function listWith(values: Record<string, unknown>, defaults: Record<string, unknown> = {}) {
  mocks.mockSettingsList.mockResolvedValue([
    ...baseSettings,
    ...Object.entries(values).map(([path, value]) => ({
      path,
      value,
      ...(path in defaults ? { defaultValue: defaults[path] } : {}),
    })),
  ]);
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

describe('GitWorkspaceSettings — Archiving section', () => {
  it('shows auto-archive and purge off by default', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: 0, [PURGE_PATH]: null }, { [AUTO_ARCHIVE_PATH]: 0 });
    render(GitWorkspaceSettings);

    const archive = await findToggle(rows.archive.toggle());
    expect(screen.getByText(m.settings_section_archiving())).toBeTruthy();
    expect(archive.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: rows.archive.days() })).toBeNull();
    const purge = await findToggle(rows.purge.toggle());
    expect(purge.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: rows.purge.days() })).toBeNull();
  });

  it('reads an absent auto-archive value as off', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: null, [PURGE_PATH]: null });
    render(GitWorkspaceSettings);

    const archive = await findToggle(rows.archive.toggle());
    expect(archive.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: rows.archive.days() })).toBeNull();
  });

  it('shows auto-archive on with its configured days', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: 7, [PURGE_PATH]: null });
    render(GitWorkspaceSettings);

    const archive = await findToggle(rows.archive.toggle());
    expect(archive.getAttribute('aria-checked')).toBe('true');
    expect((await findDays(rows.archive.days())).value).toBe('7');
  });

  it('reads auto-archive 0 as off', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: 0, [PURGE_PATH]: 14 });
    render(GitWorkspaceSettings);

    const archive = await findToggle(rows.archive.toggle());
    expect(archive.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: rows.archive.days() })).toBeNull();
    expect((await findDays(rows.purge.days())).value).toBe('14');
  });

  it('explains that purging keeps conversations and skips uncommitted changes', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: 7, [PURGE_PATH]: null });
    render(GitWorkspaceSettings);

    const toggle = await findToggle(rows.purge.toggle());
    const descriptionId = toggle.getAttribute('aria-describedby');
    const description = descriptionId ? document.getElementById(descriptionId) : null;
    expect(description?.textContent).toContain(m.settings_gitWorkspace_purge_description());
    expect(m.settings_gitWorkspace_purge_description()).toMatch(/conversations/i);
    expect(m.settings_gitWorkspace_purge_description()).toMatch(/uncommitted/i);
    expect(document.body.textContent?.toLowerCase()).not.toContain('retire');
  });

  it('hides the section when the daemon reports neither setting (older daemon)', async () => {
    listWith({});
    render(GitWorkspaceSettings);

    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: /Enable auto-commit for new workspaces/ }),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(m.settings_section_archiving())).toBeNull();
    expect(screen.queryByRole('switch', { name: rows.archive.toggle() })).toBeNull();
    expect(screen.queryByRole('switch', { name: rows.purge.toggle() })).toBeNull();
  });

  it('shows only the reported row', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: 7 });
    render(GitWorkspaceSettings);

    await findToggle(rows.archive.toggle());
    expect(screen.queryByRole('switch', { name: rows.purge.toggle() })).toBeNull();
  });

  it.each(['archive', 'purge'] as const)(
    'turning %s on writes the default of 7 days',
    async (row) => {
      const { path, toggle, days, off } = rows[row];
      listWith({ [AUTO_ARCHIVE_PATH]: 7, [PURGE_PATH]: null, [path]: off });
      mocks.mockSettingsUpdate.mockResolvedValue([{ path, value: 7 }]);
      render(GitWorkspaceSettings);

      await fireEvent.click(await findToggle(toggle()));

      await waitFor(() =>
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path, value: 7 }]),
      );
      expect((await findDays(days())).value).toBe('7');
    },
  );

  it.each(['archive', 'purge'] as const)('turning %s off writes its off value', async (row) => {
    const { path, toggle, days, off } = rows[row];
    listWith({ [AUTO_ARCHIVE_PATH]: 7, [PURGE_PATH]: null, [path]: 10 });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path, value: off }]);
    render(GitWorkspaceSettings);

    const switchEl = await findToggle(toggle());
    await fireEvent.click(switchEl);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path, value: off }]),
    );
    await waitFor(() => expect(switchEl.getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByRole('spinbutton', { name: days() })).toBeNull();
  });

  it.each(['archive', 'purge'] as const)(
    'writes a valid number of %s days on blur',
    async (row) => {
      const { path, days } = rows[row];
      listWith({ [AUTO_ARCHIVE_PATH]: 7, [PURGE_PATH]: 7 });
      mocks.mockSettingsUpdate.mockResolvedValue([{ path, value: 30 }]);
      render(GitWorkspaceSettings);

      const input = await findDays(days());
      await fireEvent.input(input, { target: { value: '30' } });
      await fireEvent.blur(input);

      await waitFor(() =>
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path, value: 30 }]),
      );
      expect(screen.queryByText(m.settings_gitWorkspace_archivingDays_invalid())).toBeNull();
    },
  );

  it.each([
    ['zero', '0'],
    ['negative', '-3'],
    ['fractional', '1.5'],
    ['empty', ''],
  ])('rejects a %s number of days without writing it', async (_label, value) => {
    listWith({ [AUTO_ARCHIVE_PATH]: 7, [PURGE_PATH]: 7 });
    render(GitWorkspaceSettings);

    for (const row of ['archive', 'purge'] as const) {
      const input = await findDays(rows[row].days());
      await fireEvent.input(input, { target: { value } });
      await fireEvent.blur(input);
    }

    await waitFor(() =>
      expect(screen.getAllByText(m.settings_gitWorkspace_archivingDays_invalid())).toHaveLength(2),
    );
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('does not leak a rejected days value into a later unrelated save', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: 7, [PURGE_PATH]: 7 });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'git.autoCommit', value: false }]);
    render(GitWorkspaceSettings);

    const input = await findDays(rows.archive.days());
    await fireEvent.input(input, { target: { value: '0' } });
    await fireEvent.blur(input);
    await fireEvent.click(
      screen.getByRole('switch', { name: /Enable auto-commit for new workspaces/ }),
    );

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'git.autoCommit', value: false },
      ]),
    );
  });

  it('resetToDefaults turns both auto-archive and purge off', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: 14, [PURGE_PATH]: 7 }, { [AUTO_ARCHIVE_PATH]: 0 });
    mocks.mockSettingsUpdate.mockImplementation(async (changes) => changes);

    const { component } = render(GitWorkspaceSettings);
    const archive = await findToggle(rows.archive.toggle());
    const purge = await findToggle(rows.purge.toggle());
    expect(archive.getAttribute('aria-checked')).toBe('true');
    expect(purge.getAttribute('aria-checked')).toBe('true');

    component.resetToDefaults();

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([
          { path: AUTO_ARCHIVE_PATH, value: 0 },
          { path: PURGE_PATH, value: null },
        ]),
      ),
    );
    await waitFor(() => expect(purge.getAttribute('aria-checked')).toBe('false'));
    await waitFor(() => expect(archive.getAttribute('aria-checked')).toBe('false'));
  });

  it('resetToDefaults keeps an older daemon at its advertised 7-day default', async () => {
    listWith({ [AUTO_ARCHIVE_PATH]: 0, [PURGE_PATH]: 7 }, { [AUTO_ARCHIVE_PATH]: 7 });
    mocks.mockSettingsUpdate.mockImplementation(async (changes) => changes);

    const { component } = render(GitWorkspaceSettings);
    const purge = await findToggle(rows.purge.toggle());
    expect(purge.getAttribute('aria-checked')).toBe('true');

    component.resetToDefaults();

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([
          { path: AUTO_ARCHIVE_PATH, value: 7 },
          { path: PURGE_PATH, value: null },
        ]),
      ),
    );
    await waitFor(() => expect(purge.getAttribute('aria-checked')).toBe('false'));
    expect((await findToggle(rows.archive.toggle())).getAttribute('aria-checked')).toBe('true');
  });
});

/**
 * @vitest-environment jsdom
 *
 * Plain-folder workspaces (Labs): the onboarding project step shows an
 * "Initialize as git repository" toggle. Off, a non-git folder is used as a
 * plain folder and the New project tab creates one without git; git
 * repositories and their subfolders still create git workspaces. The toggle
 * is not shown on the GitHub clone tab, and with the Labs flag off the step
 * behaves exactly as today.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const LOCAL_PATH = '/tmp/local-folder';
const mocks = vi.hoisted(() => ({
  localDirectoryStatus: null as Record<string, unknown> | null,
  /** The folder status cannot be read (the bridge reports a failure). */
  statusUnavailable: false,
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async (channel: string) =>
    channel === 'file:getDirectoryStatus'
      ? mocks.statusUnavailable
        ? { success: false, error: 'unavailable' }
        : { success: true, data: mocks.localDirectoryStatus }
      : undefined,
  ),
}));

vi.mock('$lib/directory-picker-service', () => ({
  pickDirectory: vi.fn(async ({ onSelect }: { onSelect: (path: string) => void }) =>
    onSelect(LOCAL_PATH),
  ),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (
    await import('../../../../lib/components/modals/__tests__/mocks/MockPortal.svelte')
  ).default;
  return { default: MockPortal };
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { resetMockIpcRouter, setMockIpcInvokeFallback } from '$shared/ipc-mock-router';
import { m } from '$shared/paraglide/messages.js';
import { githubAuthStatusUnavailable } from '$store/renderer/slices/github-auth/github-auth-slice';
import type { Workspace } from '$shared/types';
import '$store/renderer/seeders/host-bridge-seeder';
import {
  loadWorkspaces,
  resetPlainFolderState,
  setPlainFolderLabs,
  settleForgeAuth,
} from '../../../../lib/components/workspace/initializer/__tests__/plain-folder-test-state';
import { INITIALIZE_GIT_CHOICE_STORAGE_KEY } from '$lib/components/workspace/initializer/plain-folder-create';

import ProjectPickerMessage, { type ProjectSelection } from '../ProjectPickerMessage.svelte';

const backendRequestMock = vi.mocked(backendRequest);
/** The git switch under any of its per-folder names. */
const toggleName = () =>
  new RegExp(
    `^(${m.workspace_plainFolder_switchNeutral_label()}|${m.workspace_plainFolder_switchGitRepo_label()}|${m.workspace_plainFolder_initializeGit_label()})$`,
  );

function mockDaemon(
  statusFor: (path: string) => Record<string, unknown> = () => ({ exists: false }),
) {
  backendRequestMock.mockImplementation(((method: string, params?: { path?: string }) => {
    if (method === 'host.directoryStatus')
      return Promise.resolve({
        exists: false,
        isDirectory: false,
        isEmpty: true,
        isGitRepo: false,
        isSubdirectoryOfGitRepo: false,
        path: params?.path ?? '',
        ...statusFor(params?.path ?? ''),
      });
    if (method === 'host.checkGit') return Promise.resolve({ available: true });
    return Promise.resolve(undefined);
  }) as never);
}

const isolation = { calls: [] as boolean[] };
function renderPicker(props: { skipIsolation?: boolean } = {}) {
  const selections: ProjectSelection[] = [];
  isolation.calls = [];
  render(ProjectPickerMessage, {
    props: {
      onProjectChange: (s) => selections.push(s),
      onSkipIsolationChange: (value: boolean) => isolation.calls.push(value),
      ...props,
    },
  });
  return selections;
}

async function pickLocal(status: Record<string, unknown>, selections: ProjectSelection[]) {
  mocks.localDirectoryStatus = { path: LOCAL_PATH, ...status };
  await fireEvent.click(screen.getByRole('button', { name: 'Browse for a folder' }));
  await waitFor(() => expect(selections.at(-1)?.repoPath).toBe(LOCAL_PATH));
  return selections.at(-1)!;
}

const nonGitFolder = {
  exists: true,
  isDirectory: true,
  isGitRepo: false,
  isSubdirectoryOfGitRepo: false,
};

describe('ProjectPickerMessage — plain-folder toggle (Labs)', () => {
  beforeAll(() => appStore.init());

  beforeEach(() => {
    setMockIpcInvokeFallback(undefined);
    vi.mocked(localStorage.setItem).mockClear();
    mockDaemon();
  });

  afterEach(() => {
    cleanup();
    backendRequestMock.mockReset();
    mocks.localDirectoryStatus = null;
    mocks.statusUnavailable = false;
    sessionStorage.clear();
    resetPlainFolderState();
  });

  afterAll(() => resetMockIpcRouter());

  it('with Labs off shows no toggle and still git-initializes a non-git folder', async () => {
    setPlainFolderLabs(false);
    settleForgeAuth();
    loadWorkspaces([]);
    const selections = renderPicker();
    expect(screen.queryByRole('switch', { name: toggleName() })).toBeNull();

    const selection = await pickLocal(nonGitFolder, selections);
    expect(selection).toMatchObject({ type: 'local', initGit: true });
    expect(selection).not.toHaveProperty('plainFolder');
  });

  it('defaults off with no forge and uses a non-git folder as a plain folder', async () => {
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    const selections = renderPicker();
    const toggle = await screen.findByRole('switch', { name: toggleName() });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    const selection = await pickLocal(nonGitFolder, selections);
    expect(selection).toMatchObject({ type: 'local', plainFolder: 'existing', isValid: true });
    expect(selection).not.toHaveProperty('initGit');
    expect(screen.getByRole('status').textContent).toContain(
      m.onboarding_localRepoTab_plainFolder_description(),
    );
  });

  it.each([
    ['a git repository', { isGitRepo: true }],
    [
      'a subfolder of a git repository',
      { isSubdirectoryOfGitRepo: true, relativePathFromGitRoot: 'docs' },
    ],
  ])('keeps %s a git workspace with the toggle off', async (_label, status) => {
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    const selections = renderPicker();
    await screen.findByRole('switch', { name: toggleName() });

    const selection = await pickLocal({ ...nonGitFolder, ...status }, selections);
    expect(selection).not.toHaveProperty('plainFolder');
    expect(selection).not.toHaveProperty('initGit');
  });

  it('defaults on with an existing git workspace and remembers a flip', async () => {
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([{ id: 'ws-1', title: 'Repo' } as unknown as Workspace]);
    const selections = renderPicker();
    const toggle = await screen.findByRole('switch', { name: toggleName() });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(localStorage.setItem).toHaveBeenCalledWith(INITIALIZE_GIT_CHOICE_STORAGE_KEY, 'false');
    const selection = await pickLocal(nonGitFolder, selections);
    expect(selection).toMatchObject({ plainFolder: 'existing' });
  });

  it('hides the toggle on the GitHub clone tab', async () => {
    setPlainFolderLabs(true);
    settleForgeAuth({ github: true });
    loadWorkspaces([]);
    renderPicker();
    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_existingFolder_label() }),
    );
    await screen.findByRole('switch', { name: toggleName() });

    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_clone_label() }),
    );
    await waitFor(() => expect(screen.queryByRole('switch', { name: toggleName() })).toBeNull());
  });

  /** The visible hint under the git choice switch. */
  const toggleHint = (toggle: HTMLElement) =>
    document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent ?? '';

  it('never tells the user to turn the New tab choice off while it is already off', async () => {
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    renderPicker();
    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_new_label() }),
    );
    const toggle = await screen.findByRole('switch', {
      name: m.workspace_plainFolder_initializeGit_label(),
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggleHint(toggle)).not.toMatch(/turn off/i);
    expect(toggleHint(toggle)).toBe(m.workspace_plainFolder_switchNewOff_description());

    await fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(toggleHint(toggle)).toBe(m.workspace_plainFolder_switchNewOn_description());
  });

  it('is neutral on the Existing folder tab before a folder is picked', async () => {
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    renderPicker();
    const toggle = await screen.findByRole('switch', {
      name: m.workspace_plainFolder_switchNeutral_label(),
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggleHint(toggle)).toBe(m.workspace_plainFolder_switchNeutralOff_description());
  });

  it('names the choice per tab: neutral for an empty Existing folder, git init for New', async () => {
    setPlainFolderLabs(true);
    settleForgeAuth({ github: true });
    loadWorkspaces([]);
    renderPicker();
    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_existingFolder_label() }),
    );
    await screen.findByRole('switch', { name: m.workspace_plainFolder_switchNeutral_label() });
    expect(
      screen.queryByRole('switch', { name: m.workspace_plainFolder_initializeGit_label() }),
    ).toBeNull();

    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_new_label() }),
    );
    await screen.findByRole('switch', { name: m.workspace_plainFolder_initializeGit_label() });
    expect(
      screen.queryByRole('switch', { name: m.workspace_plainFolder_switchNeutral_label() }),
    ).toBeNull();
  });

  it('creates a new project as a plain folder under ~/Documents with the toggle off', async () => {
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    const selections = renderPicker();
    await screen.findByRole('switch', { name: toggleName() });

    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_new_label() }),
    );
    await waitFor(() =>
      expect(selections.at(-1)).toMatchObject({
        type: 'new',
        repoPath: '~/Documents/my-project',
        plainFolder: 'new',
        branch: '',
        isValid: true,
      }),
    );
  });

  it('confirms a new project as an existing folder when its status is unavailable', async () => {
    // The target may already exist with user files: an unread status must not
    // skip the in-place, no-undo confirmation by passing as a new folder.
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    const selections = renderPicker();
    await screen.findByRole('switch', { name: toggleName() });
    const respond = backendRequestMock.getMockImplementation()!;
    backendRequestMock.mockImplementation(((method: string, params?: { path?: string }) =>
      method === 'host.directoryStatus' && params?.path === '~/Documents/my-project'
        ? Promise.reject(new Error('unavailable'))
        : respond(method as never, params as never)) as never);

    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_new_label() }),
    );
    await waitFor(() =>
      expect(selections.at(-1)).toMatchObject({
        type: 'new',
        repoPath: '~/Documents/my-project',
        plainFolder: 'existing',
        isValid: true,
      }),
    );
  });

  it('keeps a new project inside a git repository a git workspace', async () => {
    // The target does not exist; its parent is a git repository.
    mockDaemon((path) =>
      path === '~/Documents'
        ? { exists: true, isDirectory: true, isEmpty: false, isGitRepo: true }
        : { exists: false },
    );
    setPlainFolderLabs(true);
    settleForgeAuth();
    loadWorkspaces([]);
    const selections = renderPicker();
    await screen.findByRole('switch', { name: toggleName() });

    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_new_label() }),
    );
    await waitFor(() =>
      expect(selections.at(-1)).toMatchObject({
        type: 'new',
        repoPath: '~/Documents/my-project',
        isValid: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(selections.at(-1)).not.toHaveProperty('plainFolder');
  });

  describe('switch per folder type', () => {
    const gitRepo = { ...nonGitFolder, isGitRepo: true };
    const gitRepoSwitch = () =>
      screen.findByRole('switch', { name: m.workspace_plainFolder_switchGitRepo_label() });

    it('git repo, switch off: works in place on its current branch (isolation off)', async () => {
      setPlainFolderLabs(true);
      settleForgeAuth();
      loadWorkspaces([]);
      const selections = renderPicker();
      await screen.findByRole('switch', { name: toggleName() });

      const selection = await pickLocal(gitRepo, selections);
      expect(selection).not.toHaveProperty('plainFolder');
      expect(selection).not.toHaveProperty('initGit');
      await waitFor(() => expect(isolation.calls.at(-1)).toBe(true));
    });

    it('git repo, switch on: a new branch in a separate worktree', async () => {
      setPlainFolderLabs(true);
      settleForgeAuth();
      loadWorkspaces([{ id: 'ws-1', title: 'Repo' } as unknown as Workspace]);
      const selections = renderPicker();
      await screen.findByRole('switch', { name: toggleName() });

      await pickLocal(gitRepo, selections);
      await waitFor(() => expect(isolation.calls.at(-1)).toBe(false));
      const toggle = await gitRepoSwitch();
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(toggleHint(toggle)).toBe(m.workspace_plainFolder_switchGitRepoOn_description());
    });

    it('the switch on a git repo shows and sets the isolation setting', async () => {
      setPlainFolderLabs(true);
      settleForgeAuth();
      loadWorkspaces([{ id: 'ws-1', title: 'Repo' } as unknown as Workspace]);
      const selections = renderPicker({ skipIsolation: true });
      await screen.findByRole('switch', { name: toggleName() });
      await pickLocal(gitRepo, selections);
      isolation.calls = [];

      // The parent still reports isolation off: the switch shows it.
      const toggle = await gitRepoSwitch();
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      await fireEvent.click(toggle);
      expect(isolation.calls).toEqual([false]);
      expect(selections.at(-1)).not.toHaveProperty('plainFolder');
    });

    it('folder without git, switch on: git init in place, on main (isolation off)', async () => {
      setPlainFolderLabs(true);
      settleForgeAuth();
      loadWorkspaces([{ id: 'ws-1', title: 'Repo' } as unknown as Workspace]);
      const selections = renderPicker();
      await screen.findByRole('switch', { name: toggleName() });

      const selection = await pickLocal(nonGitFolder, selections);
      expect(selection).toMatchObject({ type: 'local', initGit: true });
      await waitFor(() => expect(isolation.calls.at(-1)).toBe(true));
      const toggle = await screen.findByRole('switch', {
        name: m.workspace_plainFolder_initializeGit_label(),
      });
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(toggleHint(toggle)).toBe(m.workspace_plainFolder_switchFolderOn_description());
    });

    it('New, switch on: create, git init and work on main (isolation off)', async () => {
      setPlainFolderLabs(true);
      settleForgeAuth();
      loadWorkspaces([{ id: 'ws-1', title: 'Repo' } as unknown as Workspace]);
      const selections = renderPicker();
      await screen.findByRole('switch', { name: toggleName() });
      await fireEvent.click(
        screen.getByRole('tab', { name: m.onboarding_projectPicker_new_label() }),
      );
      await waitFor(() => expect(selections.at(-1)).toMatchObject({ type: 'new', branch: 'main' }));
      await waitFor(() => expect(isolation.calls.at(-1)).toBe(true));
    });

    it('with Labs off never touches the isolation setting', async () => {
      setPlainFolderLabs(false);
      settleForgeAuth();
      loadWorkspaces([]);
      const selections = renderPicker();
      await pickLocal(nonGitFolder, selections);
      await fireEvent.click(
        screen.getByRole('tab', { name: m.onboarding_projectPicker_new_label() }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(isolation.calls).toEqual([]);
    });
  });

  describe('recent plain-folder entries', () => {
    const NOTES = '/tmp/notes';
    const plainRow = {
      id: 'ws-notes',
      title: 'Notes',
      repositoryPath: NOTES,
      repositoryName: 'notes',
      plainFolder: true,
      updatedAt: '2026-10-01T00:00:00.000Z',
    } as unknown as Workspace;

    async function pickRecent(selections: ProjectSelection[]) {
      await fireEvent.click(await screen.findByText('notes'));
      await waitFor(() => expect(selections.at(-1)?.repoPath).toBe(NOTES));
      return selections.at(-1)!;
    }

    it('classifies a recent plain-folder row by the folder probe', async () => {
      setPlainFolderLabs(true);
      settleForgeAuth();
      loadWorkspaces([plainRow]);
      const selections = renderPicker();
      await screen.findByRole('switch', { name: toggleName() });
      mocks.localDirectoryStatus = { path: NOTES, ...nonGitFolder };

      const selection = await pickRecent(selections);
      expect(selection).toMatchObject({ type: 'local', plainFolder: 'existing', branch: '' });
      expect(selection).not.toHaveProperty('initGit');
    });

    it('probes in the browser build too (no Electron bridge)', async () => {
      const electronAPI = (window as { electronAPI?: unknown }).electronAPI;
      delete (window as { electronAPI?: unknown }).electronAPI;
      try {
        setPlainFolderLabs(true);
        settleForgeAuth();
        loadWorkspaces([]);
        const selections = renderPicker();
        await screen.findByRole('switch', { name: toggleName() });
        const selection = await pickLocal(nonGitFolder, selections);
        expect(selection).toMatchObject({ type: 'local', plainFolder: 'existing' });
      } finally {
        (window as { electronAPI?: unknown }).electronAPI = electronAPI;
      }
    });

    it('treats a plain-folder row as a plain folder when the status is unavailable', async () => {
      setPlainFolderLabs(true);
      settleForgeAuth();
      loadWorkspaces([plainRow]);
      const selections = renderPicker();
      await screen.findByRole('switch', { name: toggleName() });
      mocks.statusUnavailable = true;

      const selection = await pickRecent(selections);
      expect(selection).toMatchObject({ type: 'local', plainFolder: 'existing' });
    });
  });
});

describe('ProjectPickerMessage — source tabs and Clone visibility', () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    setMockIpcInvokeFallback(undefined);
    mockDaemon();
  });
  afterEach(() => {
    cleanup();
    backendRequestMock.mockReset();
    sessionStorage.clear();
    resetPlainFolderState();
  });
  afterAll(() => resetMockIpcRouter());

  const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent?.trim());

  const selectedTab = () =>
    screen
      .getAllByRole('tab')
      .find((tab) => tab.getAttribute('aria-selected') === 'true')
      ?.textContent?.trim();

  it.each([false, true])('orders the tabs Clone, Existing folder, New (Labs %s)', (labs) => {
    setPlainFolderLabs(labs);
    settleForgeAuth({ github: true });
    renderPicker();
    expect(tabNames()).toEqual(['Clone', 'Existing folder', 'New']);
  });

  it.each([
    ['GitHub', { github: true }],
    ['GitLab', { gitlab: true }],
  ])('opens on Clone with %s connected', (_label, forge) => {
    settleForgeAuth(forge);
    renderPicker();
    expect(selectedTab()).toBe('Clone');
  });

  it('opens on Existing folder with no forge connected', async () => {
    settleForgeAuth();
    const selections = renderPicker();
    await waitFor(() => expect(tabNames()).toEqual(['Existing folder', 'New']));
    expect(selectedTab()).toBe('Existing folder');
    expect(selections.at(-1)?.type).toBe('local');
  });

  it('keeps a persisted local pick on Existing folder with a forge connected', async () => {
    settleForgeAuth({ github: true });
    sessionStorage.setItem('workspace-prefill', JSON.stringify({ repoPath: '/tmp/repo' }));
    renderPicker();
    expect(selectedTab()).toBe('Existing folder');
  });

  it('hides Clone once forge status is known and nothing is connected', async () => {
    settleForgeAuth();
    renderPicker();
    await waitFor(() => expect(tabNames()).toEqual(['Existing folder', 'New']));
  });

  it('keeps Clone with GitLab connected', () => {
    settleForgeAuth({ gitlab: true });
    renderPicker();
    expect(tabNames()).toEqual(['Clone', 'Existing folder', 'New']);
  });

  it('keeps Clone when the GitHub status read failed', () => {
    settleForgeAuth();
    appStore.dispatch(githubAuthStatusUnavailable());
    renderPicker();
    expect(tabNames()).toEqual(['Clone', 'Existing folder', 'New']);
  });

  it('moves a GitHub prefill off the hidden Clone tab to Existing folder', async () => {
    settleForgeAuth();
    sessionStorage.setItem(
      'workspace-prefill',
      JSON.stringify({ githubUrl: 'https://github.com/octo/alpha' }),
    );
    const selections = renderPicker();
    await waitFor(() => expect(tabNames()).toEqual(['Existing folder', 'New']));
    expect(
      screen
        .getByRole('tab', { name: m.onboarding_projectPicker_existingFolder_label() })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(selections.at(-1)?.type).toBe('local');
  });
});

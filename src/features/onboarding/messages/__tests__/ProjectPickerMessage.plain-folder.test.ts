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
const toggleName = () => m.workspace_plainFolder_initializeGit_label();

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

function renderPicker() {
  const selections: ProjectSelection[] = [];
  render(ProjectPickerMessage, { props: { onProjectChange: (s) => selections.push(s) } });
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
    settleForgeAuth();
    loadWorkspaces([]);
    renderPicker();
    await screen.findByRole('switch', { name: toggleName() });

    await fireEvent.click(
      screen.getByRole('tab', { name: m.onboarding_projectPicker_githubRepo_label() }),
    );
    await waitFor(() => expect(screen.queryByRole('switch', { name: toggleName() })).toBeNull());
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

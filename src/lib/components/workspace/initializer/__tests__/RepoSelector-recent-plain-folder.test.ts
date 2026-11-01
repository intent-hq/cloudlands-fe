/** @vitest-environment jsdom */
/**
 * Recent entries in the repository picker are classified through the same
 * folder-status probe as a picked folder: a recent plain-folder workspace path
 * (no .git) is never assumed to be a git repository (Labs plain folders).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { runSaga, stdChannel, type Task } from 'redux-saga';

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (v: T) => void) {
      run(getter());
      const notify = () => run(getter());
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  });
  const selector = <T>(getter: () => T) => {
    const fn = () => readable(getter);
    return Object.assign(fn, { select: () => getter() });
  };
  const state = {
    recentRepos: [] as Array<{
      path: string;
      type: 'local' | 'github';
      githubUrl?: string;
      name: string;
      owner?: string;
    }>,
  };
  return {
    selector,
    state,
    listeners,
    appState: {} as Record<string, unknown>,
    dispatch: vi.fn(),
    channel: null as ReturnType<typeof stdChannel> | null,
    originUrl: vi.fn(),
    electron: true,
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { select } = await import('redux-saga/effects');
  const module = createAppStoreMockModule({
    state: () => mocks.appState,
    dedupeEmits: true,
    dispatch: (action) => {
      mocks.dispatch(action);
      mocks.appState = {
        ...mocks.appState,
        workspaceInitializer: workspaceInitializerReducer(
          mocks.appState.workspaceInitializer as never,
          action,
        ),
      };
      module.store.emitState();
      mocks.channel?.put(action);
    },
  });
  const createSelector = module.store.createSelector.bind(module.store);
  module.store.createSelector = ((selectorFunc: (state: never, ...args: never[]) => unknown) => {
    const selector = createSelector(selectorFunc);
    selector.effect = function* (...args: never[]) {
      return yield select(selectorFunc, ...args);
    };
    return selector;
  }) as typeof module.store.createSelector;
  const { workspaceInitializerReducer } =
    await import('$store/renderer/slices/workspace-initializer/workspace-initializer-slice');
  return module;
});

vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: () => ({ type: 'githubAuth/initialize' }),
  startGitHubAuth: () => ({ type: 'githubAuth/start' }),
  cancelGitHubAuth: () => ({ type: 'githubAuth/cancel' }),
  clearGitHubAuthError: () => ({ type: 'githubAuth/clearError' }),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(() => false),
  selectGitHubAuthIsAuthenticating: mocks.selector(() => false),
  selectGitHubAuthDeviceFlow: mocks.selector(() => null),
  selectGitHubAuthError: mocks.selector(() => null),
  selectGitHubAuthRequiresDaemonAuth: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-slice', () => ({
  loadGithubRepos: () => ({ type: 'githubRepos/load' }),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-selectors', () => ({
  selectGithubRepos: mocks.selector(() => []),
  selectGithubReposError: mocks.selector(() => null),
  selectGithubReposLoaded: mocks.selector(() => true),
  selectGithubReposLoading: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-slice', () => ({
  searchGithubRepos: (query: string) => ({ type: 'githubRepoSearch/search', payload: [query] }),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-selectors', () => ({
  selectGithubRepoSearchLastQuery: mocks.selector(() => ''),
  selectGithubRepoSearchLoading: mocks.selector(() => false),
  selectGithubRepoSearchResults: mocks.selector(() => []),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  replaceWorkspaceList: (workspaces: unknown) => ({
    type: 'workspace/replace',
    payload: workspaces,
  }),
}));
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { list: vi.fn(async () => ({ ok: true, data: [] })) },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: mocks.selector(() => []),
}));
vi.mock('$store/renderer/slices/feature-codes/feature-codes-selectors', () => ({
  selectIsFeatureEnabled: mocks.selector(() => false),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => ({ success: true, data: [] })),
  shell: { open: vi.fn(async () => {}) },
}));
vi.mock('$lib/utils/platform-capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/platform-capabilities')>()),
  isElectronPlatform: () => mocks.electron,
}));
vi.mock('$lib/config/debug', () => ({ debugConfig: { get: () => false } }));
vi.mock('$lib/utils/performance', () => ({
  performanceMonitor: { start: vi.fn(), end: vi.fn() },
}));
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/workspace/initializer/AddRemoteSetupModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import RepoSelector from '../RepoSelector.svelte';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';

import { warmImport } from '../../../../../test/warm-import';
import { invoke } from '$lib/electron-bridge';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';

const DROPDOWN_HEADING = 'What repo should we work on?';
warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));

import { store } from '$store/renderer/store';
import {
  initialState,
  hydrateWorkspaceInitializer,
  workspaceInitializerReducer,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { selectWorkspaceInitializerRecentRepos } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
import type { StoreState } from '$store/renderer/types';
import type { Workspace } from '$shared/types';
import { workspaceInitializerRepositorySaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initializer-repository-saga';

const NOTES = '/home/me/notes';
const REPO = '/home/me/code/app';
type DirStatus = {
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  isGitRepo: boolean;
  path: string;
  isSubdirectoryOfGitRepo?: boolean;
};
const statuses = new Map<string, DirStatus | 'fail'>();
const plainStatus = (path: string): DirStatus => ({
  exists: true,
  isDirectory: true,
  isEmpty: false,
  isGitRepo: false,
  path,
});
const gitStatus = (path: string): DirStatus => ({ ...plainStatus(path), isGitRepo: true });
const workspaceRow = (path: string, extra: Partial<Workspace> = {}) =>
  ({
    id: `ws-${path}`,
    title: path,
    repositoryPath: path,
    repositoryName: path.split('/').pop(),
    updatedAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }) as unknown as Workspace;

const originalDispatch = store.dispatch;
let repositoryTask: Task;
function setState(next: StoreState) {
  mocks.appState = next as unknown as Record<string, unknown>;
  (store as unknown as { emitState(): void }).emitState();
}
const recents = () => selectWorkspaceInitializerRecentRepos.select(mocks.appState as StoreState);
const probes = () =>
  vi.mocked(invoke).mock.calls.filter(([channel]) => channel === 'file:getDirectoryStatus');

beforeEach(() => {
  store.dispatch = originalDispatch;
  mocks.dispatch.mockClear();
  // The browser build: the bridge forwards the probe to the daemon.
  mocks.electron = false;
  statuses.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(workspaceClient.list).mockReset();
  mocks.originUrl.mockReset();
  mocks.originUrl.mockResolvedValue(null);
  setState(
    withLegacyPrincipal({
      workspace: { deletionTokens: {} } as StoreState['workspace'],
      workspaceInitializer: workspaceInitializerReducer(
        initialState,
        hydrateWorkspaceInitializer({ recentRepos: [] }),
      ),
    }),
  );
  vi.mocked(workspaceClient.list).mockResolvedValue({
    ok: true,
    data: [
      // A plain-folder row has no worktree (the daemon works in the folder itself).
      workspaceRow(NOTES, { plainFolder: true, branch: '' } as Partial<Workspace>),
      workspaceRow(REPO, {
        branch: 'main',
        worktreePath: '/home/me/.worktrees/app',
      } as Partial<Workspace>),
    ],
  } as never);
  vi.mocked(invoke).mockImplementation(async (channel, args) => {
    if (channel === WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES) return { success: true, data: [] };
    if (channel === 'file:getDirectoryStatus') {
      const status = statuses.get((args as { path: string }).path);
      if (status === 'fail') throw new Error('probe unavailable');
      return status ? { success: true, data: status } : { success: false };
    }
    return { success: true, data: [] };
  });
  mocks.channel = stdChannel();
  repositoryTask = runSaga(
    { channel: mocks.channel, getState: () => mocks.appState, dispatch: store.dispatch },
    workspaceInitializerRepositorySaga,
    { git: { originUrl: mocks.originUrl } } as never,
  );
});
afterEach(() => {
  cleanup();
  repositoryTask?.cancel();
  mocks.channel = null;
  store.dispatch = originalDispatch;
});

async function openWithRecents(props: Record<string, unknown>) {
  const onchange = vi.fn();
  const rendered = render(RepoSelector, { props: { ...props, onchange } });
  await fireEvent.click(rendered.container.querySelector('button')!);
  await waitFor(() => expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy());
  await fireEvent.click(screen.getByRole('tab', { name: 'Copy local repo' }));
  await waitFor(() => expect(screen.getByText('notes')).toBeTruthy());
  return { ...rendered, onchange };
}
const lastDetail = (onchange: ReturnType<typeof vi.fn>) =>
  (onchange.mock.calls.at(-1)![0] as CustomEvent<Record<string, unknown>>).detail;

describe('RepoSelector recent plain-folder entries', () => {
  it('marks a recent plain-folder workspace path from the live workspace rows', async () => {
    await openWithRecents({ plainFolderMode: true });
    await waitFor(() =>
      expect(recents()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: NOTES, type: 'local', plainFolder: true }),
        ]),
      ),
    );
    expect(recents().find((repo) => repo.path === REPO)?.plainFolder).toBeUndefined();
  });

  it('selects a non-git recent path as a plain folder when the toggle is off', async () => {
    statuses.set(NOTES, plainStatus(NOTES));
    const { onchange } = await openWithRecents({ plainFolderMode: true });
    await fireEvent.click(screen.getByText('notes'));
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(probes().map(([, args]) => (args as { path: string }).path)).toContain(NOTES);
    expect(lastDetail(onchange)).toEqual(
      expect.objectContaining({ path: NOTES, type: 'local', plainFolder: 'existing' }),
    );
  });

  it('classifies a recent path by the probe even without a plain-folder row', async () => {
    statuses.set(REPO, plainStatus(REPO));
    const { onchange } = await openWithRecents({ plainFolderMode: true });
    await fireEvent.click(screen.getByText('app'));
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(lastDetail(onchange)).toEqual(
      expect.objectContaining({ path: REPO, plainFolder: 'existing' }),
    );
  });

  it('classifies the same way in the Electron build', async () => {
    mocks.electron = true;
    statuses.set(NOTES, plainStatus(NOTES));
    const { onchange } = await openWithRecents({ plainFolderMode: true });
    await fireEvent.click(screen.getByText('notes'));
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(lastDetail(onchange)).toEqual(
      expect.objectContaining({ path: NOTES, plainFolder: 'existing' }),
    );
  });

  it('keeps a recent git repository on the git flow with the toggle off', async () => {
    statuses.set(REPO, gitStatus(REPO));
    const { onchange } = await openWithRecents({ plainFolderMode: true });
    await fireEvent.click(screen.getByText('app'));
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    const detail = lastDetail(onchange);
    expect(detail).toMatchObject({ path: REPO, type: 'local', isNewRepo: false });
    expect(detail.plainFolder).toBeUndefined();
  });

  it('falls back to the plain-folder row when the folder status is unavailable', async () => {
    const { onchange } = await openWithRecents({ plainFolderMode: true });
    await fireEvent.click(screen.getByText('notes'));
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(lastDetail(onchange)).toEqual(
      expect.objectContaining({ path: NOTES, plainFolder: 'existing' }),
    );
  });

  it('offers git initialization for a non-git recent path when the toggle is on', async () => {
    statuses.set(NOTES, plainStatus(NOTES));
    const { onchange } = await openWithRecents({ plainFolderMode: false });
    await fireEvent.click(screen.getByText('notes'));
    await waitFor(() =>
      expect(screen.getByText('This folder is not a Git repository.')).toBeTruthy(),
    );
    expect(onchange).not.toHaveBeenCalled();
  });

  it('selects a recent git repository synchronously with the toggle on and no plain row', async () => {
    const { onchange } = await openWithRecents({ plainFolderMode: false });
    await fireEvent.click(screen.getByText('app'));
    expect(lastDetail(onchange)).toEqual(
      expect.objectContaining({ path: REPO, type: 'local', isNewRepo: false }),
    );
    expect(probes()).toHaveLength(0);
  });
});

describe('RepoSelector new folder classification in the browser build', () => {
  const PARENT = '~/Documents';
  const TARGET = `${PARENT}/journal`;

  async function openNewFolder() {
    const onchange = vi.fn();
    const rendered = render(RepoSelector, { props: { plainFolderMode: true, onchange } });
    await fireEvent.click(rendered.container.querySelector('button')!);
    await waitFor(() => expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'New folder' }));
    const name = await waitFor(() => screen.getByPlaceholderText('new-project'));
    await fireEvent.input(name, { target: { value: 'journal' } });
    return { ...rendered, onchange };
  }

  it('creates a missing folder outside any repository without git', async () => {
    statuses.set(PARENT, plainStatus(PARENT));
    statuses.set(TARGET, { ...plainStatus(TARGET), exists: false, isDirectory: false });
    const { onchange } = await openNewFolder();
    await waitFor(() =>
      expect(screen.getByText('A new folder will be created, without git')).toBeTruthy(),
    );
    expect(probes().map(([, args]) => (args as { path: string }).path)).toContain(TARGET);
    await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(lastDetail(onchange)).toEqual(
      expect.objectContaining({ path: TARGET, type: 'local', plainFolder: 'new' }),
    );
  });

  it('uses an existing non-git folder as-is', async () => {
    statuses.set(PARENT, plainStatus(PARENT));
    statuses.set(TARGET, plainStatus(TARGET));
    const { onchange } = await openNewFolder();
    await waitFor(() =>
      expect(
        screen.getByText('Agents will work in this folder directly, without git.'),
      ).toBeTruthy(),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(lastDetail(onchange)).toEqual(
      expect.objectContaining({ path: TARGET, plainFolder: 'existing' }),
    );
  });

  it('keeps the plain-folder flow as an existing folder when the status is unavailable', async () => {
    // The unread target may already hold files, so it must reach the in-place,
    // no-undo confirmation that only an existing folder gets.
    statuses.set(PARENT, 'fail');
    statuses.set(TARGET, 'fail');
    const { onchange } = await openNewFolder();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy());
    expect(screen.queryByText('A new folder will be created, without git')).toBeNull();
    expect(screen.queryByText(/Create new repo/i)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(lastDetail(onchange)).toEqual(
      expect.objectContaining({ path: TARGET, plainFolder: 'existing' }),
    );
  });

  it('keeps a folder inside a git repository on the git flow', async () => {
    statuses.set(PARENT, gitStatus(PARENT));
    statuses.set(TARGET, {
      ...plainStatus(TARGET),
      exists: false,
      isDirectory: false,
      isSubdirectoryOfGitRepo: true,
    });
    await openNewFolder();
    await waitFor(() => expect(probes().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByText('A new folder will be created, without git')).toBeNull();
  });
});

describe('RepoSelector recent probe cancellation', () => {
  const GITLAB_BASE = 'https://git.example.test:8443/Forge';
  function gitlabProps() {
    return {
      authenticated: true,
      scopeKey: 'owner/connection-a/checkout-a',
      instanceBaseUrl: GITLAB_BASE,
      query: '',
      page: {
        status: 'ready' as const,
        items: [{ projectPath: 'group/subgroup/api', name: 'API', namespace: 'group/subgroup' }],
        hasMore: false,
      },
      copy: {
        searchLabel: 'Search GitLab projects',
        searchPlaceholder: 'Project or namespace',
        listLabel: 'GitLab projects',
        loadingLabel: 'Loading projects',
        emptyLabel: 'No projects',
        emptySearchLabel: 'No matching projects',
        loadMoreLabel: 'Load more projects',
        loadingMoreLabel: 'Loading more projects',
      },
      onSearch: vi.fn(),
      onMore: vi.fn(),
      onSelect: vi.fn(),
      onOpenChange: vi.fn(),
    };
  }

  /** Hold the folder probe for `path` until the returned release is called. */
  function holdProbe(path: string) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const fallback = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (channel, args) => {
      if (channel === 'file:getDirectoryStatus' && (args as { path: string }).path === path) {
        await held;
        return { success: true, data: plainStatus(path) };
      }
      return fallback(channel, args);
    });
    return release;
  }

  it('a GitLab project pick supersedes a local recent still being probed', async () => {
    const release = holdProbe(NOTES);
    const gitlab = gitlabProps();
    const { onchange } = await openWithRecents({ plainFolderMode: true, gitlab });
    await fireEvent.click(screen.getByText('notes'));
    await waitFor(() => expect(probes().length).toBeGreaterThan(0));

    await fireEvent.click(screen.getByRole('tab', { name: 'Pick a repo' }));
    await fireEvent.click(await screen.findByRole('option', { name: 'group/subgroup/api' }));
    expect(gitlab.onSelect).toHaveBeenCalledWith('group/subgroup/api', gitlab.scopeKey);

    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onchange).not.toHaveBeenCalled();
  });

  it('a local recent probe answering late never overrides a later local pick', async () => {
    const release = holdProbe(NOTES);
    statuses.set(REPO, gitStatus(REPO));
    const { onchange } = await openWithRecents({ plainFolderMode: true });
    await fireEvent.click(screen.getByText('notes'));
    await fireEvent.click(screen.getByText('app'));
    await waitFor(() => expect(onchange).toHaveBeenCalled());

    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(lastDetail(onchange)).toMatchObject({ path: REPO });
  });
});

describe('RepoSelector picker intro', () => {
  const GIT_INTRO =
    "Select an existing codebase or make a new one. We'll create an isolated workspace to work in.";
  const PLAIN_INTRO =
    'Select an existing codebase or make a new one. For a folder without Git, Intent works directly in it, with no copy and no undo.';

  it('says Intent works in place, with no copy and no undo, when the toggle is off', async () => {
    await openWithRecents({ plainFolderMode: true });
    expect(screen.getByText(PLAIN_INTRO)).toBeTruthy();
    expect(screen.queryByText(GIT_INTRO)).toBeNull();
  });

  it('keeps the isolated-workspace intro when the toggle is on', async () => {
    await openWithRecents({ plainFolderMode: false });
    expect(screen.getByText(GIT_INTRO)).toBeTruthy();
    expect(screen.queryByText(PLAIN_INTRO)).toBeNull();
  });
});

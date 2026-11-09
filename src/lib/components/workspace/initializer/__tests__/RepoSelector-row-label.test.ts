/**
 * @vitest-environment jsdom
 *
 * The New Workspace form picker's row label follows what the list can hold:
 * the selection when there is one ("Folder" for a plain folder, "Codebase" for a
 * git repository); with nothing selected, "Codebase" whenever a git repository is listed; otherwise "Folder" with no
 * forge connected or a plain folder listed; otherwise (forge connected, empty
 * list) "Codebase". Plain folders not offered (Labs off) keep "Codebase". The
 * label never reads "Codebase/Project" or "Codebase/Folder" and updates live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';

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
      plainFolder?: true;
      repositoryIdentity?: import('$shared/types/repository-context').RepositoryTarget | null;
    }>,
  };
  return {
    authenticated: false,
    cloneVisible: true,
    plainFoldersOffered: true,
    forgeState: 'none' as 'connected' | 'none' | 'unknown',
    hostMember: false,
    navigateToSettings: vi.fn(async () => {}),
    selector,
    state,
    listeners,
    appState: {} as Record<string, unknown>,
    dispatch: vi.fn(),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.appState,
    dispatch: (action) => {
      mocks.dispatch(action);
      if (action.type === 'wi/recent') {
        mocks.state.recentRepos = action.payload;
        for (const notify of mocks.listeners) notify();
      }
    },
  });
});

vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: () => ({ type: 'githubAuth/initialize' }),
  startGitHubAuth: () => ({ type: 'githubAuth/start' }),
  cancelGitHubAuth: () => ({ type: 'githubAuth/cancel' }),
  clearGitHubAuthError: () => ({ type: 'githubAuth/clearError' }),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(() => mocks.authenticated),
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

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerDismissedRecentRepoKeys: mocks.selector(() => ({})),
  selectWorkspaceInitializerHydrated: mocks.selector(() => true),
  selectWorkspaceInitializerDefaultParentPath: mocks.selector(() => ''),
  selectWorkspaceInitializerRecentRepos: mocks.selector(() => mocks.state.recentRepos),
  selectWorkspaceInitializerRemoteSetups: mocks.selector(() => []),
  selectWorkspaceInitializerRecentRepoRefresh: mocks.selector(() => ({ status: 'ready' })),
  selectWorkspaceInitializerDirectoryStatusCheck: mocks.selector(() => undefined),
}));
vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-slice', () => ({
  setWorkspaceInitializerDefaultParentPath: (path: string) => ({
    type: 'wi/parent',
    payload: path,
  }),
  setWorkspaceInitializerLastSelectedRepo: (repo: unknown) => ({ type: 'wi/last', payload: repo }),
  setWorkspaceInitializerRecentRepos: (repos: unknown) => ({ type: 'wi/recent', payload: repos }),
  setWorkspaceInitializerRemoteSetups: (s: unknown) => ({ type: 'wi/remote', payload: s }),
  workspaceInitializerRecentReposRefreshRequested: (...payload: unknown[]) => ({
    type: 'wi/refreshRequested',
    payload,
  }),
  workspaceInitializerRecentReposRefreshReleased: (...payload: unknown[]) => ({
    type: 'wi/refreshReleased',
    payload,
  }),
  workspaceInitializerDirectoryStatusRequested: (...payload: unknown[]) => ({
    type: 'wi/directoryRequested',
    payload,
  }),
  workspaceInitializerDirectoryStatusReleased: (...payload: unknown[]) => ({
    type: 'wi/directoryReleased',
    payload,
  }),
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
vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: (key: string) => key === 'enableFormPersistence' },
}));
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

vi.mock('$store/renderer/slices/workspace-initializer/plain-folder-selectors', async (orig) => ({
  ...(await orig<object>()),
  selectCloneSourceVisible: mocks.selector(() => mocks.cloneVisible),
  selectPlainFolderCreationAvailable: mocks.selector(() => mocks.plainFoldersOffered),
  selectForgeConnectionState: mocks.selector(() => mocks.forgeState),
}));
vi.mock('$store/renderer/slices/host-execution/host-execution-selectors', async (orig) => ({
  ...(await orig<object>()),
  selectIsHostMember: mocks.selector(() => mocks.hostMember),
}));
vi.mock('$lib/utils/workspace-navigation', async (orig) => ({
  ...(await orig<object>()),
  navigateToSettings: mocks.navigateToSettings,
}));

import RepoSelector from '../RepoSelector.svelte';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { warmImport } from '../../../../../test/warm-import';

warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));

const gitRepo = { path: '/repos/alpha', type: 'local' as const, name: 'alpha' };
const forgeRepo = {
  path: 'https://github.com/acme/widgets',
  type: 'github' as const,
  githubUrl: 'https://github.com/acme/widgets',
  name: 'widgets',
  owner: 'acme',
};
const plainFolder = {
  path: '/notes/journal',
  type: 'local' as const,
  name: 'journal',
  plainFolder: true as const,
};

function notify() {
  for (const listener of mocks.listeners) listener();
}

function renderForm() {
  return render(RepoSelector, {
    props: { rowLabel: 'Codebase', emptyLabel: 'Add repository', value: '' },
  });
}

const rowLabel = (container: HTMLElement) =>
  container.querySelector('[id$="-field-label"]')?.textContent?.trim();

beforeEach(() => {
  mocks.appState = withLegacyPrincipal({});
  mocks.authenticated = false;
  mocks.cloneVisible = true;
  mocks.hostMember = false;
  mocks.plainFoldersOffered = true;
  mocks.forgeState = 'none';
  mocks.state.recentRepos = [];
});

describe('RepoSelector form row label', () => {
  afterEach(() => cleanup());

  it('reads Codebase with a git repository listed and no forge connected', () => {
    mocks.forgeState = 'none';
    mocks.state.recentRepos = [gitRepo];
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('reads Codebase with git repositories and plain folders listed', () => {
    for (const forgeState of ['none', 'connected', 'unknown'] as const) {
      mocks.forgeState = forgeState;
      mocks.state.recentRepos = [gitRepo, plainFolder];
      const { container } = renderForm();
      expect(rowLabel(container)).toBe('Codebase');
      cleanup();
    }
  });

  it('counts a forge repository as a git repository', () => {
    mocks.forgeState = 'none';
    mocks.state.recentRepos = [forgeRepo, plainFolder];
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('reads Folder with an empty list and no forge connected', () => {
    mocks.forgeState = 'none';
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Folder');
  });

  it('reads Folder with only plain folders listed and a forge connected', () => {
    mocks.forgeState = 'connected';
    mocks.state.recentRepos = [plainFolder];
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Folder');
  });

  it('reads Codebase with an empty list and a forge connected', () => {
    mocks.forgeState = 'connected';
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('reads Codebase with an empty list while forge status is unknown', () => {
    mocks.forgeState = 'unknown';
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('treats a connected GitHub as a forge even if the store says none', () => {
    mocks.forgeState = 'none';
    mocks.authenticated = true;
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('treats a host member as having a forge', () => {
    mocks.forgeState = 'none';
    mocks.hostMember = true;
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('reads Folder when the selected plain folder is the only entry', () => {
    mocks.forgeState = 'connected';
    const { container } = render(RepoSelector, {
      props: {
        rowLabel: 'Codebase',
        emptyLabel: 'Add repository',
        value: '/notes/fresh',
        plainFolderSelected: true,
      },
    });
    expect(rowLabel(container)).toBe('Folder');
  });

  it('reads Folder for a selected plain folder in a mixed list', () => {
    for (const forgeState of ['none', 'connected', 'unknown'] as const) {
      mocks.forgeState = forgeState;
      mocks.state.recentRepos = [gitRepo, forgeRepo, plainFolder];
      const { container } = render(RepoSelector, {
        props: { rowLabel: 'Codebase', value: plainFolder.path, plainFolderSelected: true },
      });
      expect(rowLabel(container)).toBe('Folder');
      cleanup();
    }
  });

  it('reads Folder for a selected recent plain-folder row', () => {
    mocks.forgeState = 'connected';
    mocks.state.recentRepos = [gitRepo, plainFolder];
    const { container } = render(RepoSelector, {
      props: { rowLabel: 'Codebase', value: plainFolder.path },
    });
    expect(rowLabel(container)).toBe('Folder');
  });

  it('reads Codebase for a selected git repository in a plain-folder list', () => {
    mocks.forgeState = 'connected';
    mocks.state.recentRepos = [plainFolder, gitRepo];
    const { container } = render(RepoSelector, {
      props: { rowLabel: 'Codebase', value: gitRepo.path },
    });
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('keeps Codebase for a selected plain folder with plain folders not offered', () => {
    mocks.plainFoldersOffered = false;
    mocks.state.recentRepos = [gitRepo, plainFolder];
    const { container } = render(RepoSelector, {
      props: { rowLabel: 'Codebase', value: plainFolder.path, plainFolderSelected: true },
    });
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('switches live between Folder and Codebase as the selection changes', async () => {
    mocks.forgeState = 'connected';
    mocks.state.recentRepos = [gitRepo, plainFolder];
    const { container, rerender } = render(RepoSelector, {
      props: { rowLabel: 'Codebase', value: gitRepo.path },
    });
    expect(rowLabel(container)).toBe('Codebase');
    await rerender({ rowLabel: 'Codebase', value: plainFolder.path, plainFolderSelected: true });
    await waitFor(() => expect(rowLabel(container)).toBe('Folder'));
    await rerender({ rowLabel: 'Codebase', value: gitRepo.path, plainFolderSelected: false });
    await waitFor(() => expect(rowLabel(container)).toBe('Codebase'));
  });

  it('keeps Codebase for a selected git folder not in recents yet', () => {
    mocks.forgeState = 'none';
    mocks.state.recentRepos = [plainFolder];
    const { container } = render(RepoSelector, {
      props: { rowLabel: 'Codebase', emptyLabel: 'Add repository', value: '/repos/fresh' },
    });
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('keeps Codebase with plain folders not offered (Labs off)', () => {
    mocks.plainFoldersOffered = false;
    mocks.forgeState = 'none';
    mocks.state.recentRepos = [plainFolder];
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Codebase');
  });

  it('names the picker dialog with the same label', async () => {
    mocks.forgeState = 'none';
    const { container } = renderForm();
    await fireEvent.click(container.querySelector('button')!);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Folder' })).toBeTruthy());
  });

  it('updates live as forge connection and the list change', async () => {
    mocks.forgeState = 'none';
    const { container } = renderForm();
    expect(rowLabel(container)).toBe('Folder');

    mocks.forgeState = 'connected';
    notify();
    await waitFor(() => expect(rowLabel(container)).toBe('Codebase'));

    mocks.state.recentRepos = [plainFolder];
    notify();
    await waitFor(() => expect(rowLabel(container)).toBe('Folder'));

    mocks.state.recentRepos = [gitRepo, plainFolder];
    notify();
    await waitFor(() => expect(rowLabel(container)).toBe('Codebase'));

    mocks.forgeState = 'none';
    mocks.state.recentRepos = [];
    notify();
    await waitFor(() => expect(rowLabel(container)).toBe('Folder'));
    expect(container.textContent).not.toContain('Codebase/Project');
    expect(container.textContent).not.toContain('Codebase/Folder');
  });
});

describe('RepoSelector form search and add labels', () => {
  afterEach(() => cleanup());

  async function openPicker() {
    mocks.forgeState = 'connected';
    mocks.state.recentRepos = [gitRepo];
    const { container } = renderForm();
    await fireEvent.click(container.querySelector('button')!);
    return await screen.findByRole('dialog', { name: 'Codebase' });
  }

  it('names folders when plain folders are offered (Labs on)', async () => {
    const dialog = await openPicker();
    expect(within(dialog).getByRole('searchbox').getAttribute('placeholder')).toBe(
      'Search codebases or folders',
    );
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Add codebase or folder' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: 'Add codebase or folder' })).toBeTruthy(),
    );
  });

  it('labels an empty form field by the add action', () => {
    for (const [offered, label] of [
      [true, 'Add codebase or folder'],
      [false, 'Add codebase'],
    ] as const) {
      mocks.plainFoldersOffered = offered;
      const { container } = render(RepoSelector, { props: { rowLabel: 'Codebase', value: '' } });
      expect(container.querySelector('button')?.textContent).toContain(label);
      if (offered) expect(container.querySelector('button')?.textContent).toContain('folder');
      else expect(container.querySelector('button')?.textContent).not.toContain('folder');
      cleanup();
    }
  });

  it('keeps codebase-only labels with plain folders not offered (Labs off)', async () => {
    mocks.plainFoldersOffered = false;
    const dialog = await openPicker();
    expect(within(dialog).getByRole('searchbox').getAttribute('placeholder')).toBe(
      'Search codebases',
    );
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Add codebase' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: 'Add codebase' })).toBeTruthy(),
    );
  });
});

/**
 * @vitest-environment jsdom
 *
 * Regression: the repo picker dropdown must open on the tab matching the
 * selection restored through the `value` prop. A GitHub pick (owner/repo
 * shorthand or URL) used to be misclassified as local because
 * `selectedRepoType` defaulted to 'local' and the value-prop sync never
 * re-derived it, so the popup wrongly opened on "Copy local repo".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

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
      repositoryIdentity?: null;
    }>,
  };
  return {
    authenticated: false,
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
}));
vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-slice', () => ({
  setWorkspaceInitializerDefaultParentPath: (path: string) => ({
    type: 'wi/parent',
    payload: path,
  }),
  setWorkspaceInitializerLastSelectedRepo: (repo: unknown) => ({ type: 'wi/last', payload: repo }),
  setWorkspaceInitializerRecentRepos: (repos: unknown) => ({ type: 'wi/recent', payload: repos }),
  setWorkspaceInitializerRemoteSetups: (s: unknown) => ({ type: 'wi/remote', payload: s }),
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
import { appClient } from '$lib/client';
import type { GitLabProjectPickerProps } from '../gitlab-picker-types';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';

beforeEach(() => {
  mocks.appState = withLegacyPrincipal({});
  mocks.authenticated = false;
  vi.spyOn(appClient.git, 'originUrl').mockReset().mockResolvedValue(null);
});
import { warmImport } from '../../../../../test/warm-import';
import { invoke } from '$lib/electron-bridge';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';

const DROPDOWN_HEADING = 'What repo should we work on?';
const ACTIVE_TAB_CLASS = 'bg-background';

warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));

/** Render with the given props and open the dropdown from the trigger. */
async function openDropdown(props: Record<string, unknown> = {}) {
  const rendered = render(RepoSelector, { props });
  const trigger = rendered.container.querySelector('button')!;
  await fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy());
  return rendered;
}

/** The dropdown is portalled to <body>; find a tab button by its label. */
function tabButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button, `tab button "${label}"`).toBeTruthy();
  return button!;
}

const githubInput = () => screen.queryByPlaceholderText('owner/repo') as HTMLInputElement | null;

function gitlabProps(): GitLabProjectPickerProps {
  return {
    authenticated: true,
    scopeKey: 'owner/connection-a/checkout-a',
    instanceBaseUrl: 'https://git.example.test:8443/Forge',
    selectedProjectPath: 'group/subgroup/api',
    query: '',
    page: {
      status: 'ready',
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

describe('RepoSelector qualified GitLab choice', () => {
  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
  });

  it('keeps the GitLab tab absent until the consumer supplies the gated view', async () => {
    await openDropdown();
    expect(screen.queryByRole('tab', { name: 'GitLab' })).toBeNull();
  });

  it('restores a qualified project without treating its path as GitHub or local', async () => {
    const gitlab = gitlabProps();
    await openDropdown({ gitlab, gitlabSelected: true });
    expect(tabButton('Pick a repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(
      screen.getByRole('button', { name: 'Select a repository: group/subgroup/api' }),
    ).toBeTruthy();
    expect(screen.getByText('git.example.test:8443/Forge/')).toBeTruthy();
    expect(githubInput()).toBeNull();
    expect(gitlab.onOpenChange).toHaveBeenCalledWith(true, gitlab.scopeKey);
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action.type === 'githubRepoSearch/search'),
    ).toBe(false);
  });

  it('uses the qualified callback and closes without persisting a legacy path', async () => {
    const gitlab = gitlabProps();
    const onchange = vi.fn();
    await openDropdown({ gitlab, onchange });
    await fireEvent.click(tabButton('Pick a repo'));
    await fireEvent.click(screen.getByRole('option', { name: 'API group/subgroup/api' }));
    expect(gitlab.onSelect).toHaveBeenCalledWith('group/subgroup/api', gitlab.scopeKey);
    expect(onchange).not.toHaveBeenCalled();
    expect(mocks.dispatch.mock.calls.some(([action]) => action.type === 'wi/last')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(gitlab.onOpenChange).toHaveBeenLastCalledWith(false, gitlab.scopeKey);
  });

  it('removes the open GitLab view if the consumer withdraws the capability', async () => {
    const gitlab = gitlabProps();
    const view = await openDropdown({ gitlab, gitlabSelected: true });
    await view.rerender({ gitlab: undefined });
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(gitlab.onOpenChange).toHaveBeenLastCalledWith(false, gitlab.scopeKey);
  });

  it('keeps visibility stable when a search installs a new scoped page', async () => {
    const gitlab = gitlabProps();
    const view = await openDropdown({ gitlab, gitlabSelected: true });
    const nextScope = 'owner/connection-a/checkout-a/query-2';
    await view.rerender({ gitlab: { ...gitlab, scopeKey: nextScope, query: 'api' } });
    expect(gitlab.onOpenChange).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('option', { name: 'API group/subgroup/api' }));
    expect(gitlab.onSelect).toHaveBeenCalledWith('group/subgroup/api', nextScope);
    expect(gitlab.onOpenChange).toHaveBeenLastCalledWith(false, nextScope);
  });
});

describe('RepoSelector authenticated forge selection', () => {
  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
  });

  it('offers only a plain GitHub prefix while GitLab is disconnected', async () => {
    mocks.authenticated = true;
    const gitlab = { ...gitlabProps(), authenticated: false };
    await openDropdown({ gitlab });
    const tab = screen.getByRole('tab', { name: 'Pick a repo', exact: true });
    expect(tab.hasAttribute('aria-haspopup')).toBe(false);
    expect(screen.queryByRole('button', { name: /^(github.com|gitlab.com)\/$/ })).toBeNull();
    await fireEvent.click(tab);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(githubInput()).toBeTruthy();
    expect(gitlab.onOpenChange).not.toHaveBeenCalled();
  });

  it('offers only a plain GitLab prefix before its checkout capture is ready', async () => {
    const gitlab = {
      ...gitlabProps(),
      instanceBaseUrl: 'https://gitlab.com',
      scopeKey: '',
      page: { status: 'loading' as const },
    };
    await openDropdown({ gitlab });
    const tab = screen.getByRole('tab', { name: 'Pick a repo', exact: true });
    expect(tab.hasAttribute('aria-haspopup')).toBe(false);
    expect(screen.queryByRole('button', { name: /^(github.com|gitlab.com)\/$/ })).toBeNull();
    expect(githubInput()).toBeNull();
    expect(gitlab.onOpenChange).toHaveBeenCalledWith(true, '');
    expect(
      screen.getByRole('searchbox', { name: 'Search GitLab projects' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('uses the shared forge menu to switch between authenticated browsing flows', async () => {
    mocks.authenticated = true;
    const gitlab = gitlabProps();
    await openDropdown({ gitlab });
    const tab = screen.getByRole('button', { name: 'github.com/', exact: true });
    await fireEvent.pointerDown(tab, { button: 0, pointerType: 'mouse' });
    await waitFor(() => expect(screen.getAllByRole('menuitemradio')).toHaveLength(2));
    await fireEvent.click(
      screen.getByRole('menuitemradio', { name: 'git.example.test:8443/Forge/' }),
    );
    expect(gitlab.onOpenChange).toHaveBeenCalledWith(true, gitlab.scopeKey);
    expect(githubInput()).toBeNull();
    expect(screen.queryByRole('tab', { name: 'GitLab', exact: true })).toBeNull();
    await fireEvent.pointerDown(
      screen.getByRole('button', { name: 'git.example.test:8443/Forge/', exact: true }),
      { button: 0, pointerType: 'mouse' },
    );
    await fireEvent.click(await screen.findByRole('menuitemradio', { name: 'github.com/' }));
    expect(githubInput()).toBeTruthy();
    expect(gitlab.onOpenChange).toHaveBeenLastCalledWith(false, gitlab.scopeKey);
  });

  it('withdraws a revoked selected forge without forwarding another scoped selection', async () => {
    mocks.authenticated = true;
    const gitlab = gitlabProps();
    const view = await openDropdown({ gitlab, gitlabSelected: true });
    await view.rerender({ gitlab: { ...gitlab, authenticated: false } });
    await waitFor(() => expect(githubInput()).toBeTruthy());
    expect(gitlab.onOpenChange).toHaveBeenLastCalledWith(false, gitlab.scopeKey);
    expect(gitlab.onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByRole('tab', { name: 'Pick a repo', exact: true }).hasAttribute('aria-haspopup'),
    ).toBe(false);
  });

  it('switches to the remaining authenticated GitLab root when GitHub disconnects', async () => {
    mocks.authenticated = true;
    const gitlab = gitlabProps();
    await openDropdown({ gitlab });
    mocks.authenticated = false;
    for (const notify of mocks.listeners) notify();
    await waitFor(() => expect(githubInput()).toBeNull());
    expect(gitlab.onOpenChange).toHaveBeenCalledWith(true, gitlab.scopeKey);
    expect(
      screen.getByRole('tab', { name: 'Pick a repo', exact: true }).hasAttribute('aria-haspopup'),
    ).toBe(false);
  });

  it('retains the connect view and local/new actions when no forge is authenticated', async () => {
    await openDropdown({ gitlab: { ...gitlabProps(), authenticated: false } });
    expect(screen.getByRole('tab', { name: 'Pick a repo' }).hasAttribute('aria-haspopup')).toBe(
      false,
    );
    expect(githubInput()).toBeTruthy();
    await fireEvent.click(screen.getByRole('tab', { name: 'Copy local repo' }));
    expect(githubInput()).toBeNull();
    await fireEvent.click(screen.getByRole('tab', { name: 'New repo' }));
    expect(screen.getByRole('tab', { name: 'New repo' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('RepoSelector active forge recent search', () => {
  const recentLabels = () =>
    Array.from(document.body.querySelectorAll('[data-recent-repo-label]')).map((label) =>
      label.textContent?.replace(/\s+/g, ' ').trim(),
    );

  async function switchForge(from: string, to: string) {
    await fireEvent.pointerDown(screen.getByRole('button', { name: from, exact: true }), {
      button: 0,
      pointerType: 'mouse',
    });
    await fireEvent.click(await screen.findByRole('menuitemradio', { name: to, exact: true }));
  }

  beforeEach(() => {
    mocks.authenticated = true;
    mocks.state.recentRepos = [
      {
        path: 'octo/alpha',
        type: 'github',
        githubUrl: 'https://github.com/octo/alpha',
        name: 'alpha',
        owner: 'octo',
      },
      {
        path: 'octo/beta',
        type: 'github',
        githubUrl: 'https://github.com/octo/beta',
        name: 'beta',
        owner: 'octo',
      },
      {
        path: 'group/subgroup/api',
        type: 'github',
        githubUrl: 'https://git.example.test:8443/Forge/group/subgroup/api',
        name: 'api',
        owner: 'group/subgroup',
      },
      {
        path: 'group/subgroup/docs',
        type: 'github',
        githubUrl: 'https://git.example.test:8443/Forge/group/subgroup/docs',
        name: 'docs',
        owner: 'group/subgroup',
      },
      { path: '/work/local-project', type: 'local', name: 'local-project' },
    ];
  });

  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
    mocks.state.recentRepos = [];
  });

  it('uses the blank GitLab query after switching and preserves the GitHub query on return', async () => {
    const gitlab = gitlabProps();
    await openDropdown({ gitlab });
    await waitFor(() => expect(recentLabels()).toEqual(['octo / alpha', 'octo / beta']));
    await fireEvent.input(githubInput()!, { target: { value: 'beta' } });
    await waitFor(() => expect(recentLabels()).toEqual(['octo / beta']));

    await switchForge('github.com/', 'git.example.test:8443/Forge/');
    await waitFor(() =>
      expect(recentLabels()).toEqual(['group/subgroup / api', 'group/subgroup / docs']),
    );
    expect(gitlab.onSearch).not.toHaveBeenCalled();

    await switchForge('git.example.test:8443/Forge/', 'github.com/');
    expect(githubInput()?.value).toBe('beta');
    await waitFor(() => expect(recentLabels()).toEqual(['octo / beta']));
    await fireEvent.input(githubInput()!, { target: { value: '' } });
    await waitFor(() => expect(recentLabels()).toEqual(['octo / alpha', 'octo / beta']));
  });

  it('filters GitLab recents from its typed query without filtering local-copy rows', async () => {
    const gitlab = gitlabProps();
    const view = await openDropdown({ gitlab, gitlabSelected: true });
    const input = screen.getByRole('searchbox', { name: 'Search GitLab projects' });
    await fireEvent.input(input, { target: { value: 'docs' } });
    expect(gitlab.onSearch).toHaveBeenLastCalledWith('docs', gitlab.scopeKey);
    await view.rerender({ gitlab: { ...gitlab, query: 'docs' } });
    await waitFor(() => expect(recentLabels()).toEqual(['group/subgroup / docs']));

    await fireEvent.click(screen.getByRole('tab', { name: 'Copy local repo' }));
    await waitFor(() => expect(recentLabels()).toEqual(['local-project']));
    await fireEvent.click(screen.getByRole('tab', { name: 'Pick a repo' }));
    await waitFor(() => expect(recentLabels()).toEqual(['group/subgroup / docs']));
    expect(gitlab.onSearch).toHaveBeenCalledTimes(1);
  });

  it('restores GitLab recents when its visible search is cleared after a GitHub search', async () => {
    const gitlab = { ...gitlabProps(), query: 'docs' };
    const view = await openDropdown({ gitlab });
    await fireEvent.input(githubInput()!, { target: { value: 'beta' } });
    await switchForge('github.com/', 'git.example.test:8443/Forge/');

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search GitLab projects' }), {
      target: { value: '' },
    });
    expect(gitlab.onSearch).toHaveBeenLastCalledWith('', gitlab.scopeKey);
    await view.rerender({ gitlab: { ...gitlab, query: '' } });
    await waitFor(() =>
      expect(recentLabels()).toEqual(['group/subgroup / api', 'group/subgroup / docs']),
    );

    await switchForge('git.example.test:8443/Forge/', 'github.com/');
    expect(githubInput()?.value).toBe('beta');
    await waitFor(() => expect(recentLabels()).toEqual(['octo / beta']));
    expect(gitlab.onSelect).not.toHaveBeenCalled();
  });
});

describe('RepoSelector open tab derived from the value prop', () => {
  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
  });

  it('opens on "Pick a repo" with the input prefilled for an owner/repo shorthand value', async () => {
    await openDropdown({ value: 'octo/alpha' });

    expect(tabButton('Pick a repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(tabButton('Copy local repo').className).not.toContain(ACTIVE_TAB_CLASS);
    expect(githubInput()?.value).toBe('octo/alpha');
  });

  it('opens on "Pick a repo" with the input prefilled for a GitHub URL value', async () => {
    await openDropdown({ value: 'https://github.com/octo/alpha' });

    expect(tabButton('Pick a repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(githubInput()?.value).toBe('octo/alpha');
  });

  it('opens on "Copy local repo" for a filesystem path value', async () => {
    await openDropdown({ value: '/Users/dev/my-repo' });

    expect(tabButton('Copy local repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(tabButton('Pick a repo').className).not.toContain(ACTIVE_TAB_CLASS);
    expect(githubInput()).toBeNull();
  });

  it('defaults to "Pick a repo" when nothing is selected', async () => {
    await openDropdown();

    expect(tabButton('Pick a repo').className).toContain(ACTIVE_TAB_CLASS);
    expect(tabButton('Copy local repo').className).not.toContain(ACTIVE_TAB_CLASS);
    expect(githubInput()?.value).toBe('');
  });
});

// Regression: the open-time GitHub pre-fill used to seed searchTerm, so the
// Recent list opened filtered down to the already-selected repo. Only actual
// typing should filter it (intent-hq/monorepo).
describe('RepoSelector Recent list vs the open-time pre-fill', () => {
  const GITHUB_RECENTS = [
    {
      path: 'octo/alpha',
      type: 'github' as const,
      githubUrl: 'https://github.com/octo/alpha',
      name: 'alpha',
      owner: 'octo',
    },
    {
      path: 'octo/beta',
      type: 'github' as const,
      githubUrl: 'https://github.com/octo/beta',
      name: 'beta',
      owner: 'octo',
    },
  ];

  /** Normalized labels of the rendered Recent-list repo buttons. */
  const recentRepoLabels = () =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot=action-row-title]'))
      .map((b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((text) => /^octo \//i.test(text));

  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
    mocks.state.recentRepos = [];
  });

  it('shows the full Recent list on open despite the pre-filled input', async () => {
    mocks.state.recentRepos = GITHUB_RECENTS;
    await openDropdown({ value: 'octo/alpha' });

    expect(githubInput()?.value).toBe('octo/alpha');
    await waitFor(() => expect(recentRepoLabels()).toEqual(['octo / alpha', 'octo / beta']));
  });

  it('still filters the Recent list when the user types', async () => {
    mocks.state.recentRepos = GITHUB_RECENTS;
    await openDropdown({ value: 'octo/alpha' });
    await waitFor(() => expect(recentRepoLabels()).toHaveLength(2));

    await fireEvent.input(githubInput()!, { target: { value: 'beta' } });
    await waitFor(() => expect(recentRepoLabels()).toEqual(['octo / beta']));
  });
});

// Regression: a workspace-owned standalone checkout (repositoryPath ===
// worktreePath, i.e. a GitHub pick) used to be dropped from the recents merge
// entirely, so the most recently worked-on repo was missing from the
// "Pick a repo" RECENT list unless it happened to be in repos.known. It must
// surface as a path-less GitHub entry — and still never as a local copy source.
describe('RepoSelector Recent list derived from workspaces', () => {
  const invokeMock = vi.mocked(invoke);
  const workspaceListMock = vi.mocked(workspaceClient.list);

  /** A GitHub-pick workspace: standalone checkout owned by the workspace. */
  const ownedCheckoutWorkspace = (over: Record<string, unknown> = {}) => ({
    id: 'ws-gamma',
    repositoryPath: '/home/dev/.intent/workspaces/gamma',
    worktreePath: '/home/dev/.intent/workspaces/gamma',
    repositoryName: 'gamma',
    repositoryOwner: 'octo',
    lastActivity: '2026-02-01T00:00:00Z',
    createdAt: '2026-01-20T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    ...over,
  });

  /** A local-copy workspace: repositoryPath is the user's own source repo. */
  const localCopyWorkspace = {
    id: 'ws-local',
    repositoryPath: '/Users/dev/source-repo',
    worktreePath: '/home/dev/.intent/workspaces/wt-local',
    repositoryName: 'source-repo',
    lastActivity: '2026-01-10T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-10T00:00:00Z',
  };

  const setWorkspaces = (workspaces: unknown[]) =>
    workspaceListMock.mockImplementation(async () => ({ ok: true, data: workspaces }) as never);

  const setRegistry = (registry: unknown[]) =>
    invokeMock.mockImplementation(async (channel: string) =>
      channel === WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES
        ? ({ success: true, data: registry } as never)
        : ({ success: true, data: [] } as never),
    );

  const recentRepoLabels = () =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot=action-row-title]'))
      .map((b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((text) => /^octo \//i.test(text));

  const buttonTexts = () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).map(
      (b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );

  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
    mocks.state.recentRepos = [];
    workspaceListMock.mockImplementation(async () => ({ ok: true, data: [] }) as never);
    invokeMock.mockImplementation(async () => ({ success: true, data: [] }) as never);
  });

  it('surfaces a workspace-owned checkout as a GitHub entry, never a local one', async () => {
    setWorkspaces([ownedCheckoutWorkspace(), localCopyWorkspace]);
    await openDropdown();

    await waitFor(() => expect(recentRepoLabels()).toEqual(['octo / gamma']));

    expect(screen.queryByRole('img', { name: 'GitHub', exact: true })).toBeNull();
    await fireEvent.click(tabButton('Copy local repo'));
    await waitFor(() => expect(buttonTexts()).toContain('source-repo'));
    expect(recentRepoLabels()).toEqual([]);
    expect(buttonTexts()).not.toContain('gamma');
  });

  it('dedups a workspace-derived repo against its repos.known registry entry', async () => {
    setWorkspaces([ownedCheckoutWorkspace()]);
    setRegistry([
      {
        path: 'Octo/Gamma',
        name: 'Gamma',
        owner: 'Octo',
        githubUrl: 'https://github.com/Octo/Gamma',
        addedAt: '2026-01-01T00:00:00Z',
        lastUsedAt: '2026-01-15T00:00:00Z',
      },
    ]);
    await openDropdown();

    await waitFor(() =>
      expect(buttonTexts().filter((text) => /gamma/i.test(text))).toEqual(['Octo / Gamma']),
    );
  });

  it('resolves an actual self-managed checkout origin before assigning its forge', async () => {
    const gitlab = gitlabProps();
    setWorkspaces([ownedCheckoutWorkspace()]);
    vi.mocked(appClient.git.originUrl).mockResolvedValue(
      'https://git.example.test:8443/Forge/Team/Sub/Actual.git',
    );
    await openDropdown({ gitlab });
    const badge = await screen.findByRole('img', { name: 'GitLab', exact: true });
    const row = badge.closest('[data-slot="menu-action-row"]')!;
    expect(row.textContent).toContain('Team/Sub /');
    expect(row.textContent).toContain('Actual');
    expect(appClient.git.originUrl).toHaveBeenCalledWith('/home/dev/.intent/workspaces/gamma');
    await fireEvent.click(row);
    expect(gitlab.onSelect).toHaveBeenCalledWith('Team/Sub/Actual', gitlab.scopeKey);
  });

  it('does not read a remote workspace path on the local daemon to infer its forge', async () => {
    setWorkspaces([ownedCheckoutWorkspace({ isRemote: true }), localCopyWorkspace]);
    await openDropdown();
    await waitFor(() => expect(recentRepoLabels()).toEqual(['octo / gamma']));
    expect(appClient.git.originUrl).toHaveBeenCalledTimes(1);
    expect(appClient.git.originUrl).toHaveBeenCalledWith('/Users/dev/source-repo');
    expect(screen.queryByRole('img', { name: 'GitHub', exact: true })).toBeNull();
  });

  it('drops a late origin result when the admitted host connection changes', async () => {
    let resolveOrigin!: (url: string) => void;
    vi.mocked(appClient.git.originUrl).mockReturnValue(
      new Promise((resolve) => {
        resolveOrigin = resolve;
      }),
    );
    setWorkspaces([ownedCheckoutWorkspace()]);
    await openDropdown({ gitlab: gitlabProps() });
    await waitFor(() => expect(appClient.git.originUrl).toHaveBeenCalledTimes(1));
    mocks.appState = withLegacyPrincipal({ connections: { windowBackendId: 'another-host' } });
    setWorkspaces([]);
    for (const notify of mocks.listeners) notify();
    resolveOrigin('https://git.example.test:8443/Forge/Team/Private.git');
    await vi.mocked(appClient.git.originUrl).mock.results[0].value;
    await tick();
    await waitFor(() =>
      expect(document.querySelector('[data-testid=recent-repositories]')).toBeNull(),
    );
    expect(
      mocks.dispatch.mock.calls.some(([action]) => JSON.stringify(action).includes('Team/Private')),
    ).toBe(false);
  });

  it('orders RECENT most-recent-first across registry and workspace entries', async () => {
    mocks.state.recentRepos = [
      {
        path: 'octo/omega',
        type: 'github' as const,
        githubUrl: 'https://github.com/octo/omega',
        name: 'omega',
        owner: 'octo',
      },
    ];
    setWorkspaces([ownedCheckoutWorkspace()]);
    setRegistry([
      {
        path: 'octo/beta',
        name: 'beta',
        owner: 'octo',
        githubUrl: 'https://github.com/octo/beta',
        addedAt: '2026-01-01T00:00:00Z',
        lastUsedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    await openDropdown();

    // gamma (workspace activity, Feb) > beta (registry lastUsedAt, Jan) >
    // omega (persisted recent, no recency signal).
    await waitFor(() =>
      expect(recentRepoLabels()).toEqual(['octo / gamma', 'octo / beta', 'octo / omega']),
    );
  });
});

describe('RepoSelector recent forge identity', () => {
  afterEach(() => {
    cleanup();
    mocks.state.recentRepos = [];
    mocks.dispatch.mockReset();
  });

  it('shows the GitHub badge after the repository name even with only one forge', async () => {
    mocks.authenticated = true;
    mocks.state.recentRepos = [
      {
        path: 'octo/alpha',
        type: 'github',
        name: 'alpha',
        owner: 'octo',
        githubUrl: 'https://github.com/octo/alpha',
      },
    ];
    await openDropdown();
    const badge = await screen.findByRole('img', { name: 'GitHub', exact: true });
    const row = badge.closest('[data-slot="menu-action-row"]')!;
    const title = row.querySelector('[data-slot="action-row-title"]')!;
    expect(title.textContent).toContain('alpha');
    expect(title.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'github.com/', exact: true })).toBeNull();
  });

  it('shows and selects a saved self-managed GitLab recent through the original scoped callback', async () => {
    const gitlab = gitlabProps();
    mocks.state.recentRepos = [
      {
        path: 'https://git.example.test:8443/Forge/group/subgroup/api',
        type: 'github',
        name: 'api',
        owner: 'group/subgroup',
        githubUrl: 'https://git.example.test:8443/Forge/group/subgroup/api',
      },
    ];
    await openDropdown({ gitlab });
    const badge = await screen.findByRole('img', { name: 'GitLab', exact: true });
    const row = badge.closest('[data-slot="menu-action-row"]')!;
    expect(row.textContent).toContain('group/subgroup /');
    expect(screen.queryByRole('img', { name: 'GitHub', exact: true })).toBeNull();
    await fireEvent.click(row);
    expect(gitlab.onSelect).toHaveBeenCalledWith('group/subgroup/api', gitlab.scopeKey);
    expect(mocks.dispatch.mock.calls.some(([action]) => action.type === 'wi/last')).toBe(false);
  });

  it('keeps Copy local repo on its local flow even when the origin is GitLab', async () => {
    const gitlab = { ...gitlabProps(), scopeKey: '' };
    const onchange = vi.fn();
    mocks.state.recentRepos = [
      {
        path: '/owned/local-app',
        type: 'local',
        name: 'app',
        owner: 'group',
        githubUrl: 'https://git.example.test:8443/Forge/group/app',
      },
    ];
    await openDropdown({ gitlab, onchange });
    await fireEvent.click(screen.getByRole('tab', { name: 'Copy local repo', exact: true }));
    const badge = await screen.findByRole('img', { name: 'GitLab', exact: true });
    const row = badge.closest('button')!;
    expect(row.disabled).toBe(false);
    await fireEvent.click(row);
    expect(onchange.mock.calls[0][0].detail).toMatchObject({
      path: '/owned/local-app',
      type: 'local',
    });
    expect(gitlab.onSelect).not.toHaveBeenCalled();
  });

  it('does not select a GitLab recent until its original capture is ready', async () => {
    const gitlab = { ...gitlabProps(), scopeKey: '' };
    mocks.state.recentRepos = [
      {
        path: 'group/subgroup/api',
        type: 'github',
        name: 'api',
        owner: 'group/subgroup',
        githubUrl: 'https://git.example.test:8443/Forge/group/subgroup/api',
      },
    ];
    await openDropdown({ gitlab });
    const badge = await screen.findByRole('img', { name: 'GitLab', exact: true });
    const row = badge.closest('button')!;
    expect(row.disabled).toBe(true);
    await fireEvent.click(row);
    expect(gitlab.onSelect).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 *
 * Regression: the repo picker dropdown must open on the tab matching the
 * selection restored through the `value` prop. A GitHub pick (owner/repo
 * shorthand or URL) used to be misclassified as local because
 * `selectedRepoType` defaulted to 'local' and the value-prop sync never
 * re-derived it, so the popup wrongly opened on "Copy local repo".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (v: T) => void) {
      run(getter());
      return () => {};
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
  return { selector, state, dispatch: vi.fn() };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
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

vi.mock(
  '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-selectors',
  () => ({
    selectWorkspaceCreationDefaultParentPath: mocks.selector(() => ''),
    selectWorkspaceCreationRecentRepos: mocks.selector(() => mocks.state.recentRepos),
    selectWorkspaceCreationRemoteSetups: mocks.selector(() => []),
  }),
);
vi.mock(
  '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-slice',
  () => ({
    setWorkspaceCreationDefaultParentPath: (path: string) => ({
      type: 'wi/parent',
      payload: path,
    }),
    setWorkspaceCreationLastSelectedRepo: (repo: unknown) => ({ type: 'wc/last', payload: repo }),
    setWorkspaceCreationRecentRepos: (repos: unknown) => ({ type: 'wc/recent', payload: repos }),
    setWorkspaceCreationRemoteSetups: (s: unknown) => ({ type: 'wc/remote', payload: s }),
  }),
);
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
vi.mock('$lib/components/workspace/creation/DirectoryPickerModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/workspace/initializer/AddRemoteSetupModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import RepoSelector from '../RepoSelector.svelte';
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
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .map((b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((text) => text.startsWith('octo /'));

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
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .map((b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((text) => text.startsWith('octo /'));

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
      expect(buttonTexts().filter((text) => /gamma/i.test(text))).toEqual(['octo / gamma']),
    );
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

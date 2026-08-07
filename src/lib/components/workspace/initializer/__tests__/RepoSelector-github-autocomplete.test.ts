/**
 * @vitest-environment jsdom
 *
 * Autocomplete on the RepoSelector "Pick a repo" tab: the user's own GitHub
 * repos (client-side filtered) plus deduped global search results, rendered
 * under the `github.com/ owner/repo` input. Covers rendering, dedupe,
 * keyboard selection, the emitted pick detail, and the signed-out state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  return {
    selector,
    dispatch: vi.fn(),
    isAuthenticated: true,
    reposLoaded: true,
    reposError: null as string | null,
    repos: [] as Array<{ id: string; owner: string; name: string }>,
    searchResults: [] as Array<{ id: string; owner: string; name: string }>,
    searchLastQuery: '',
    recentRepos: [] as Array<{
      path: string;
      type: 'local' | 'github';
      githubUrl?: string;
      name: string;
      owner?: string;
    }>,
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: () => ({ type: 'githubAuth/initialize' }),
  startGitHubAuth: () => ({ type: 'githubAuth/start' }),
  cancelGitHubAuth: () => ({ type: 'githubAuth/cancel' }),
  clearGitHubAuthError: () => ({ type: 'githubAuth/clearError' }),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(() => mocks.isAuthenticated),
  selectGitHubAuthIsAuthenticating: mocks.selector(() => false),
  selectGitHubAuthDeviceFlow: mocks.selector(() => null),
  selectGitHubAuthError: mocks.selector(() => null),
  selectGitHubAuthRequiresDaemonAuth: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-slice', () => ({
  loadGithubRepos: () => ({ type: 'githubRepos/load' }),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-selectors', () => ({
  selectGithubRepos: mocks.selector(() => mocks.repos),
  selectGithubReposError: mocks.selector(() => mocks.reposError),
  selectGithubReposLoaded: mocks.selector(() => mocks.reposLoaded),
  selectGithubReposLoading: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-slice', () => ({
  searchGithubRepos: (query: string) => ({ type: 'githubRepoSearch/search', payload: [query] }),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-selectors', () => ({
  selectGithubRepoSearchLastQuery: mocks.selector(() => mocks.searchLastQuery),
  selectGithubRepoSearchLoading: mocks.selector(() => false),
  selectGithubRepoSearchResults: mocks.selector(() => mocks.searchResults),
}));

vi.mock(
  '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors',
  () => ({
    selectWorkspaceInitializerDefaultParentPath: mocks.selector(() => ''),
    selectWorkspaceInitializerRecentRepos: mocks.selector(() => mocks.recentRepos),
    selectWorkspaceInitializerRemoteSetups: mocks.selector(() => []),
  }),
);
vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-slice', () => ({
  setWorkspaceInitializerDefaultParentPath: (path: string) => ({ type: 'wi/parent', payload: path }),
  setWorkspaceInitializerLastSelectedRepo: (repo: unknown) => ({ type: 'wi/last', payload: repo }),
  setWorkspaceInitializerRecentRepos: (repos: unknown) => ({ type: 'wi/recent', payload: repos }),
  setWorkspaceInitializerRemoteSetups: (s: unknown) => ({ type: 'wi/remote', payload: s }),
}));
vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  replaceWorkspaceList: (workspaces: unknown) => ({ type: 'workspace/replace', payload: workspaces }),
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
import { warmImport } from '../../../../../test/warm-import';

const DROPDOWN_HEADING = 'What repo should we work on?';

warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));

// The dropdown content is portalled to <body>, so suggestions are queried globally.
const suggestions = () =>
  Array.from(
    document.body.querySelectorAll<HTMLButtonElement>(
      '#repo-selector-github-suggestions button[role="option"]',
    ),
  );

const rowText = (button: HTMLButtonElement) => button.textContent?.replace(/\s+/g, ' ').trim();

/** Open the dropdown (defaults to the "Pick a repo" tab) and return its input. */
async function openGithubTab(props: Record<string, unknown> = {}) {
  const rendered = render(RepoSelector, { props });
  const trigger = rendered.container.querySelector('button')!;
  await fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy());
  const input = screen.getByPlaceholderText('owner/repo') as HTMLInputElement;
  return { ...rendered, input };
}

describe('RepoSelector "Pick a repo" autocomplete', () => {
  beforeEach(() => {
    mocks.isAuthenticated = true;
    mocks.reposLoaded = true;
    mocks.reposError = null;
    mocks.repos = [
      { id: 'octo/alpha', owner: 'octo', name: 'alpha' },
      { id: 'octo/beta', owner: 'octo', name: 'beta' },
    ];
    mocks.searchResults = [];
    mocks.searchLastQuery = '';
    mocks.recentRepos = [];
  });

  afterEach(() => {
    cleanup();
    mocks.dispatch.mockReset();
  });

  it('loads the user repos on open and lists them as suggestions', async () => {
    mocks.reposLoaded = false;
    await openGithubTab();

    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'githubRepos/load' });
      expect(suggestions().map(rowText)).toEqual(['octo /alpha', 'octo /beta']);
    });
  });

  it('filters own repos by the typed text and dispatches the global search', async () => {
    const { input } = await openGithubTab();

    await fireEvent.input(input, { target: { value: 'alpha' } });

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'githubRepoSearch/search',
      payload: ['alpha'],
    });
    await waitFor(() => {
      expect(suggestions().map(rowText)).toEqual(['octo /alpha']);
    });
  });

  it('appends search results, deduped against own repos and the Recent list', async () => {
    mocks.recentRepos = [
      {
        path: 'facebook/react',
        type: 'github',
        githubUrl: 'https://github.com/facebook/react',
        name: 'react',
        owner: 'facebook',
      },
    ];
    mocks.searchResults = [
      { id: 'octo/alpha', owner: 'octo', name: 'alpha' },
      { id: 'facebook/react', owner: 'facebook', name: 'react' },
      { id: 'other/alphabet', owner: 'other', name: 'alphabet' },
    ];
    mocks.searchLastQuery = 'alpha';

    const { input } = await openGithubTab();
    await fireEvent.input(input, { target: { value: 'alpha' } });

    await waitFor(() => {
      expect(suggestions().map(rowText)).toEqual(['octo /alpha', 'other /alphabet']);
    });
  });

  it('selects a suggestion by click and emits a path-less GitHub pick', async () => {
    const onchange = vi.fn();
    await openGithubTab({ onchange });

    await waitFor(() => expect(suggestions().length).toBe(2));
    await fireEvent.click(suggestions()[1]);

    expect(onchange).toHaveBeenCalledTimes(1);
    expect(onchange.mock.calls[0][0].detail).toEqual({
      path: 'octo/beta',
      type: 'github',
      githubUrl: 'https://github.com/octo/beta',
      isNewRepo: false,
      isValidPath: true,
    });
    await waitFor(() => expect(screen.queryByText(DROPDOWN_HEADING)).toBeFalsy());
  });

  it('navigates with arrow keys and selects the highlighted suggestion on Enter', async () => {
    const onchange = vi.fn();
    const { input } = await openGithubTab({ onchange });

    await waitFor(() => expect(suggestions().length).toBe(2));
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(suggestions()[1].getAttribute('aria-selected')).toBe('true');
    });

    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange.mock.calls[0][0].detail.path).toBe('octo/beta');
  });

  it('Enter on free text commits the pick and closes the dropdown in one keypress', async () => {
    const onchange = vi.fn();
    const { input } = await openGithubTab({ onchange });

    await fireEvent.input(input, { target: { value: 'someone/elsewhere' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).toHaveBeenCalledTimes(1);
    expect(onchange.mock.calls[0][0].detail).toEqual({
      path: 'someone/elsewhere',
      type: 'github',
      githubUrl: 'https://github.com/someone/elsewhere',
      isNewRepo: false,
      isValidPath: true,
    });
    await waitFor(() => expect(screen.queryByText(DROPDOWN_HEADING)).toBeFalsy());
  });

  it('Enter on free text that is not a valid owner/repo neither commits nor closes', async () => {
    const onchange = vi.fn();
    const { input } = await openGithubTab({ onchange });

    await fireEvent.input(input, { target: { value: 'notarepo' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).not.toHaveBeenCalled();
    expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
  });

  it('errored repo load: shows a retry action that re-dispatches the load', async () => {
    mocks.reposError = 'boom';
    await openGithubTab();

    expect(screen.getByText('Repository suggestions are unavailable right now.')).toBeTruthy();
    expect(suggestions()).toHaveLength(0);
    // The on-demand effect skips loads while an error is present.
    expect(mocks.dispatch.mock.calls.map((call) => call[0]?.type)).not.toContain(
      'githubRepos/load',
    );

    await fireEvent.click(screen.getByText('Try again'));

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'githubRepos/load' });
  });

  it('signed out: shows the connect hint, dispatches no repo load or search, and still confirms typed input', async () => {
    mocks.isAuthenticated = false;
    const onchange = vi.fn();
    const { input } = await openGithubTab({ onchange });

    expect(
      screen.getByText('Sign in with GitHub to see repository suggestions'),
    ).toBeTruthy();
    expect(suggestions()).toHaveLength(0);

    await fireEvent.input(input, { target: { value: 'someone/elsewhere' } });

    const dispatchedTypes = mocks.dispatch.mock.calls.map((call) => call[0]?.type);
    expect(dispatchedTypes).not.toContain('githubRepos/load');
    expect(dispatchedTypes).not.toContain('githubRepoSearch/search');

    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onchange.mock.calls[0][0].detail.path).toBe('someone/elsewhere');
  });
});

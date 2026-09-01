/**
 * @vitest-environment jsdom
 *
 * BranchSelector regression tests (P3 FE audit / 4C-4): branch lists come from
 * the daemon only — `git.getBranches` for local repos, `github.branches.list`
 * (via `appClient.integrations.githubBranches`) for URL-only GitHub repos.
 * A fetch failure renders an explicit error/auth state and NEVER the old
 * fabricated ['main','master',...] fallback.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockGetBranches,
  mockBranchStatus,
  mockGithubBranches,
  mockGithubBranchesCached,
  debugFlags,
  savedBranchByRepo,
} = vi.hoisted(() => ({
  mockGetBranches: vi.fn(),
  mockBranchStatus: vi.fn(async () => null),
  mockGithubBranches: vi.fn(),
  mockGithubBranchesCached: vi.fn(),
  // Mutable knobs for the module-level mocks below. Tests arm form
  // persistence + a saved branch; both are reset in beforeEach.
  debugFlags: {} as Record<string, boolean>,
  savedBranchByRepo: {} as Record<string, string>,
}));

vi.mock('$lib/client', () => ({
  appClient: {
    git: { getBranches: mockGetBranches, branchStatus: mockBranchStatus },
    integrations: {
      githubBranches: mockGithubBranches,
      githubBranchesCached: mockGithubBranchesCached,
    },
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: {},
    // Mirror the real reducer: persisting a branch updates the saved map
    // (this is exactly the clobbering the reconciliation fix guards against).
    dispatch: (action: { type?: string; payload?: [string, string] }) => {
      if (action?.type === 'workspaceInitializer/setBranchForRepo' && action.payload) {
        const [repoPath, branch] = action.payload;
        savedBranchByRepo[repoPath] = branch;
      }
    },
  });
});

vi.mock(
  '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors',
  async () => {
    const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
    const store = createAppStoreMock({ state: {} });
    return {
      // Return the shared mutable map so dispatched saves are visible to the
      // component's `$branchByRepo$` reads without a store re-emit.
      selectWorkspaceInitializerBranchByRepo: store.createSelector(() => savedBranchByRepo),
    };
  },
);

vi.mock('$store/renderer/slices/workspace/workspace-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectWorkspaceItems: store.createSelector(() => []),
  };
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-slice', () => ({
  setWorkspaceInitializerBranchForRepo: (repoPath: string, branch: string) => ({
    type: 'workspaceInitializer/setBranchForRepo',
    payload: [repoPath, branch],
  }),
}));

// Debug toggles (branch caching, form persistence, simulated delays) default
// off; tests opt in via `debugFlags`.
vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: (key: string) => debugFlags[key] ?? false },
}));
vi.mock('$lib/utils/performance', () => ({
  performanceMonitor: { start: vi.fn(), end: vi.fn() },
}));

import BranchSelector from '../BranchSelector.svelte';

/** Open the dropdown by clicking the select trigger (first button rendered). */
async function openDropdown(container: HTMLElement) {
  const trigger = container.querySelector('button');
  expect(trigger).toBeTruthy();
  await fireEvent.click(trigger!);
}

/** A promise the test resolves manually (to hold the fresh GitHub API list open). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('BranchSelector (daemon-backed branch listing, no fabricated fallbacks)', () => {
  beforeEach(() => {
    mockGetBranches.mockReset();
    mockGithubBranches.mockReset();
    mockGithubBranchesCached.mockReset();
    for (const key of Object.keys(debugFlags)) delete debugFlags[key];
    for (const key of Object.keys(savedBranchByRepo)) delete savedBranchByRepo[key];
    // Default: cold cache — the cached-first path is a no-op unless a test arms it.
    mockGithubBranchesCached.mockResolvedValue({ cached: false, branches: [] });
  });

  it('local repo: renders an error state and no fake branches when git.getBranches fails', async () => {
    mockGetBranches.mockResolvedValue(null); // live seam folds errors to null
    const onchange = vi.fn();
    const { container } = render(BranchSelector, {
      props: { repoPath: '/tmp/repo', repoType: 'local', onchange },
    });

    await waitFor(() => expect(mockGetBranches).toHaveBeenCalledWith('/tmp/repo', true));
    await openDropdown(container);
    // "Failed to fetch branches" maps to the friendly enter-manually message.
    await waitFor(() =>
      expect(
        screen.getByText('Network error. Check connection or enter branch manually.'),
      ).toBeTruthy(),
    );

    // The old fabricated ['main','master','develop',...] list must never render.
    expect(screen.queryByText('master')).toBeNull();
    expect(screen.queryByText('develop')).toBeNull();
    expect(onchange).not.toHaveBeenCalled();

    const manualInput = screen.getByPlaceholderText('Search or enter branch name...');
    await fireEvent.input(manualInput, { target: { value: 'manual-recovery' } });
    await fireEvent.click(screen.getByRole('button', { name: /Use branch: manual-recovery/ }));
    expect(onchange).toHaveBeenCalledOnce();
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'manual-recovery' });
  });

  it('local repo: auto-selects the daemon-reported non-main current branch', async () => {
    mockGetBranches.mockResolvedValue({
      branches: ['master'],
      remoteBranches: [],
      defaultBranch: 'master',
      currentBranch: 'master',
    });
    const onchange = vi.fn();

    render(BranchSelector, {
      props: { repoPath: '/tmp/non-main-repo', repoType: 'local', value: '', onchange },
    });

    await waitFor(() => expect(mockGetBranches).toHaveBeenCalledWith('/tmp/non-main-repo', true));
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'master' });
  });

  it('uses a textless Toggle beside the work-directly label', async () => {
    mockGetBranches.mockResolvedValue({
      branches: ['main'],
      remoteBranches: [],
      defaultBranch: 'main',
      currentBranch: 'main',
    });
    const onSkipIsolationChange = vi.fn();
    const { container } = render(BranchSelector, {
      props: {
        repoPath: '/tmp/repo',
        repoType: 'local',
        skipIsolation: false,
        onSkipIsolationChange,
      },
    });

    await waitFor(() => expect(mockGetBranches).toHaveBeenCalledWith('/tmp/repo', true));
    await openDropdown(container);
    const toggle = await screen.findByRole('button', {
      name: 'Work directly in your folder on the main branch',
      hidden: true,
      pressed: false,
    });
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(toggle);
    expect(onSkipIsolationChange).toHaveBeenCalledWith(true);
  });

  it.each([
    ['explicit', true],
    ['persisted', false],
  ])('local repo: keeps a valid %s branch authoritative', async (_, explicit) => {
    debugFlags.enableFormPersistence = !explicit;
    savedBranchByRepo['/tmp/non-main-repo'] = explicit ? '' : 'release';
    mockGetBranches.mockResolvedValue({
      branches: ['master', 'release'],
      remoteBranches: [],
      defaultBranch: 'master',
      currentBranch: 'master',
    });
    const onchange = vi.fn();

    render(BranchSelector, {
      props: {
        repoPath: '/tmp/non-main-repo',
        repoType: 'local',
        value: explicit ? 'release' : '',
        onchange,
      },
    });

    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'release' });
  });

  it('GitHub-URL repo: lists daemon branches and auto-selects the default branch', async () => {
    mockGithubBranches.mockResolvedValue({
      branches: ['dev', 'feat/x'],
      defaultBranch: 'dev',
    });
    const onchange = vi.fn();
    render(BranchSelector, {
      props: {
        repoPath: 'octo/intent',
        repoType: 'github',
        githubUrl: 'https://github.com/octo/intent',
        onchange,
      },
    });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent'));
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'dev' });
  });

  it('GitHub-URL repo: failure renders the error state, never fabricated branches', async () => {
    mockGithubBranches.mockRejectedValue(new Error('rate limit exceeded'));
    const onchange = vi.fn();
    const { container } = render(BranchSelector, {
      props: {
        repoPath: 'octo/intent',
        repoType: 'github',
        githubUrl: 'https://github.com/octo/intent',
        onchange,
      },
    });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalled());
    await openDropdown(container);
    await waitFor(() =>
      expect(
        screen.getByText('GitHub API rate limit exceeded. Please wait or enter branch manually.'),
      ).toBeTruthy(),
    );
    expect(screen.getByText('You can still type a branch name manually above.')).toBeTruthy();
    expect(screen.queryByText('main')).toBeNull();
    expect(onchange).not.toHaveBeenCalled();
  });

  it('trigger shows an inline spinner with an sr-only label while branches load', async () => {
    let resolveBranches!: (value: unknown) => void;
    mockGetBranches.mockReturnValue(new Promise((resolve) => (resolveBranches = resolve)));
    const { container } = render(BranchSelector, {
      props: { repoPath: '/tmp/repo', repoType: 'local' },
    });

    const trigger = container.querySelector('button');
    expect(trigger).toBeTruthy();
    // Spinner appears as soon as the (debounced) fetch is scheduled — it must
    // cover the debounce delay before git.getBranches is actually called.
    await waitFor(() => expect(trigger!.querySelector('.animate-spin')).toBeTruthy());
    if (mockGetBranches.mock.calls.length === 0) {
      // Still inside the debounce window: the spinner is already visible.
      expect(trigger!.querySelector('.animate-spin')).toBeTruthy();
    }

    // Spinner replaces the old pulse skeleton and persists while the fetch is in flight.
    await waitFor(() => expect(mockGetBranches).toHaveBeenCalled());
    expect(trigger!.querySelector('.animate-spin')).toBeTruthy();
    expect(trigger!.querySelector('.animate-pulse')).toBeNull();
    // Accessible loading label.
    expect(screen.getByText('Waiting for branch selection...')).toBeTruthy();

    resolveBranches(null);
  });

  it('GitHub-URL repo: "GitHub is not configured." maps to the connect-GitHub auth state', async () => {
    mockGithubBranches.mockRejectedValue(new Error('GitHub is not configured.'));
    render(BranchSelector, {
      props: {
        repoPath: 'octo/intent',
        repoType: 'github',
        githubUrl: 'https://github.com/octo/intent',
      },
    });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalled());
    // The trigger itself surfaces the auth hint (no dropdown needed).
    await waitFor(() => expect(screen.getByText('Connect GitHub')).toBeTruthy());
  });
});

describe('BranchSelector (cached-first GitHub load, github.branches.listCached §5.27)', () => {
  beforeEach(() => {
    mockGetBranches.mockReset();
    mockGithubBranches.mockReset();
    mockGithubBranchesCached.mockReset();
    for (const key of Object.keys(debugFlags)) delete debugFlags[key];
    for (const key of Object.keys(savedBranchByRepo)) delete savedBranchByRepo[key];
  });

  const githubProps = {
    repoPath: 'octo/intent',
    repoType: 'github' as const,
    githubUrl: 'https://github.com/octo/intent',
  };

  it('warm cache: renders cached branches and selects the default before the fresh list arrives', async () => {
    mockGithubBranchesCached.mockResolvedValue({
      cached: true,
      branches: ['dev', 'feat/x'],
      defaultBranch: 'dev',
    });
    const fresh = deferred<{ branches: string[]; defaultBranch?: string }>();
    mockGithubBranches.mockReturnValue(fresh.promise);
    const onchange = vi.fn();
    const { container } = render(BranchSelector, { props: { ...githubProps, onchange } });

    await waitFor(() => expect(mockGithubBranchesCached).toHaveBeenCalledWith('octo', 'intent'));
    // Cached hit paints instantly: default branch selected, trigger spinner gone —
    // all while the authoritative GitHub API request is still in flight.
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'dev' });
    expect(container.querySelector('.animate-spin')).toBeNull();

    // Fresh list arrives with an extra branch: the list reconciles and the
    // still-existing selection is kept (no second onchange).
    fresh.resolve({ branches: ['dev', 'feat/x', 'extra'], defaultBranch: 'dev' });
    await openDropdown(container);
    await waitFor(() => expect(screen.getByText('extra')).toBeTruthy());
    expect(onchange).toHaveBeenCalledTimes(1);
  });

  it('ls-remote fallback: a cache miss with populated branches paints before the fresh list arrives', async () => {
    // PROTOCOL §5.27: on a cache miss the daemon falls back to one
    // `git ls-remote` round trip — cached: false but branches populated.
    mockGithubBranchesCached.mockResolvedValue({
      cached: false,
      branches: ['dev', 'feat/x'],
      defaultBranch: 'dev',
      source: 'ls-remote',
    });
    const fresh = deferred<{ branches: string[]; defaultBranch?: string }>();
    mockGithubBranches.mockReturnValue(fresh.promise);
    const onchange = vi.fn();
    const { container } = render(BranchSelector, { props: { ...githubProps, onchange } });

    await waitFor(() => expect(mockGithubBranchesCached).toHaveBeenCalledWith('octo', 'intent'));
    // Fallback paints like a warm cache: default branch selected, trigger
    // spinner gone — all while the authoritative GitHub API request is still
    // in flight.
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'dev' });
    expect(container.querySelector('.animate-spin')).toBeNull();

    // The authoritative list still wins when it settles: the extra branch
    // appears and the still-existing selection is kept (no second onchange).
    fresh.resolve({ branches: ['dev', 'feat/x', 'extra'], defaultBranch: 'dev' });
    await openDropdown(container);
    await waitFor(() => expect(screen.getByText('extra')).toBeTruthy());
    expect(onchange).toHaveBeenCalledTimes(1);
  });

  it('empty cold cache: keeps the loading skeleton until the GitHub API responds (behavior unchanged)', async () => {
    mockGithubBranchesCached.mockResolvedValue({ cached: false, branches: [] });
    const fresh = deferred<{ branches: string[]; defaultBranch?: string }>();
    mockGithubBranches.mockReturnValue(fresh.promise);
    const onchange = vi.fn();
    const { container } = render(BranchSelector, { props: { ...githubProps, onchange } });

    await waitFor(() => expect(mockGithubBranchesCached).toHaveBeenCalledWith('octo', 'intent'));
    // Cold cache: still loading (inline trigger spinner), nothing selected.
    await waitFor(() => expect(container.querySelector('.animate-spin')).toBeTruthy());
    expect(onchange).not.toHaveBeenCalled();

    fresh.resolve({ branches: ['dev', 'feat/x'], defaultBranch: 'dev' });
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'dev' });
    await waitFor(() => expect(container.querySelector('.animate-spin')).toBeNull());
  });

  it('vanished branch: a cached selection missing from the fresh list switches to the default branch', async () => {
    // Cached default 'old' gets selected first; the fresh list no longer has it.
    mockGithubBranchesCached.mockResolvedValue({
      cached: true,
      branches: ['old', 'dev'],
      defaultBranch: 'old',
    });
    const fresh = deferred<{ branches: string[]; defaultBranch?: string }>();
    mockGithubBranches.mockReturnValue(fresh.promise);
    const onchange = vi.fn();
    render(BranchSelector, { props: { ...githubProps, onchange } });

    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'old' });

    fresh.resolve({ branches: ['dev', 'feat/x'], defaultBranch: 'dev' });
    // Never leave a vanished branch selected: selection flips to the fresh
    // default branch and the parent is notified.
    await waitFor(() => expect(onchange).toHaveBeenCalledTimes(2));
    expect(onchange.mock.calls[1][0].detail).toEqual({ branch: 'dev' });
  });

  it('refresh during in-flight fetch: the superseded fetch cannot surface its error or clobber the refresh results', async () => {
    mockGithubBranchesCached.mockResolvedValue({
      cached: true,
      branches: ['dev', 'feat/x'],
      defaultBranch: 'dev',
    });
    const fresh1 = deferred<{ branches: string[]; defaultBranch?: string }>();
    const fresh2 = deferred<{ branches: string[]; defaultBranch?: string }>();
    const rejectable = fresh1.promise.then((v) => {
      if (v === null) throw new Error('rate limit exceeded');
      return v;
    });
    mockGithubBranches.mockReturnValueOnce(rejectable).mockReturnValueOnce(fresh2.promise);
    const onchange = vi.fn();
    const { container } = render(BranchSelector, { props: { ...githubProps, onchange } });

    // Warm cache paints instantly, re-enabling the refresh button while the
    // authoritative request is still in flight.
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    await openDropdown(container);
    // The dropdown content is portaled to document.body; the refresh button
    // sits next to the search input in the dropdown header.
    const searchInput = await screen.findByPlaceholderText('Search or enter branch name...');
    const refreshButton = searchInput.closest('.flex.gap-2')?.querySelector('button');
    expect(refreshButton).toBeTruthy();
    await fireEvent.click(refreshButton!);
    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledTimes(2));

    // The superseded first fetch fails — its error must never render because
    // the refresh's fetch owns the state now.
    fresh1.resolve(null as never);
    fresh2.resolve({ branches: ['dev', 'feat/x', 'extra'], defaultBranch: 'dev' });
    await waitFor(() => expect(screen.getByText('extra')).toBeTruthy());
    expect(
      screen.queryByText('GitHub API rate limit exceeded. Please wait or enter branch manually.'),
    ).toBeNull();
  });

  it('stale cache: the saved branch missing from the cache is re-selected once the fresh list has it', async () => {
    // The user's saved branch exists on GitHub but is absent from the stale
    // local cache. The cached paint auto-selects the default (persisting it,
    // which clobbers the live saved value) — reconciliation must still find
    // the pre-paint saved branch and switch back to it.
    debugFlags.enableFormPersistence = true;
    savedBranchByRepo['octo/intent'] = 'feat/saved';
    mockGithubBranchesCached.mockResolvedValue({
      cached: true,
      branches: ['dev', 'feat/x'],
      defaultBranch: 'dev',
    });
    const fresh = deferred<{ branches: string[]; defaultBranch?: string }>();
    mockGithubBranches.mockReturnValue(fresh.promise);
    const onchange = vi.fn();
    render(BranchSelector, { props: { ...githubProps, onchange } });

    // Cached paint: saved branch not in the cached list → default selected
    // (and persisted, overwriting the saved map entry).
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'dev' });
    expect(savedBranchByRepo['octo/intent']).toBe('dev');

    fresh.resolve({ branches: ['dev', 'feat/x', 'feat/saved'], defaultBranch: 'dev' });
    await waitFor(() => expect(onchange).toHaveBeenCalledTimes(2));
    expect(onchange.mock.calls[1][0].detail).toEqual({ branch: 'feat/saved' });
  });
});

describe('BranchSelector (server-side prefix search, github.branches.list prefix §5.27)', () => {
  beforeEach(() => {
    mockGetBranches.mockReset();
    mockGithubBranches.mockReset();
    mockGithubBranchesCached.mockReset();
    for (const key of Object.keys(debugFlags)) delete debugFlags[key];
    for (const key of Object.keys(savedBranchByRepo)) delete savedBranchByRepo[key];
    mockGithubBranchesCached.mockResolvedValue({ cached: false, branches: [] });
  });

  const githubProps = {
    repoPath: 'octo/intent',
    repoType: 'github' as const,
    githubUrl: 'https://github.com/octo/intent',
  };

  it('typing a search prefix asks the daemon for matching branches and merges them into the list', async () => {
    // First page has no feat/beyond-page — it only exists server-side.
    // Default 'dev' (not 'main') so the trigger text never collides with the
    // filtered-out assertion below.
    mockGithubBranches.mockImplementation(async (_owner, _repo, prefix?: string) =>
      prefix
        ? { branches: ['feat/beyond-page', 'feat/x'], defaultBranch: undefined }
        : { branches: ['main', 'dev', 'feat/x'], defaultBranch: 'dev' },
    );
    const { container } = render(BranchSelector, { props: githubProps });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent'));
    await openDropdown(container);
    const searchInput = await screen.findByPlaceholderText('Search or enter branch name...');
    await fireEvent.input(searchInput, { target: { value: 'feat' } });

    // Debounced search fires the prefix-filtered daemon request…
    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent', 'feat'));
    // …and the beyond-first-page branch becomes selectable.
    await waitFor(() => expect(screen.getByText('feat/beyond-page')).toBeTruthy());
    expect(screen.getByText('feat/x')).toBeTruthy();
    // The non-matching first-page branch is filtered out of the view.
    expect(screen.queryByText('main')).toBeNull();
  });

  it('clearing the search restores the unfiltered first-page listing', async () => {
    mockGithubBranches.mockImplementation(async (_owner, _repo, prefix?: string) =>
      prefix
        ? { branches: ['feat/beyond-page'], defaultBranch: undefined }
        : { branches: ['main', 'dev'], defaultBranch: 'dev' },
    );
    const { container } = render(BranchSelector, { props: githubProps });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent'));
    await openDropdown(container);
    const searchInput = await screen.findByPlaceholderText('Search or enter branch name...');
    await fireEvent.input(searchInput, { target: { value: 'feat' } });
    await waitFor(() => expect(screen.getByText('feat/beyond-page')).toBeTruthy());

    await fireEvent.input(searchInput, { target: { value: '' } });
    // Back to the first-page view: search results dropped, no extra daemon call
    // for the empty prefix. ('dev' also renders in the trigger as the selected
    // default, so assert on 'main' — list-only.)
    await waitFor(() => expect(screen.queryByText('feat/beyond-page')).toBeNull());
    expect(screen.getByText('main')).toBeTruthy();
    expect(mockGithubBranches).not.toHaveBeenCalledWith('octo', 'intent', '');
  });

  it('shorthand repoPath with an empty githubUrl still resolves owner/repo for the prefix search', async () => {
    // fetchBranches treats an empty githubUrl as absent and reconstructs it
    // from the owner/repo shorthand — the prefix search must do the same.
    mockGithubBranches.mockImplementation(async (_owner, _repo, prefix?: string) =>
      prefix
        ? { branches: ['feat/beyond-page'], defaultBranch: undefined }
        : { branches: ['main', 'dev'], defaultBranch: 'dev' },
    );
    const { container } = render(BranchSelector, {
      props: { repoPath: 'octo/intent', repoType: 'github' as const, githubUrl: '' },
    });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent'));
    await openDropdown(container);
    const searchInput = await screen.findByPlaceholderText('Search or enter branch name...');
    await fireEvent.input(searchInput, { target: { value: 'feat' } });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent', 'feat'));
    await waitFor(() => expect(screen.getByText('feat/beyond-page')).toBeTruthy());
  });

  it('selecting a branch mid-search clears the debounced filter for the next dropdown open', async () => {
    mockGithubBranches.mockImplementation(async (_owner, _repo, prefix?: string) =>
      prefix
        ? { branches: ['feat/beyond-page'], defaultBranch: undefined }
        : { branches: ['main', 'dev'], defaultBranch: 'dev' },
    );
    const { container } = render(BranchSelector, { props: githubProps });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent'));
    await openDropdown(container);
    const searchInput = await screen.findByPlaceholderText('Search or enter branch name...');
    await fireEvent.input(searchInput, { target: { value: 'feat' } });
    const match = await screen.findByText('feat/beyond-page');

    // Selecting the searched branch must reset the WHOLE search (searchValue
    // AND its debounced mirror + server results), not just the visible input.
    // 'main' rendering proves the debounced 'feat' filter is gone; a single
    // 'feat/beyond-page' occurrence is the trigger's selected-branch label —
    // the search-result list entry must be dropped.
    await fireEvent.click(match);
    await openDropdown(container);
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy());
    expect(screen.getAllByText('feat/beyond-page')).toHaveLength(1);
  });

  it('a new prefix drops the previous prefix results while its request is in flight', async () => {
    // 'release-x' locally contains 'e', so if the stale 'feat' results
    // lingered they would stay selectable under the new prefix.
    const slow = deferred<{ branches: string[]; defaultBranch?: string }>();
    mockGithubBranches.mockImplementation((_owner, _repo, prefix?: string) => {
      if (prefix === 'feat')
        return Promise.resolve({ branches: ['feat-e-beyond'], defaultBranch: undefined });
      if (prefix === 'e') return slow.promise;
      return Promise.resolve({ branches: ['main', 'dev'], defaultBranch: 'dev' });
    });
    const { container } = render(BranchSelector, { props: githubProps });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent'));
    await openDropdown(container);
    const searchInput = await screen.findByPlaceholderText('Search or enter branch name...');
    await fireEvent.input(searchInput, { target: { value: 'feat' } });
    await waitFor(() => expect(screen.getByText('feat-e-beyond')).toBeTruthy());

    // New prefix: the old beyond-page result must disappear immediately even
    // though it locally matches 'e' — only the loaded first page may match
    // until the new request settles.
    await fireEvent.input(searchInput, { target: { value: 'e' } });
    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent', 'e'));
    await waitFor(() => expect(screen.queryByText('feat-e-beyond')).toBeNull());

    slow.resolve({ branches: ['epic/beyond-page'], defaultBranch: undefined });
    await waitFor(() => expect(screen.getByText('epic/beyond-page')).toBeTruthy());
  });

  it('an out-of-order older response never overwrites the newer prefix results', async () => {
    // The requestId !== githubSearchRequestId guard: arm two deferred
    // requests for successive prefixes and resolve them in REVERSE order —
    // the late first response must be discarded, not rendered.
    const first = deferred<{ branches: string[]; defaultBranch?: string }>();
    const second = deferred<{ branches: string[]; defaultBranch?: string }>();
    mockGithubBranches.mockImplementation((_owner, _repo, prefix?: string) => {
      if (prefix === 'rel') return first.promise;
      if (prefix === 'release') return second.promise;
      return Promise.resolve({ branches: ['main', 'dev'], defaultBranch: 'dev' });
    });
    const { container } = render(BranchSelector, { props: githubProps });

    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent'));
    await openDropdown(container);
    const searchInput = await screen.findByPlaceholderText('Search or enter branch name...');
    await fireEvent.input(searchInput, { target: { value: 'rel' } });
    await waitFor(() => expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent', 'rel'));
    await fireEvent.input(searchInput, { target: { value: 'release' } });
    await waitFor(() =>
      expect(mockGithubBranches).toHaveBeenCalledWith('octo', 'intent', 'release'),
    );

    // Newer request settles first…
    second.resolve({ branches: ['release/beyond-page'], defaultBranch: undefined });
    await waitFor(() => expect(screen.getByText('release/beyond-page')).toBeTruthy());

    // …then the stale 'rel' response lands late. Its branch locally contains
    // 'release', so if the guard failed it WOULD render alongside/instead.
    first.resolve({ branches: ['rel-stale-release-hit'], defaultBranch: undefined });
    await waitFor(() => expect(screen.getByText('release/beyond-page')).toBeTruthy());
    expect(screen.queryByText('rel-stale-release-hit')).toBeNull();
  });

  it('local repo: typing in the search never issues a GitHub prefix request', async () => {
    // Empty branch list keeps the local-only "remote branches" section (whose
    // svelte-fa numeric size crashes under jsdom) out of the render tree; the
    // search input renders regardless.
    mockGetBranches.mockResolvedValue({
      branches: [],
      remoteBranches: [],
      defaultBranch: '',
      currentBranch: '',
    });
    const { container } = render(BranchSelector, {
      props: { repoPath: '/tmp/repo', repoType: 'local' as const },
    });

    await waitFor(() => expect(mockGetBranches).toHaveBeenCalled());
    await openDropdown(container);
    const searchInput = await screen.findByPlaceholderText('Search or enter branch name...');
    await fireEvent.input(searchInput, { target: { value: 'feat' } });

    // Let the 100ms search debounce (and the effect behind it) settle.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(mockGithubBranches).not.toHaveBeenCalled();
  });
});

describe('BranchSelector (uncommitted-changes indicator gated on skipIsolation, intent-hq/intent#3945)', () => {
  beforeEach(() => {
    mockGetBranches.mockReset();
    mockBranchStatus.mockReset();
    mockGithubBranches.mockReset();
    mockGithubBranchesCached.mockReset();
    for (const key of Object.keys(debugFlags)) delete debugFlags[key];
    for (const key of Object.keys(savedBranchByRepo)) delete savedBranchByRepo[key];
    mockGithubBranchesCached.mockResolvedValue({ cached: false, branches: [] });
    // Local repo where the auto-selected default IS the current branch, so the
    // uncommitted-changes flag reported by the daemon applies to the selection.
    mockGetBranches.mockResolvedValue({
      branches: ['main'],
      remoteBranches: [],
      defaultBranch: 'main',
      currentBranch: 'main',
    });
  });

  const localProps = {
    repoPath: '/tmp/repo',
    repoType: 'local' as const,
    showUncommittedIndicator: true,
  };

  /** The amber status dot (trigger + dropdown notice share the same marker). */
  function uncommittedDot(root: ParentNode) {
    return root.querySelector('.bg-amber-500');
  }

  it('shows the indicator and dropdown notice with uncommitted changes on the current branch', async () => {
    mockBranchStatus.mockResolvedValue({ behind: 0, hasUncommittedChanges: true });
    const { container } = render(BranchSelector, {
      props: { ...localProps, skipIsolation: false },
    });

    await waitFor(() => expect(mockBranchStatus).toHaveBeenCalledWith('/tmp/repo', 'main'));
    // Trigger dot appears once the status settles (isolated checkout planned →
    // uncommitted working-directory changes really are left behind).
    await waitFor(() => expect(uncommittedDot(container)).toBeTruthy());

    await openDropdown(container);
    await waitFor(() =>
      expect(screen.getByText("Uncommitted changes won't be included.")).toBeTruthy(),
    );
  });

  it('hides the indicator and dropdown notice when skipIsolation is on', async () => {
    // Identical daemon-reported status — only skipIsolation differs. Working
    // directly on the current branch DOES include uncommitted changes, so the
    // warning would be misleading.
    mockBranchStatus.mockResolvedValue({ behind: 0, hasUncommittedChanges: true });
    const { container } = render(BranchSelector, {
      props: { ...localProps, skipIsolation: true },
    });

    await waitFor(() => expect(mockBranchStatus).toHaveBeenCalledWith('/tmp/repo', 'main'));
    // Let the settled status render before asserting absence.
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy());
    expect(uncommittedDot(container)).toBeNull();

    await openDropdown(container);
    expect(screen.queryByText("Uncommitted changes won't be included.")).toBeNull();
  });

  it('keeps the behind-branch notice visible when skipIsolation hides the uncommitted one', async () => {
    mockBranchStatus.mockResolvedValue({ behind: 2, hasUncommittedChanges: true });
    const { container } = render(BranchSelector, {
      props: { ...localProps, skipIsolation: true },
    });

    await waitFor(() => expect(mockBranchStatus).toHaveBeenCalledWith('/tmp/repo', 'main'));
    await openDropdown(container);
    await waitFor(() =>
      expect(screen.getByText("We'll pull the latest changes into your workspace.")).toBeTruthy(),
    );
    expect(screen.queryByText("Uncommitted changes won't be included.")).toBeNull();
  });
});

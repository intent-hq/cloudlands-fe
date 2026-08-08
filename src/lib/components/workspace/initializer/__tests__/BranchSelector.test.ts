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

const { mockGetBranches, mockGithubBranches, mockGithubBranchesCached } = vi.hoisted(() => ({
  mockGetBranches: vi.fn(),
  mockGithubBranches: vi.fn(),
  mockGithubBranchesCached: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    git: { getBranches: mockGetBranches, branchStatus: vi.fn(async () => null) },
    integrations: {
      githubBranches: mockGithubBranches,
      githubBranchesCached: mockGithubBranchesCached,
    },
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {} });
});

vi.mock(
  '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors',
  async () => {
    const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
    const store = createAppStoreMock({ state: {} });
    return {
      selectWorkspaceInitializerBranchByRepo: store.createSelector(() => ({})),
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

// Disable debug toggles (branch caching, form persistence, simulated delays).
vi.mock('$lib/config/debug', () => ({ debugConfig: { get: () => false } }));
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

    await waitFor(() =>
      expect(mockGithubBranchesCached).toHaveBeenCalledWith('octo', 'intent'),
    );
    // Cached hit paints instantly: default branch selected, loading skeleton gone —
    // all while the authoritative GitHub API request is still in flight.
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'dev' });
    expect(container.querySelector('.animate-pulse')).toBeNull();

    // Fresh list arrives with an extra branch: the list reconciles and the
    // still-existing selection is kept (no second onchange).
    fresh.resolve({ branches: ['dev', 'feat/x', 'extra'], defaultBranch: 'dev' });
    await openDropdown(container);
    await waitFor(() => expect(screen.getByText('extra')).toBeTruthy());
    expect(onchange).toHaveBeenCalledTimes(1);
  });

  it('cold cache: keeps the loading skeleton until the GitHub API responds (behavior unchanged)', async () => {
    mockGithubBranchesCached.mockResolvedValue({ cached: false, branches: [] });
    const fresh = deferred<{ branches: string[]; defaultBranch?: string }>();
    mockGithubBranches.mockReturnValue(fresh.promise);
    const onchange = vi.fn();
    const { container } = render(BranchSelector, { props: { ...githubProps, onchange } });

    await waitFor(() =>
      expect(mockGithubBranchesCached).toHaveBeenCalledWith('octo', 'intent'),
    );
    // Cold cache: still loading, nothing selected.
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeTruthy());
    expect(onchange).not.toHaveBeenCalled();

    fresh.resolve({ branches: ['dev', 'feat/x'], defaultBranch: 'dev' });
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(onchange.mock.calls[0][0].detail).toEqual({ branch: 'dev' });
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
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
});

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

const { mockGetBranches, mockGithubBranches } = vi.hoisted(() => ({
  mockGetBranches: vi.fn(),
  mockGithubBranches: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    git: { getBranches: mockGetBranches, branchStatus: vi.fn(async () => null) },
    integrations: { githubBranches: mockGithubBranches },
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

describe('BranchSelector (daemon-backed branch listing, no fabricated fallbacks)', () => {
  beforeEach(() => {
    mockGetBranches.mockReset();
    mockGithubBranches.mockReset();
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

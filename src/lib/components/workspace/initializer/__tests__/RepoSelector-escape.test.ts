/**
 * RepoSelector.svelte Escape handling via the escape-layer stack.
 * The dropdown pushes an escape layer while open, so Escape dismisses it
 * (and only it, when stacked under other overlays — see the NewSpaceModal
 * regression test in modals/__tests__).
 * Also covers the Recent list rendering (owner-qualified repo names) and
 * plain-text search filtering from the "Pick a repo" tab (intent-hq/monorepo#859).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

const mockRepos = vi.hoisted(() => ({
  recentRepos: [] as Array<{
    path: string;
    type: 'local' | 'github';
    githubUrl?: string;
    name: string;
    owner?: string;
  }>,
  workspaces: [] as Array<{
    repositoryPath?: string;
    repositoryName?: string;
    worktreePath?: string;
  }>,
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
      selectWorkspaceInitializerDefaultParentPath: store.createSelector(() => ''),
      selectWorkspaceInitializerRecentRepos: store.createSelector(() => mockRepos.recentRepos),
      selectWorkspaceInitializerRemoteSetups: store.createSelector(() => []),
    };
  },
);

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-slice', () => ({
  setWorkspaceInitializerDefaultParentPath: (path: string) => ({
    type: 'workspaceInitializer/setDefaultParentPath',
    payload: path,
  }),
  setWorkspaceInitializerLastSelectedRepo: (repo: unknown) => ({
    type: 'workspaceInitializer/setLastSelectedRepo',
    payload: repo,
  }),
  setWorkspaceInitializerRecentRepos: (repos: unknown) => ({
    type: 'workspaceInitializer/setRecentRepos',
    payload: repos,
  }),
  setWorkspaceInitializerRemoteSetups: (setups: unknown) => ({
    type: 'workspaceInitializer/setRemoteSetups',
    payload: setups,
  }),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  replaceWorkspaceList: (workspaces: unknown) => ({
    type: 'workspace/replaceWorkspaceList',
    payload: workspaces,
  }),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { list: vi.fn(async () => ({ ok: true, data: mockRepos.workspaces })) },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectWorkspaceItems: store.createSelector(() => []),
  };
});

vi.mock('$store/renderer/slices/feature-codes/feature-codes-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return { selectIsFeatureEnabled: store.createSelector(() => false) };
});

// GitHub autocomplete sources on the "Pick a repo" tab — signed out here, so
// no suggestions render and the Recent list assertions below stay isolated.
vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: () => ({ type: 'githubAuth/initialize' }),
  startGitHubAuth: () => ({ type: 'githubAuth/start' }),
  cancelGitHubAuth: () => ({ type: 'githubAuth/cancel' }),
  clearGitHubAuthError: () => ({ type: 'githubAuth/clearError' }),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectGitHubAuthIsAuthenticated: store.createSelector(() => false),
    selectGitHubAuthIsAuthenticating: store.createSelector(() => false),
    selectGitHubAuthDeviceFlow: store.createSelector(() => null),
    selectGitHubAuthError: store.createSelector(() => null),
    selectGitHubAuthRequiresDaemonAuth: store.createSelector(() => false),
  };
});
vi.mock('$store/renderer/slices/github-repos/github-repos-slice', () => ({
  loadGithubRepos: () => ({ type: 'githubRepos/load' }),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectGithubRepos: store.createSelector(() => []),
    selectGithubReposError: store.createSelector(() => null),
    selectGithubReposLoaded: store.createSelector(() => true),
    selectGithubReposLoading: store.createSelector(() => false),
  };
});
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-slice', () => ({
  searchGithubRepos: (query: string) => ({ type: 'githubRepoSearch/search', payload: [query] }),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectGithubRepoSearchLastQuery: store.createSelector(() => ''),
    selectGithubRepoSearchLoading: store.createSelector(() => false),
    selectGithubRepoSearchResults: store.createSelector(() => []),
  };
});

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.mock('$lib/config/debug', () => ({ debugConfig: { get: () => false } }));
vi.mock('$lib/utils/performance', () => ({
  performanceMonitor: { start: vi.fn(), end: vi.fn() },
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

// Stub the heavy nested modals (BE-driven folder picker, remote setup)
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/workspace/initializer/AddRemoteSetupModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import RepoSelector from '../RepoSelector.svelte';
import { warmImport } from '../../../../../test/warm-import';

const DROPDOWN_HEADING = 'What repo should we work on?';

/** Open the dropdown by clicking the select trigger (first button rendered). */
async function openDropdown(container: HTMLElement) {
  const trigger = container.querySelector('button');
  expect(trigger).toBeTruthy();
  await fireEvent.click(trigger!);
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));

describe('RepoSelector Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape dismisses the open dropdown', async () => {
    const { container } = render(RepoSelector, { props: {} });
    await openDropdown(container);
    await waitFor(() => {
      expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText(DROPDOWN_HEADING)).toBeFalsy();
    });
  });

  it('Escape is not consumed while the dropdown is closed (no layer registered)', async () => {
    render(RepoSelector, { props: {} });
    expect(screen.queryByText(DROPDOWN_HEADING)).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe('RepoSelector trigger suffix rendering', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a dimmed (owner/repo) suffix after the repo name when triggerSuffix is set', () => {
    const { container } = render(RepoSelector, {
      props: { value: '/Users/dev/app', triggerSuffix: 'acme/app' },
    });

    const suffix = screen.getByText('(acme/app)');
    expect(suffix).toBeTruthy();
    expect(suffix.className).toContain('text-subtle');
    const trigger = container.querySelector('button');
    expect(trigger!.textContent?.replace(/\s+/g, ' ').trim()).toBe('app (acme/app)');
  });

  it('renders no suffix (and no empty parens) when triggerSuffix is not set', () => {
    const { container } = render(RepoSelector, {
      props: { value: '/Users/dev/app' },
    });

    const trigger = container.querySelector('button');
    expect(trigger!.textContent?.replace(/\s+/g, ' ').trim()).toBe('app');
  });
});

describe('RepoSelector Recent list owner rendering', () => {
  afterEach(() => {
    mockRepos.recentRepos = [];
    cleanup();
  });

  it('leads with the folder name and dims (owner/repo) for local repos', async () => {
    mockRepos.recentRepos = [
      { path: '/Users/dev/app', type: 'local', name: 'app', owner: 'acme' },
      // Second clone of the same GitHub repo at a different path
      { path: '/Users/dev/app-2', type: 'local', name: 'app', owner: 'acme' },
      { path: '/Users/dev/solo', type: 'local', name: 'solo' },
    ];
    const { container } = render(RepoSelector, { props: {} });
    await openDropdown(container);
    await waitFor(() => {
      expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
    });

    // Local repos live under the "Copy local repo" tab (no longer the default)
    await fireEvent.click(screen.getByText('Copy local repo'));

    await waitFor(() => {
      expect(screen.getAllByText('(acme/app)').length).toBe(2);
    });

    const rowTexts = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.replace(/\s+/g, ' ').trim());

    // The two clones are visually distinct via their folder names.
    expect(rowTexts).toContain('app (acme/app)');
    expect(rowTexts).toContain('app-2 (acme/app)');

    // The ownerless row must render the folder name only — no stray suffix.
    expect(rowTexts).toContain('solo');

    // Local entries no longer use the GitHub "owner /" prefix.
    expect(screen.queryByText('acme /')).toBeNull();
  });
});

describe('RepoSelector Recent list daemon-owned exclusions', () => {
  afterEach(() => {
    mockRepos.recentRepos = [];
    mockRepos.workspaces = [];
    cleanup();
  });

  it('excludes persisted recents whose path is a workspace-owned standalone checkout', async () => {
    // A GitHub-pick workspace: the checkout is its own worktree, so its path
    // is not a copyable local repo even when a stale persisted recent has it.
    mockRepos.workspaces = [
      {
        repositoryPath: '/ws/standalone',
        worktreePath: '/ws/standalone',
        repositoryName: 'standalone',
      },
    ];
    mockRepos.recentRepos = [
      { path: '/ws/standalone', type: 'local', name: 'standalone' },
      { path: '/Users/dev/app', type: 'local', name: 'app' },
    ];
    const { container } = render(RepoSelector, { props: {} });
    await openDropdown(container);
    await waitFor(() => {
      expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
    });

    await fireEvent.click(screen.getByText('Copy local repo'));

    await waitFor(() => {
      expect(screen.getByText('app')).toBeTruthy();
    });
    expect(screen.queryByText('standalone')).toBeNull();
  });
});

describe('RepoSelector Recent list search filtering ("Pick a repo" tab)', () => {
  afterEach(() => {
    mockRepos.recentRepos = [];
    cleanup();
  });

  async function openGitHubTab() {
    mockRepos.recentRepos = [
      {
        path: 'intent-hq/monorepo',
        type: 'github',
        githubUrl: 'https://github.com/intent-hq/monorepo',
        name: 'monorepo',
        owner: 'intent-hq',
      },
      {
        path: 'facebook/react',
        type: 'github',
        githubUrl: 'https://github.com/facebook/react',
        name: 'react',
        owner: 'facebook',
      },
    ];
    const { container } = render(RepoSelector, { props: {} });
    await openDropdown(container);
    await waitFor(() => {
      expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy();
    });

    // "Pick a repo" is the first and default tab — GitHub repos show right away
    await waitFor(() => {
      expect(screen.getByText('monorepo')).toBeTruthy();
      expect(screen.getByText('react')).toBeTruthy();
    });

    return screen.getByPlaceholderText('owner/repo');
  }

  it('filters the Recent list by owner when plain text is typed', async () => {
    const input = await openGitHubTab();

    await fireEvent.input(input, { target: { value: 'intent-hq' } });

    await waitFor(() => {
      expect(screen.queryByText('react')).toBeFalsy();
      expect(screen.getByText('monorepo')).toBeTruthy();
    });
  });

  it('filters the Recent list by repo name when plain text is typed', async () => {
    const input = await openGitHubTab();

    await fireEvent.input(input, { target: { value: 'react' } });

    await waitFor(() => {
      expect(screen.queryByText('monorepo')).toBeFalsy();
      expect(screen.getByText('react')).toBeTruthy();
    });
  });

  it('filters the Recent list by owner/repo when a slash-form string is typed', async () => {
    const input = await openGitHubTab();

    await fireEvent.input(input, { target: { value: 'intent-hq/mono' } });

    await waitFor(() => {
      expect(screen.queryByText('react')).toBeFalsy();
      expect(screen.getByText('monorepo')).toBeTruthy();
    });
  });
});

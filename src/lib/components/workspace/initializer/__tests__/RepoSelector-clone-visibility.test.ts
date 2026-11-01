/**
 * @vitest-environment jsdom
 *
 * The "Clone" source tab is hidden once forge status is known and neither
 * GitHub nor GitLab is connected; pending or failed status keeps it. A hidden
 * Clone never stays the open tab: the picker falls back to "Existing folder".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { waitForLayerExit } from '../../../../../test/layer-exit';

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
      repositoryIdentity?: import('$shared/types/repository-context').RepositoryTarget | null;
    }>,
  };
  return {
    authenticated: false,
    cloneVisible: true,
    hostMember: false,
    labsGitLab: false,
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

vi.mock('$store/renderer/slices/workspace-initializer/clone-source-selectors', () => ({
  selectCloneSourceVisible: mocks.selector(() => mocks.cloneVisible),
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', async (orig) => ({
  ...(await orig<object>()),
  selectLabsGitLabEnabled: mocks.selector(() => mocks.labsGitLab),
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
import type { GitLabProjectPickerProps } from '../gitlab-picker-types';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';

beforeEach(() => {
  mocks.appState = withLegacyPrincipal({});
  mocks.authenticated = false;
  mocks.cloneVisible = true;
  mocks.hostMember = false;
  mocks.labsGitLab = false;
  mocks.navigateToSettings.mockClear();
});
import { warmImport } from '../../../../../test/warm-import';

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

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent?.trim());

describe('RepoSelector source tab labels', () => {
  afterEach(() => cleanup());

  it('labels the tabs Clone, Existing folder and New', async () => {
    await openDropdown();
    expect(tabNames()).toEqual(['Clone', 'Existing folder', 'New']);
  });

  it('keeps the New label in plain-folder mode', async () => {
    await openDropdown({ plainFolderMode: true });
    expect(tabNames()).toEqual(['Clone', 'Existing folder', 'New']);
  });
});

describe('RepoSelector Clone visibility', () => {
  afterEach(() => cleanup());

  it('shows Clone while forge status is pending or failed (selector visible)', async () => {
    mocks.cloneVisible = true;
    await openDropdown();
    expect(screen.getByRole('tab', { name: 'Clone' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /to clone a repository/ })).toBeNull();
  });

  it('hides Clone with no forge connected and opens on Existing folder', async () => {
    mocks.cloneVisible = false;
    await openDropdown();
    expect(tabNames()).toEqual(['Existing folder', 'New']);
    expect(tabButton('Existing folder').className).toContain(ACTIVE_TAB_CLASS);
    expect(screen.queryByPlaceholderText('owner/repo')).toBeNull();
  });

  it('shows Clone when GitHub is connected even if the store says otherwise', async () => {
    mocks.cloneVisible = false;
    mocks.authenticated = true;
    await openDropdown();
    expect(tabButton('Clone').className).toContain(ACTIVE_TAB_CLASS);
  });

  it('shows Clone when the checkout owner supplies an authenticated GitLab', async () => {
    mocks.cloneVisible = false;
    await openDropdown({
      gitlab: {
        authenticated: true,
        instanceBaseUrl: 'https://gitlab.example.test',
        query: '',
        page: { status: 'ready', items: [], hasMore: false },
        copy: {},
        onSearch: vi.fn(),
        onMore: vi.fn(),
        onSelect: vi.fn(),
      },
    });
    expect(screen.getByRole('tab', { name: 'Clone' })).toBeTruthy();
  });

  it('keeps Clone for a host member, whose GitHub access is host-side', async () => {
    mocks.cloneVisible = false;
    mocks.hostMember = true;
    await openDropdown();
    expect(screen.getByRole('tab', { name: 'Clone' })).toBeTruthy();
  });

  it('falls back to Existing folder for a remembered GitHub pick', async () => {
    mocks.cloneVisible = false;
    await openDropdown({ value: 'https://github.com/octo/alpha' });
    expect(tabNames()).toEqual(['Existing folder', 'New']);
    expect(tabButton('Existing folder').className).toContain(ACTIVE_TAB_CLASS);
    expect(screen.queryByPlaceholderText('owner/repo')).toBeNull();
  });

  it('leaves the user on Existing folder when Clone disappears while open', async () => {
    mocks.cloneVisible = true;
    await openDropdown();
    expect(tabButton('Clone').className).toContain(ACTIVE_TAB_CLASS);
    mocks.cloneVisible = false;
    for (const notify of mocks.listeners) notify();
    await waitFor(() => expect(tabNames()).toEqual(['Existing folder', 'New']));
    expect(tabButton('Existing folder').className).toContain(ACTIVE_TAB_CLASS);
  });

  it('offers a connect link to Settings → Connections when Clone is hidden', async () => {
    mocks.cloneVisible = false;
    await openDropdown();
    const link = screen.getByRole('button', { name: 'Connect GitHub to clone a repository' });
    await fireEvent.click(link);
    expect(mocks.navigateToSettings).toHaveBeenCalledWith({
      tab: 'connections',
      hash: 'integrations',
    });
  });

  it('names GitLab in the connect link when GitLab (Labs) is on', async () => {
    mocks.cloneVisible = false;
    mocks.labsGitLab = true;
    await openDropdown();
    expect(
      screen.getByRole('button', { name: 'Connect GitHub or GitLab to clone a repository' }),
    ).toBeTruthy();
  });
});

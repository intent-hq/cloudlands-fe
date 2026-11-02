/**
 * @vitest-environment jsdom
 *
 * The git choice (Labs plain folders) lives inside the folder picker's
 * "Existing folder" and "New" tabs, never on Clone. It is visible as soon as
 * the tab is open, before a folder is picked, including when a remembered
 * GitHub repo is the current selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('$store/renderer/slices/workspace-initializer/plain-folder-selectors', async (orig) => ({
  ...(await orig<object>()),
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
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { warmImport } from '../../../../../test/warm-import';
import { m } from '$shared/paraglide/messages.js';

beforeEach(() => {
  mocks.appState = withLegacyPrincipal({});
  mocks.authenticated = false;
  mocks.cloneVisible = true;
  mocks.hostMember = false;
  mocks.labsGitLab = false;
});

warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./mocks/MockComponent.svelte'));

const DROPDOWN_HEADING = 'What repo should we work on?';

async function openDropdown(props: Record<string, unknown> = {}) {
  const rendered = render(RepoSelector, { props });
  const trigger = rendered.container.querySelector('button')!;
  await fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy());
  return rendered;
}

async function found(query: () => HTMLElement | null) {
  return waitFor(() => {
    const element = query();
    expect(element).toBeTruthy();
    return element!;
  });
}
const anySwitch = () => screen.queryByRole('switch');
const existingSwitch = () =>
  screen.queryByRole('switch', { name: m.workspace_plainFolder_isolatedCopy_label() });
const newSwitch = () =>
  screen.queryByRole('switch', { name: m.workspace_plainFolder_initializeGit_label() });

function gitChoice(checked: boolean) {
  return { checked, onCheckedChange: vi.fn() };
}

describe('RepoSelector git choice (Labs plain folders)', () => {
  afterEach(() => cleanup());

  it('shows no git choice on the Clone tab', async () => {
    await openDropdown({ gitChoice: gitChoice(true) });
    expect(screen.getByRole('tab', { name: 'Clone', selected: true })).toBeTruthy();
    expect(anySwitch()).toBeNull();
  });

  it('shows the isolated-copy choice on Existing folder before a folder is picked', async () => {
    await openDropdown({ gitChoice: gitChoice(true) });
    await fireEvent.click(screen.getByRole('tab', { name: 'Existing folder' }));
    const sw = await found(existingSwitch);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(m.workspace_plainFolder_isolatedCopy_description())).toBeTruthy();
    expect(screen.getByText(m.workspace_repoSelector_selectAFolder_placeholder())).toBeTruthy();
  });

  it('shows the initialize-git choice on New', async () => {
    await openDropdown({ gitChoice: gitChoice(false) });
    await fireEvent.click(screen.getByRole('tab', { name: 'New' }));
    const sw = await found(newSwitch);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(existingSwitch()).toBeNull();
  });

  it('reports the flipped choice with the tab it was flipped in', async () => {
    const choice = gitChoice(true);
    await openDropdown({ gitChoice: choice });
    await fireEvent.click(screen.getByRole('tab', { name: 'Existing folder' }));
    await fireEvent.click(await found(existingSwitch));
    expect(choice.onCheckedChange).toHaveBeenCalledWith(false, 'local');
    await fireEvent.click(screen.getByRole('tab', { name: 'New' }));
    await fireEvent.click(await found(newSwitch));
    expect(choice.onCheckedChange).toHaveBeenLastCalledWith(true, 'new');
  });

  // Regression: a remembered GitHub repo hid the git choice from the folder tabs.
  it('shows the choice immediately on Existing folder and New with a remembered GitHub repo', async () => {
    await openDropdown({ value: 'https://github.com/octo/alpha', gitChoice: gitChoice(false) });
    expect(anySwitch()).toBeNull();
    await fireEvent.click(screen.getByRole('tab', { name: 'Existing folder' }));
    expect((await found(existingSwitch)).getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(screen.getByRole('tab', { name: 'New' }));
    expect(await found(newSwitch)).toBeTruthy();
  });

  it('keeps the choice off for the folder tabs after the picker is dismissed and reopened', async () => {
    const rendered = await openDropdown({
      value: 'https://github.com/octo/alpha',
      gitChoice: gitChoice(false),
    });
    await fireEvent.click(screen.getByRole('tab', { name: 'Existing folder' }));
    expect((await found(existingSwitch)).getAttribute('aria-checked')).toBe('false');

    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(DROPDOWN_HEADING)).toBeNull());
    await fireEvent.click(rendered.container.querySelector('button')!);
    await waitFor(() => expect(screen.getByText(DROPDOWN_HEADING)).toBeTruthy());

    await fireEvent.click(screen.getByRole('tab', { name: 'Existing folder' }));
    expect((await found(existingSwitch)).getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(screen.getByRole('tab', { name: 'New' }));
    expect((await found(newSwitch)).getAttribute('aria-checked')).toBe('false');
  });

  it('renders no git choice when plain folders are unavailable', async () => {
    await openDropdown();
    await fireEvent.click(screen.getByRole('tab', { name: 'Existing folder' }));
    expect(anySwitch()).toBeNull();
    await fireEvent.click(screen.getByRole('tab', { name: 'New' }));
    expect(anySwitch()).toBeNull();
  });
});

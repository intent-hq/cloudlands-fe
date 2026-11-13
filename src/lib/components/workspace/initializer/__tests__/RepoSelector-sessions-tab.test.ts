/**
 * @vitest-environment jsdom
 *
 * New Workspace → codebase picker → Sessions. The tab shows only on hosts with
 * `sessionImport: 1`. The session list request is not sent until the tab opens
 * (listing starts every adapter). Picking a session picks its codebase: the
 * daemon's `repoRoot`, else a known repository holding its folder (older daemons
 * omit `repoRoot`); a row with neither is disabled with a short reason. The
 * trigger then shows the session, and closing the picker drops the listed rows.
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
    sessionImport: true,
    sessions: [] as import('$features/session-import/importable-session').ImportableSession[],
    sessionStatus: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
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

vi.mock('$store/renderer/slices/importable-sessions/importable-sessions-selectors', () => ({
  selectSessionImportSupported: mocks.selector(() => mocks.sessionImport),
  selectImportableSessions: mocks.selector(() =>
    mocks.sessions.map((session) => ({
      ...session,
      key: `${session.provider}:${session.sessionId}`,
    })),
  ),
  selectImportableSessionsStatus: mocks.selector(() => mocks.sessionStatus),
  selectImportableSessionProviders: mocks.selector(() => [
    { id: 'claude-code', label: 'Claude Code', status: 'ok' },
  ]),
}));
vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', async (orig) => ({
  ...(await orig<object>()),
  selectProviderDisplayName: { select: (_state: unknown, provider: string) => provider },
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

const REQUESTED = 'importableSessions/requested';
const RESET = 'importableSessions/reset';
const knownRepo = { path: '/repos/ember', type: 'local' as const, name: 'ember' };
const withRoot = {
  provider: 'claude-code',
  sessionId: 'with-root',
  title: 'Cloudflare account installation',
  cwd: '/work/ember/apps/web',
  updatedAt: '2026-11-12T10:00:00.000Z',
  gitBranch: 'openid-sign-in',
  repoRoot: '/work/ember',
};
const knownFolder = {
  provider: 'claude-code',
  sessionId: 'known-folder',
  title: 'Fix the worker retry',
  cwd: '/repos/ember/apps/worker',
  updatedAt: '2026-11-11T10:00:00.000Z',
};
const noRepo = {
  provider: 'claude-code',
  sessionId: 'no-repo',
  title: 'Notes without git',
  cwd: '/home/sam/notes',
  updatedAt: '2026-11-10T10:00:00.000Z',
};

const choose = (row: HTMLElement) => fireEvent.pointerUp(row, { pointerType: 'mouse', button: 0 });

const requests = () =>
  mocks.dispatch.mock.calls.filter(([action]) => (action as { type: string }).type === REQUESTED);

function renderPicker(selected: Record<string, unknown> | null = null) {
  const onSelect = vi.fn();
  const view = render(RepoSelector, {
    props: {
      rowLabel: 'Codebase',
      emptyLabel: 'Add repository',
      value: '',
      sessions: { selected: selected as never, onSelect },
    },
  });
  return { ...view, onSelect };
}

async function openSessionsTab(container: HTMLElement) {
  await fireEvent.click(container.querySelector('button')!);
  await fireEvent.click(await screen.findByTestId('repo-form-import-session'));
  return screen.findByTestId('import-session-tab');
}

beforeEach(() => {
  mocks.appState = withLegacyPrincipal({});
  mocks.authenticated = false;
  mocks.cloneVisible = true;
  mocks.hostMember = false;
  mocks.plainFoldersOffered = true;
  mocks.forgeState = 'connected';
  mocks.state.recentRepos = [knownRepo];
  mocks.sessionImport = true;
  mocks.sessions = [withRoot, knownFolder, noRepo];
  mocks.sessionStatus = 'ready';
  mocks.dispatch.mockClear();
});

describe('RepoSelector Sessions tab', () => {
  afterEach(() => cleanup());

  it('does not request the session list until the Sessions tab opens', async () => {
    mocks.sessions = [];
    mocks.sessionStatus = 'idle';
    const { container } = renderPicker();
    expect(requests()).toHaveLength(0);

    await fireEvent.click(container.querySelector('button')!);
    await screen.findByTestId('repo-form-import-session');
    await fireEvent.click(screen.getByTestId('repo-form-add'));
    expect(requests()).toHaveLength(0);
    expect(screen.queryByTestId('import-session-tab')).toBeNull();

    await fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    await screen.findByTestId('import-session-tab');
    await waitFor(() => expect(requests()).toHaveLength(1));
    expect((requests()[0][0] as { payload: unknown[] }).payload[0]).toBe('');
  });

  it('hides the Sessions tab on a host without session import', async () => {
    mocks.sessionImport = false;
    const { container } = renderPicker();
    await fireEvent.click(container.querySelector('button')!);
    await fireEvent.click(await screen.findByTestId('repo-form-add'));
    expect(screen.queryByRole('tab', { name: 'Sessions' })).toBeNull();
    expect(screen.queryByTestId('repo-form-import-session')).toBeNull();
    expect(requests()).toHaveLength(0);
  });

  it('picks the codebase from repoRoot, or a known repository, and disables the rest', async () => {
    const { container, onSelect } = renderPicker();
    const tab = await openSessionsTab(container);
    const rows = within(tab).getAllByRole('option');
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute('aria-disabled')).not.toBe('true');
    expect(rows[1].getAttribute('aria-disabled')).not.toBe('true');
    expect(rows[2].getAttribute('aria-disabled')).toBe('true');
    expect(within(rows[2]).getByTestId('import-session-disabled-reason').textContent).toBe(
      'No git repository found',
    );

    await choose(rows[2]);
    expect(onSelect).not.toHaveBeenCalled();
    await choose(rows[1]);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      sessionId: 'known-folder',
      repoRoot: '/repos/ember',
    });
  });

  it('passes the daemon repoRoot and branch with the pick', async () => {
    const { container, onSelect } = renderPicker();
    const tab = await openSessionsTab(container);
    await choose(within(tab).getAllByRole('option')[0]);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0]).toEqual({
      provider: 'claude-code',
      sessionId: 'with-root',
      title: 'Cloudflare account installation',
      cwd: '/work/ember/apps/web',
      gitBranch: 'openid-sign-in',
      repoRoot: '/work/ember',
    });
  });

  it('reuses kept rows when the tab reopens', async () => {
    mocks.appState = {
      ...withLegacyPrincipal({}),
      importableSessions: { status: 'ready', query: '', provider: '' },
    };
    const { container } = renderPicker();
    await openSessionsTab(container);
    expect(requests()).toHaveLength(0);
  });

  it('shows the picked session as the codebase and drops listed rows on close', async () => {
    const { container, unmount } = renderPicker({
      provider: 'claude-code',
      sessionId: 'with-root',
      title: 'Cloudflare account installation',
      cwd: '/work/ember/apps/web',
      repoRoot: '/work/ember',
    });
    expect(
      container.querySelector('[data-testid="repo-selector-session-value"]')?.textContent?.trim(),
    ).toBe('Cloudflare account installation');
    unmount();
    expect(
      mocks.dispatch.mock.calls.some(([action]) => (action as { type: string }).type === RESET),
    ).toBe(true);
  });
});

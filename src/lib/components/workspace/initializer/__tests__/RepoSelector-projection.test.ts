/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { runSaga, stdChannel, type Task } from 'redux-saga';
const mocks = vi.hoisted(() => ({
  selector: <T>(getter: () => T) =>
    Object.assign(
      () => ({
        subscribe(run: (x: T) => void) {
          run(getter());
          return () => {};
        },
      }),
      { select: () => getter() },
    ),
  registry: vi.fn(),
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.registry, shell: { open: vi.fn() } }));
vi.mock('$lib/client', async () => {
  const { createRecentRepositoriesClientFixture } =
    await import('../../../../../test/fixtures/recent-repositories-client');
  return {
    appClient: {
      ...createRecentRepositoriesClientFixture(),
      workspaces: { recentViews: vi.fn(async () => ({})) },
    },
  };
});
vi.mock('$store/renderer/slices/workspace-share/sagas/workspace-share-saga', () => ({
  refreshIntegrationAuthAfterReconnect: vi.fn(),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(() => false),
  selectGitHubAuthIsAuthenticating: mocks.selector(() => false),
  selectGitHubAuthDeviceFlow: mocks.selector(() => null),
  selectGitHubAuthError: mocks.selector(() => null),
  selectGitHubAuthRequiresDaemonAuth: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repos/github-repos-selectors', () => ({
  selectGithubRepos: mocks.selector(() => []),
  selectGithubReposError: mocks.selector(() => null),
  selectGithubReposLoaded: mocks.selector(() => true),
  selectGithubReposLoading: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/github-repo-search/github-repo-search-selectors', () => ({
  selectGithubRepoSearchLastQuery: mocks.selector(() => ''),
  selectGithubRepoSearchLoading: mocks.selector(() => false),
  selectGithubRepoSearchResults: mocks.selector(() => []),
}));
vi.mock('$store/renderer/slices/feature-codes/feature-codes-selectors', () => ({
  selectIsFeatureEnabled: mocks.selector(() => false),
}));
vi.mock('$lib/config/debug', () => ({ debugConfig: { get: () => false } }));
vi.mock('$lib/utils/performance', () => ({
  performanceMonitor: { start: vi.fn(), end: vi.fn() },
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
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));
vi.mock('$lib/components/workspace/initializer/AddRemoteSetupModal.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));
import RepoSelector from '../RepoSelector.svelte';
import { performanceMonitor } from '$lib/utils/performance';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import {
  principalReceived,
  hostMembershipChanged,
} from '$store/renderer/slices/principal/principal-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  loadWorkspacesRequested,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  selectCanManageWorkspace,
  selectWorkspaceById,
} from '$store/renderer/slices/workspace/workspace-selectors';
import {
  dismissWorkspaceInitializerRecentRepo,
  hydrateWorkspaceInitializer,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { selectWorkspaceInitializerRecentRepos } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import type { Workspace } from '$shared/types';
const saved = {
  path: 'octo/saved',
  type: 'github' as const,
  githubUrl: 'https://github.com/octo/saved',
  owner: 'octo',
  name: 'saved',
};
const row = {
  id: 'ws-1',
  title: 'member',
  status: 'active',
  myRole: 'collaborator',
  canManage: true,
  repositoryPath: '/stale',
  repositoryOwner: 'octo',
  repositoryName: 'stale',
  githubUrl: 'https://github.com/octo/stale',
} as Workspace;
let dispose: () => void, task: Task | undefined;
const list = vi.fn();
function admit(role: 'owner' | 'member' | 'guest', revision = 1) {
  const p = store.state.principal;
  store.dispatch(
    principalReceived(
      {
        context: p.context!,
        invalidation: p.invalidation,
        presentationVersion: p.presentationVersion,
      },
      {
        principal: {
          id: 'principal',
          login: null,
          displayName: null,
          avatarUrl: null,
          isAdministrator: role === 'owner',
          hostRole: role,
          hostMembershipRevision: revision,
        },
        capabilities: {
          hostMembership: true,
          personalPairing: false,
          authenticatedDevices: false,
          collaborationIdentity: false,
        },
      },
    ),
  );
}
function init() {
  dispose = store.init();
  admitLegacyPrincipal();
  store.dispatch(setLabsMultiplayerEnabled(true));
  admit('member');
  store.dispatch(setWorkspaceEntity(row));
  store.dispatch(
    setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
  );
  store.dispatch(hydrateWorkspaceInitializer({ recentRepos: [saved] }));
}
function hold() {
  let resolve!: (x: unknown) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  return (x: unknown) => resolve(x);
}
const recents = () => selectWorkspaceInitializerRecentRepos.select(store.state);
beforeEach(() => {
  vi.clearAllMocks();
  list.mockReset();
  workspaceClient.clearCache();
  init();
  mocks.registry.mockResolvedValue({ success: true, data: [] });
  registerMockIpcHandler(WORKSPACE_CHANNELS.LIST, list);
  list.mockResolvedValue({ success: true, data: [] });
});
afterEach(async () => {
  cleanup();
  task?.cancel();
  if (task) await task.toPromise();
  task = undefined;
  unregisterMockIpcHandler(WORKSPACE_CHANNELS.LIST);
  workspaceClient.clearCache();
  dispose();
});
describe('RepoSelector actual store/client projection ownership', () => {
  it.each([true, false])(
    'cannot replace a completed readmitted guest projection canManage=%s',
    async (canManage) => {
      const resolve = hold();
      render(RepoSelector);
      await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
      store.dispatch(
        hostMembershipChanged({ principalId: 'principal', action: 'updated', revision: 2 }),
      );
      list.mockResolvedValue({
        success: true,
        data: [
          {
            ...row,
            title: 'current guest',
            canManage,
            repositoryPath: '/current',
            repositoryName: 'current',
          },
        ],
      });
      admit('guest', 2);
      await tick();
      const channel = stdChannel();
      const dispatch = (a: Parameters<typeof store.dispatch>[0]) => {
        store.dispatch(a);
        channel.put(a);
      };
      task = runSaga({ channel, dispatch, getState: () => store.state }, lifecycleReadSaga);
      dispatch(loadWorkspacesRequested());
      await waitFor(() =>
        expect(selectWorkspaceById.select(store.state, row.id)?.title).toBe('current guest'),
      );
      const context = store.state.workspace.capabilityContext;
      const recent = recents();
      resolve({ success: true, data: [row] });
      await tick();
      await new Promise((r) => setTimeout(r, 0));
      await tick();
      expect(selectWorkspaceById.select(store.state, row.id)?.title).toBe('current guest');
      expect(selectCanManageWorkspace.select(store.state, row.id)).toBe(canManage);
      expect(store.state.workspace.capabilityContext).toBe(context);
      expect(recents()).toEqual(recent);
      expect(recents()).toContainEqual(saved);
      expect(recents().some((x) => x.path === '/stale')).toBe(false);
    },
  );
  it.each(['dispose', 'store'] as const)(
    'late list cannot publish after %s replacement',
    async (kind) => {
      const resolve = hold();
      const view = render(RepoSelector);
      await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
      if (kind === 'dispose') view.unmount();
      else {
        dispose();
        init();
        store.dispatch(setWorkspaceEntity({ ...row, title: 'replacement' }));
      }
      const previous = store.state.workspace.workspaces;
      const recent = recents();
      resolve({ success: true, data: [{ ...row, title: 'late' }] });
      await tick();
      await new Promise((r) => setTimeout(r, 0));
      await tick();
      expect(store.state.workspace.workspaces).toBe(previous);
      expect(recents()).toEqual(recent);
    },
  );
  it('failed list and registry preserve rows and saved recents', async () => {
    list.mockResolvedValue({ success: false, error: 'offline' });
    mocks.registry.mockRejectedValue(new Error('offline'));
    render(RepoSelector);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await tick();
    expect(selectWorkspaceById.select(store.state, row.id)?.title).toBe('member');
    expect(recents()).toEqual([saved]);
  });
  it.each(['owner', 'member'] as const)(
    'unchanged %s admission publishes and merges saved history',
    async (role) => {
      admit(role);
      store.dispatch(
        setWorkspaceHasLoaded(true, 'local', selectPrincipalActionContext.select(store.state)),
      );
      if (role === 'owner') store.dispatch(setLabsMultiplayerEnabled(false));
      const resolve = hold();
      render(RepoSelector);
      await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
      expect(recents()).toEqual([saved]);
      resolve({ success: true, data: [{ ...row, title: 'fresh' }] });
      await waitFor(() =>
        expect(selectWorkspaceById.select(store.state, row.id)?.title).toBe('fresh'),
      );
      expect(recents()).toContainEqual(saved);
    },
  );
});

describe('RepoSelector partial source settlement through the real store and client', () => {
  const registryRepo = { path: '/registry-repo', name: 'registry-repo' };
  const workspace = {
    ...row,
    repositoryPath: '/workspace-repo',
    repositoryName: 'workspace-repo',
    worktreePath: '/worktrees/ws-1',
    updatedAt: '2026-09-29T00:00:00Z',
  };
  const localSaved = { path: '/saved-repo', type: 'local' as const, name: 'saved-repo' };
  const paths = () => recents().map((repo) => repo.path);
  async function pendingSources() {
    dispose();
    dispose = store.init();
    admitLegacyPrincipal();
    admit('owner');
    workspaceClient.clearCache();
    list.mockResolvedValue({ success: true, data: [workspace] });
    mocks.registry.mockResolvedValue({ success: true, data: [registryRepo] });
    const view = render(RepoSelector);
    await fireEvent.click(view.container.querySelector('button')!);
    await fireEvent.click(screen.getByRole('tab', { name: 'Copy local repo' }));
    await waitFor(() => expect(screen.getByText('registry-repo')).toBeTruthy());
    expect(screen.getByText('workspace-repo')).toBeTruthy();
    expect(store.state.workspaceInitializer.hydrated).toBe(false);
    expect(paths()).toEqual([]);
    return view;
  }
  async function settle() {
    store.dispatch(hydrateWorkspaceInitializer({ recentRepos: [localSaved] }));
    await waitFor(() => expect(performanceMonitor.end).toHaveBeenCalledTimes(2));
    await tick();
  }
  it.each(['registry', 'workspace'] as const)(
    'retains only the failed %s source with hydrated saved history',
    async (failed) => {
      await pendingSources();
      list.mockResolvedValue(
        failed === 'workspace'
          ? { success: false, error: 'workspace offline' }
          : { success: true, data: [] },
      );
      if (failed === 'registry') mocks.registry.mockRejectedValue(new Error('registry offline'));
      else mocks.registry.mockResolvedValue({ success: true, data: [] });
      await settle();
      const retained = failed === 'registry' ? 'registry-repo' : 'workspace-repo';
      const removed = failed === 'registry' ? 'workspace-repo' : 'registry-repo';
      expect(paths()).toEqual(expect.arrayContaining(['/saved-repo', `/${retained}`]));
      expect(paths()).not.toContain(`/${removed}`);
      await waitFor(() => expect(screen.getByText(retained)).toBeTruthy());
      expect(screen.queryByText(removed)).toBeNull();
      expect(screen.getByText('saved-repo')).toBeTruthy();
      if (failed === 'workspace')
        expect(selectWorkspaceById.select(store.state, workspace.id)).toBeUndefined();
    },
  );
  it('keeps both failed source views without publishing over saved history', async () => {
    await pendingSources();
    list.mockResolvedValue({ success: false, error: 'workspace offline' });
    mocks.registry.mockRejectedValue(new Error('registry offline'));
    await settle();
    expect(paths()).toEqual(['/saved-repo']);
    expect(screen.getByText('registry-repo')).toBeTruthy();
    expect(screen.getByText('workspace-repo')).toBeTruthy();
    expect(screen.getByText('saved-repo')).toBeTruthy();
  });
  it('retires missing suggestions only when their own source succeeds', async () => {
    await pendingSources();
    list.mockResolvedValue({ success: true, data: [] });
    mocks.registry.mockResolvedValue({ success: true, data: [] });
    await settle();
    expect(paths()).toEqual(['/saved-repo']);
    expect(screen.queryByText('registry-repo')).toBeNull();
    expect(screen.queryByText('workspace-repo')).toBeNull();
  });
  it.each(['before', 'during', 'after'] as const)(
    'honors dismissal %s hydration when the registry fails',
    async (when) => {
      await pendingSources();
      const dismiss = () =>
        store.dispatch(
          dismissWorkspaceInitializerRecentRepo({ path: registryRepo.path, type: 'local' }),
        );
      if (when === 'before') dismiss();
      const resolve = hold();
      mocks.registry.mockRejectedValue(new Error('registry offline'));
      store.dispatch(hydrateWorkspaceInitializer({ recentRepos: [localSaved] }));
      await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
      if (when === 'during') dismiss();
      resolve({ success: true, data: [] });
      await waitFor(() => expect(performanceMonitor.end).toHaveBeenCalledTimes(2));
      if (when === 'after') dismiss();
      await waitFor(() => expect(screen.queryByText('registry-repo')).toBeNull());
      expect(paths()).toEqual(['/saved-repo']);
    },
  );
  it('applies current workspace-owned exclusions to failed registry suggestions', async () => {
    await pendingSources();
    list.mockResolvedValue({
      success: true,
      data: [{ ...workspace, repositoryPath: registryRepo.path, worktreePath: registryRepo.path }],
    });
    mocks.registry.mockRejectedValue(new Error('registry offline'));
    await settle();
    expect(paths()).not.toContain(registryRepo.path);
    expect(paths()).toContain('/saved-repo');
    expect(paths()).toContain('octo/workspace-repo');
  });
  it.each(['readmission', 'revocation', 'store'] as const)(
    'cannot publish fallback suggestions after held %s replacement',
    async (change) => {
      await pendingSources();
      const resolve = hold();
      mocks.registry.mockRejectedValue(new Error('registry offline'));
      store.dispatch(hydrateWorkspaceInitializer({ recentRepos: [localSaved] }));
      await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
      if (change === 'store') {
        dispose();
        init();
      } else {
        store.dispatch(
          hostMembershipChanged({
            principalId: 'principal',
            action: change === 'revocation' ? 'removed' : 'updated',
            revision: 2,
          }),
        );
        if (change === 'readmission') {
          list.mockResolvedValue({ success: true, data: [] });
          mocks.registry.mockResolvedValue({ success: true, data: [] });
          admit('guest', 2);
        }
      }
      await tick();
      const previous = recents();
      resolve({ success: true, data: [] });
      await waitFor(() =>
        expect(vi.mocked(performanceMonitor.end).mock.calls.length).toBeGreaterThanOrEqual(2),
      );
      await tick();
      expect(recents()).toEqual(previous);
      expect(paths()).not.toContain(registryRepo.path);
      if (change !== 'store')
        await waitFor(() => expect(screen.queryByText('registry-repo')).toBeNull());
      // A disposed store does not notify its old mounted subscribers. The live
      // replacement must remain untouched; this is not an old-DOM teardown oracle.
    },
  );
  it('retains known workspace-owned exclusions when only the workspace read fails', async () => {
    dispose();
    dispose = store.init();
    admitLegacyPrincipal();
    admit('owner');
    list.mockResolvedValue({
      success: true,
      data: [{ ...workspace, worktreePath: workspace.repositoryPath }],
    });
    mocks.registry.mockResolvedValue({
      success: true,
      data: [
        { path: workspace.repositoryPath, name: 'must-not-copy' },
        { path: '/workspaces/.repo-cache/octo/managed', name: 'daemon-managed' },
      ],
    });
    render(RepoSelector);
    await waitFor(() => expect(performanceMonitor.end).toHaveBeenCalledTimes(1));
    list.mockResolvedValue({ success: false, error: 'workspace offline' });
    await settle();
    expect(paths()).toContain('octo/workspace-repo');
    expect(paths()).toContain('/saved-repo');
    expect(paths()).not.toContain(workspace.repositoryPath);
    expect(paths()).not.toContain('/workspaces/.repo-cache/octo/managed');
  });
  it('uses current successful source metadata with deterministic deduplication', async () => {
    await pendingSources();
    list.mockResolvedValue({ success: true, data: [{ ...workspace, repositoryName: 'renamed' }] });
    mocks.registry.mockResolvedValue({
      success: true,
      data: [
        { ...registryRepo, name: 'new-registry-name' },
        { path: workspace.repositoryPath, name: 'registry-duplicate' },
      ],
    });
    await settle();
    expect(paths()).toHaveLength(3);
    expect(recents().find((r) => r.path === registryRepo.path)?.name).toBe('new-registry-name');
    expect(recents().find((r) => r.path === workspace.repositoryPath)?.name).toBe('renamed');
    expect(paths()).toContain('/saved-repo');
  });
});

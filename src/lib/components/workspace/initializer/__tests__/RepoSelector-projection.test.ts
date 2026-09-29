/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
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
vi.mock('$lib/client', () => ({
  appClient: { workspaces: { recentViews: vi.fn(async () => ({})) } },
}));
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
import { hydrateWorkspaceInitializer } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
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

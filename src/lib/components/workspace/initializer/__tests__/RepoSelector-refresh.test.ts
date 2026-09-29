/** @vitest-environment jsdom */
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
    }>,
  };
  return { selector, state, listeners, appState: {} as Record<string, unknown>, dispatch: vi.fn() };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { workspaceInitializerReducer } =
    await import('$store/renderer/slices/workspace-initializer/workspace-initializer-slice');
  const module = createAppStoreMockModule({
    state: () => mocks.appState,
    dedupeEmits: true,
    dispatch: (action) => {
      mocks.dispatch(action);
      mocks.appState = {
        ...mocks.appState,
        workspaceInitializer: workspaceInitializerReducer(
          mocks.appState.workspaceInitializer as never,
          action,
        ),
      };
      module.store.emitState();
    },
  });
  return module;
});

vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: () => ({ type: 'githubAuth/initialize' }),
  startGitHubAuth: () => ({ type: 'githubAuth/start' }),
  cancelGitHubAuth: () => ({ type: 'githubAuth/cancel' }),
  clearGitHubAuthError: () => ({ type: 'githubAuth/clearError' }),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(() => false),
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
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';

import { warmImport } from '../../../../../test/warm-import';
import { invoke } from '$lib/electron-bridge';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';

const DROPDOWN_HEADING = 'What repo should we work on?';
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

import { store } from '$store/renderer/store';
import {
  hydrateWorkspaceInitializer,
  initialState,
  dismissWorkspaceInitializerRecentRepo,
  workspaceInitializerReducer,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { selectWorkspaceInitializerRecentRepos } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
import { tick } from 'svelte';
import { performanceMonitor } from '$lib/utils/performance';
import type { StoreState } from '$store/renderer/types';

const originalDispatch = store.dispatch;
const saved = {
  path: 'octo/saved',
  type: 'github' as const,
  githubUrl: 'https://github.com/octo/saved',
  owner: 'octo',
  name: 'saved',
};
const fresh = {
  path: 'octo/fresh',
  type: 'github' as const,
  githubUrl: 'https://github.com/octo/fresh',
  owner: 'octo',
  name: 'fresh',
};
const recents = () => selectWorkspaceInitializerRecentRepos.select(mocks.appState as StoreState);
const writes = () =>
  mocks.dispatch.mock.calls.filter(
    ([a]) => a.type === 'workspaceInitializer/setRecentRepos' || a.type === 'workspace/replace',
  );
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setState(next: StoreState) {
  mocks.appState = next as unknown as Record<string, unknown>;
  (store as unknown as { emitState(): void }).emitState();
}
function admit(over: Partial<StoreState> = {}) {
  return withLegacyPrincipal({
    workspaceInitializer: workspaceInitializerReducer(
      initialState,
      hydrateWorkspaceInitializer({ recentRepos: [saved] }),
    ),
    ...over,
  });
}
function holdRegistry() {
  const held = deferred<{ success: boolean; data: unknown[] }>();
  vi.mocked(invoke).mockImplementation(async (channel) =>
    channel === WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES
      ? held.promise
      : { success: true, data: [] },
  );
  return held;
}
beforeEach(() => {
  store.dispatch = originalDispatch;
  mocks.dispatch.mockClear();
  vi.mocked(invoke).mockReset();
  vi.mocked(workspaceClient.list).mockReset();
  vi.mocked(performanceMonitor.end).mockClear();
  setState(admit());
  vi.mocked(workspaceClient.list).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(invoke).mockResolvedValue({ success: true, data: [] });
});
afterEach(() => {
  cleanup();
  store.dispatch = originalDispatch;
});

describe('RepoSelector recent hydration and refresh ownership', () => {
  it('preserves saved history while a refresh is held and merges it when current', async () => {
    const held = holdRegistry();
    await openDropdown();
    expect(recents()).toEqual([saved]);
    expect(writes()).toHaveLength(0);
    held.resolve({ success: true, data: [fresh] });
    await waitFor(() => expect(recents()).toEqual([saved, fresh]));
    expect(screen.getByText('saved')).toBeTruthy();
    expect(screen.getByText('fresh')).toBeTruthy();
  });

  it('does not replace saved history when both reads fail', async () => {
    vi.mocked(workspaceClient.list).mockResolvedValue({
      ok: false,
      error: { message: 'offline' },
    } as never);
    vi.mocked(invoke).mockRejectedValue(new Error('registry offline'));
    await openDropdown();
    await tick();
    expect(recents()).toEqual([saved]);
    expect(writes()).toHaveLength(0);
  });

  it('waits for initial owner hydration instead of queuing an empty overwrite', async () => {
    setState(admit({ workspaceInitializer: initialState }));
    await openDropdown();
    expect(writes()).toHaveLength(0);
    store.dispatch(hydrateWorkspaceInitializer({ recentRepos: [saved] }));
    await waitFor(() => expect(recents()).toEqual([saved]));
    await waitFor(() => expect(screen.getByText('saved')).toBeTruthy());
  });

  it.each(['readmission', 'connection', 'host', 'revocation', 'store'] as const)(
    'does not merge, persist or replace state from a held %s lifetime',
    async (change) => {
      const held = holdRegistry();
      const rendered = await openDropdown();
      const before = mocks.appState as unknown as StoreState;
      const next = admit();
      if (change === 'readmission')
        next.principal = { ...next.principal, invalidation: next.principal.invalidation + 1 };
      if (change === 'connection')
        next.daemonHealth = {
          ...next.daemonHealth,
          connectionGeneration: before.daemonHealth.connectionGeneration + 1,
        };
      if (change === 'host')
        next.connections = { ...next.connections, windowBackendId: 'replacement-host' };
      if (change === 'revocation') next.principal = { ...next.principal, status: 'revoked' };
      if (change === 'store') store.dispatch = vi.fn();
      setState(next);
      vi.mocked(invoke).mockImplementation(async () => new Promise(() => {}));
      await tick();
      mocks.dispatch.mockClear();
      if (change === 'store') vi.mocked(store.dispatch).mockClear();
      await fireEvent.keyDown(window, { key: 'Escape' });
      held.resolve({ success: true, data: [fresh] });
      await waitFor(() => expect(performanceMonitor.end).toHaveBeenCalledTimes(1));
      expect(recents()).toEqual([saved]);
      expect(writes()).toHaveLength(0);
      if (change === 'store') expect(store.dispatch).not.toHaveBeenCalled();
      expect(screen.queryByText(DROPDOWN_HEADING)).toBeNull();
      rendered.unmount();
    },
  );

  it('ignores completion after unmount', async () => {
    const held = holdRegistry();
    const rendered = await openDropdown();
    rendered.unmount();
    mocks.dispatch.mockClear();
    held.resolve({ success: true, data: [fresh] });
    await waitFor(() => expect(performanceMonitor.end).toHaveBeenCalledTimes(1));
    expect(recents()).toEqual([saved]);
    expect(writes()).toHaveLength(0);
  });

  it('keeps explicit current dismissal during refresh instead of reviving it', async () => {
    const held = holdRegistry();
    await openDropdown();
    store.dispatch(dismissWorkspaceInitializerRecentRepo(saved));
    held.resolve({ success: true, data: [saved, fresh] });
    await waitFor(() => expect(recents()).toEqual([fresh]));
  });

  it('refreshes member history without owner settings hydration', async () => {
    const next = admit({ workspaceInitializer: initialState });
    next.principal.snapshot = {
      ...next.principal.snapshot!,
      principal: {
        ...next.principal.snapshot!.principal,
        isAdministrator: false,
        hostRole: 'member',
        hostMembershipRevision: 1,
      },
      capabilities: { ...next.principal.snapshot!.capabilities, hostMembership: true },
    };
    setState(next);
    vi.mocked(invoke).mockResolvedValue({ success: true, data: [fresh] });
    await openDropdown();
    await waitFor(() => expect(recents()).toEqual([fresh]));
  });

  it('preserves ordinary owner history with Multiplayer off', async () => {
    const next = admit();
    next.userPreferences.labsMultiplayerEnabled = false;
    setState(next);
    await openDropdown();
    await waitFor(() => expect(recents()).toEqual([saved]));
  });
  it('accepts a current readmission refresh but never its late predecessor', async () => {
    const old = holdRegistry();
    await openDropdown();
    const current = deferred<{ success: boolean; data: unknown[] }>();
    vi.mocked(invoke).mockImplementation(async (channel) =>
      channel === WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES
        ? current.promise
        : { success: true, data: [] },
    );
    const next = admit();
    next.principal = { ...next.principal, invalidation: next.principal.invalidation + 1 };
    setState(next);
    await waitFor(() =>
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([channel]) => channel === WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES),
      ).toHaveLength(2),
    );
    current.resolve({ success: true, data: [fresh] });
    await waitFor(() => expect(recents()).toEqual([saved, fresh]));
    mocks.dispatch.mockClear();
    old.resolve({ success: true, data: [{ ...fresh, path: 'octo/obsolete', name: 'obsolete' }] });
    await waitFor(() => expect(performanceMonitor.end).toHaveBeenCalledTimes(2));
    expect(recents()).toEqual([saved, fresh]);
    expect(writes()).toHaveLength(0);
  });
});

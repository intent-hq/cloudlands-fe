/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
vi.mock('$lib/electron-bridge', async () => ({
  invoke: (await import('$shared/ipc-mock-router')).mockInvoke,
  shell: { open: vi.fn() },
}));
vi.mock('$lib/client', () => ({
  appClient: {
    workspaces: { recentViews: vi.fn(async () => ({})) },
    settings: { get: vi.fn(async () => null), update: vi.fn(async () => []) },
  },
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
import Preview from '../recent-repositories.preview.svelte';
import { store } from '$store/renderer/store';
import { selectWorkspaceInitializerRecentRepos } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';

let dispose: () => void;
beforeEach(() => {
  dispose = store.init();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  dispose();
});

async function open(tab: string) {
  await fireEvent.click(screen.getByRole('button', { name: 'Choose fixture repository' }));
  await fireEvent.click(screen.getByRole('tab', { name: tab }));
}
const rows = () => document.querySelectorAll('[data-recent-repo-row]');
const saved = () => selectWorkspaceInitializerRecentRepos.select(store.state);

describe('recent repositories preview through the actual settings and source lifecycle', () => {
  it.each(['Pick a repo', 'Copy local repo'])(
    'shows initial registry rows in the default %s preview',
    async (tab) => {
      render(Preview);
      await open(tab);
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(store.state.workspaceInitializer.hydrated).toBe(false);
      expect(saved()).toEqual([]);
      const action = rows()[0].querySelector('[data-slot="menu-action-row"]')!;
      await fireEvent.click(action);
      expect(screen.getByTestId('repo-selection').textContent).toContain(
        tab === 'Pick a repo' ? 'fixture-owner/app' : '/fixture/app',
      );
    },
  );

  it('shows sources before settings and preserves dismissal through delayed hydration', async () => {
    render(Preview, { props: { persist: true, delayHydration: true } });
    await open('Copy local repo');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByTestId('hydration-state').textContent).toBe('false');
    expect(saved()).toEqual([]);
    await fireEvent.click(rows()[0].querySelector('[data-remove-recent-repo]')!);
    await waitFor(() => expect(rows()).toHaveLength(2));
    await fireEvent.click(screen.getByRole('button', { name: 'Complete fixture hydration' }));
    await waitFor(() => expect(screen.getByTestId('hydration-state').textContent).toBe('true'));
    await waitFor(() => expect(saved().map((repo) => repo.path)).toContain('/fixture/tools'));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(saved().map((repo) => repo.path)).not.toContain('/fixture/app');
    expect(screen.getByTestId('repo-selection').textContent).toBe('null');
    await fireEvent.click(rows()[0].querySelector('[data-slot="menu-action-row"]')!);
    expect(screen.getByTestId('repo-selection').textContent).toContain('/fixture/tools');
  });

  it.each(['Pick a repo', 'Copy local repo'])(
    'keeps the already working persisted %s dismissal and refresh',
    async (tab) => {
      render(Preview, { props: { persist: true } });
      await open(tab);
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(store.state.workspaceInitializer.hydrated).toBe(true);
      const path = tab === 'Pick a repo' ? 'fixture-owner/app' : '/fixture/app';
      await fireEvent.click(rows()[0].querySelector('[data-remove-recent-repo]')!);
      await waitFor(() => expect(rows()).toHaveLength(2));
      await fireEvent.keyDown(window, { key: 'Escape' });
      await fireEvent.click(screen.getByRole('button', { name: 'Refresh fixture sources' }));
      await open(tab);
      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(saved().map((repo) => repo.path)).not.toContain(path);
    },
  );
});

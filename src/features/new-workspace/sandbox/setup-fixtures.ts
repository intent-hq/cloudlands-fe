import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  mockInvoke,
  registerMockIpcHandler,
  unregisterMockIpcHandler,
} from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import { store as appStore } from '$store/renderer/store';
import { setGitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-slice';
import { hydrateWorkspaceCreationSettings } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-slice';
import type { ScenarioFixtures } from './scenarios';

const ISSUE_CHANNEL = 'git-tracking:search-github-issues';
const PULL_CHANNEL = 'git-tracking:search-pull-requests';

function backendResult(method: string, fixtures: ScenarioFixtures): unknown {
  const branches = fixtures.setup.branches;
  switch (method) {
    case 'git.getBranches':
      return branches;
    case 'git.branchStatus':
      return { ahead: 0, behind: 0, hasUncommittedChanges: false };
    case 'github.branches.listCached':
      return { cached: true, source: 'cache', ...branches };
    case 'github.branches.list':
      return { branches: branches.branches, nextToken: null };
    case 'github.repos.get':
      return { repo: { name: 'intent', defaultBranch: branches.defaultBranch } };
    case 'system.capabilities':
      return { cowSupported: false };
    default:
      throw new Error(`Unregistered setup fixture method: ${method}`);
  }
}

function installBackend(fixtures: ScenarioFixtures): () => void {
  const original = window.electronAPI;
  const fallback = (original ?? {}) as NonNullable<Window['electronAPI']>;
  const sandboxApi = new Proxy(fallback, {
    get(target, property, receiver) {
      if (property === 'versions') return { electron: 'sandbox-fixture' };
      if (property === 'invoke') {
        return async (channel: string, ...args: unknown[]) => {
          if (channel !== IPC_CHANNELS.BACKEND.REQUEST) return mockInvoke(channel, ...args);
          const request = args[0] as { method?: string } | undefined;
          try {
            return { ok: true, result: backendResult(request?.method ?? '', fixtures) };
          } catch (error) {
            return {
              ok: false,
              error: { code: 'SANDBOX_FIXTURE', message: String(error) },
            };
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: sandboxApi });
  return () => {
    if (original)
      Object.defineProperty(window, 'electronAPI', { configurable: true, value: original });
    else delete (window as { electronAPI?: Window['electronAPI'] }).electronAPI;
  };
}

export function installSetupScenarioFixtures(fixtures: ScenarioFixtures): () => void {
  const { setup } = fixtures;
  appStore.dispatch(
    hydrateWorkspaceCreationSettings({
      branchByRepo: setup.branchByRepo,
      recentRepos: setup.recentRepos,
      remoteSetups: [],
    }),
  );
  appStore.dispatch(
    setGitHubAuthState({
      isAuthenticated: setup.github.connected,
      requiresDaemonAuth: false,
      user: setup.github.connected
        ? { login: 'sandbox-user', name: 'Sandbox User', email: null, avatar_url: '' }
        : null,
      needsScopeUpdate: false,
      oauthUrl: null,
    }),
  );
  registerMockIpcHandler(ISSUE_CHANNEL, () => ({
    success: true,
    data: setup.github.issues,
    nextToken: null,
  }));
  registerMockIpcHandler(PULL_CHANNEL, () => ({
    success: true,
    data: setup.github.pulls,
    nextToken: null,
  }));
  registerMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, () => ({
    success: true,
    data: setup.providerAvailability,
  }));
  registerMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS, () => ({
    success: true,
    data: { paths: {}, secondaryPaths: {}, npxPackages: {} },
  }));
  const restoreBackend = installBackend(fixtures);
  return () => {
    restoreBackend();
    for (const channel of [
      ISSUE_CHANNEL,
      PULL_CHANNEL,
      PROVIDERS_CHANNELS.GET_AVAILABILITY,
      PROVIDERS_CHANNELS.GET_PATHS,
    ]) {
      unregisterMockIpcHandler(channel);
    }
  };
}

export function applySetupScenarioDom(root: ParentNode, fixtures: ScenarioFixtures): void {
  const options = root.querySelector<HTMLDetailsElement>('[data-testid="options-section"]');
  if (options) options.open = fixtures.setup.optionsOpen;
}

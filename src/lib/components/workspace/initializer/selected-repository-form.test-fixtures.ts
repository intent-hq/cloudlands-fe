import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { setupRecentRepositoriesPreview } from './recent-repositories.preview-fixtures';
import { hydrateWorkspaceInitializer } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { workspaceInitializerGitSaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initializer-git-saga';
import { repositoryCheckoutSaga } from '$store/renderer/slices/repository-checkout/sagas/repository-checkout-saga';
import { setLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { setGitLabAuthStatus } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import { setGitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-slice';
import type { RepositoryCheckoutSession } from '$shared/types/repository-checkout';

export function setupSelectedRepositoryForm(provider: 'github' | 'gitlab', configAvailable = true) {
  const restore = setupRecentRepositoriesPreview();
  const instanceBaseUrl = 'https://git.example.test/Forge';
  const projectPath = 'fixture-owner/app';
  const originalCapture = appClient.integrations.captureRepositoryCheckout;
  const originalBranches = appClient.integrations.githubBranches;
  const originalConfig = appClient.integrations.githubRepoConfig;
  const originalCached = appClient.integrations.githubBranchesCached;
  const branches = [
    { name: 'trunk', commitSha: 'a'.repeat(40) },
    { name: 'release/next', commitSha: 'b'.repeat(40) },
  ];
  const session: RepositoryCheckoutSession = {
    capture: {
      provider: 'gitlab',
      instanceBaseUrl,
      checkoutId: 'fixture-lease',
      revision: 'fixture-account',
      expiresAfterMs: 600000,
    },
    onRetired: () => () => {},
    projects: async () => ({ status: 'ready', value: { items: [] } }),
    project: async () => ({
      status: 'ready',
      value: {
        project: {
          projectPath,
          namespace: 'fixture-owner',
          name: 'app',
          webUrl: `${instanceBaseUrl}/${projectPath}`,
          cloneUrl: `${instanceBaseUrl}/${projectPath}.git`,
          defaultBranch: 'trunk',
          ownerAvatarUrl: `${instanceBaseUrl}/uploads/namespace.png`,
        },
      },
    }),
    branches: async (query) => ({
      status: 'ready',
      value: {
        items: branches.filter((b) => b.name.includes(query.query ?? '')),
        cached: !!query.cached,
      },
    }),
    warm: async (selection) => ({
      status: 'ready',
      value: {
        projectPath,
        branch: selection.branch,
        commitSha: selection.commitSha,
        cached: true,
      },
    }),
    repoConfig: async (query) =>
      configAvailable
        ? {
            status: 'ready',
            value: {
              projectPath: query.projectPath,
              branch: query.branch,
              commitSha: query.commitSha,
              config: { setupScript: 'echo selected repo config' },
              exists: true,
            },
          }
        : { status: 'unavailable', reason: 'unreachable' },
    release: async () => {},
  };
  appClient.integrations.captureRepositoryCheckout = async () => ({
    status: 'ready',
    value: session,
  });
  appClient.integrations.githubBranches = async () => ({
    branches: branches.map((b) => b.name),
    defaultBranch: 'trunk',
  });
  appClient.integrations.githubRepoConfig = async () => ({
    config: { setupScript: 'echo selected repo config' },
    exists: true,
  });
  appClient.integrations.githubBranchesCached = async () => ({ cached: false, branches: [] });
  appStore.dispatch(setLabsGitLabEnabled(true));
  appStore.dispatch(
    setGitLabAuthStatus({
      host: 'git.example.test',
      instanceBaseUrl,
      isConfigured: true,
      deviceGrantSupported: false,
      user: null,
      method: 'pat',
    }),
  );
  appStore.dispatch(
    setGitHubAuthState({
      isAuthenticated: true,
      requiresDaemonAuth: false,
      user: null,
      needsScopeUpdate: false,
      oauthUrl: null,
    }),
  );
  appStore.dispatch(
    hydrateWorkspaceInitializer({
      compactFormState: {
        repoType: provider,
        repoPath: provider === 'github' ? projectPath : '',
        githubUrl: provider === 'github' ? `https://github.com/${projectPath}` : '',
        branch: provider === 'github' ? 'trunk' : '',
        isValidPath: true,
        isTeamMode: false,
        ...(provider === 'gitlab'
          ? { repositoryCheckoutDraft: { instanceBaseUrl, projectPath, mode: 'cached' as const } }
          : {}),
      },
    }),
  );
  const stopGit = appStore.runSaga(workspaceInitializerGitSaga);
  const stopCheckout = appStore.runSaga(repositoryCheckoutSaga);
  return () => {
    stopCheckout();
    stopGit();
    restore();
    appClient.integrations.captureRepositoryCheckout = originalCapture;
    appClient.integrations.githubBranches = originalBranches;
    appClient.integrations.githubBranchesCached = originalCached;
    appClient.integrations.githubRepoConfig = originalConfig;
  };
}

import { takeEvery } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { setupSelectedRepositoryForm } from './selected-repository-form.test-fixtures';
import { setupPreviewProviders } from '$lib/components/settings/provider-selector.preview';
import {
  setupModelPickerPreviewHandler,
  setupProviderSelectorPreviewHandlers,
} from '../../../../test/catalog-preview-ipc';
import { mockInvoke, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { store } from '$store/renderer/store';
import { setupStartOnPreview, startOnPreviewMachine } from './start-on.preview-fixtures';
import {
  workspaceInitializationSubmitted,
  hydrateWorkspaceInitializer,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerRecentRepos,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import {
  selectCompactWorkspaceInitializerFormState,
  selectWorkspaceInitializerLastSelectedRepo,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';

import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { modelReloadSaga } from '$store/renderer/slices/model/sagas/model-reload-saga';

type WorkspaceFormScenario =
  | 'default'
  | 'long'
  | 'empty'
  | 'config-error'
  | 'orchestration'
  | 'many-repos'
  | 'remote-attachments'
  | 'selection-recovery'
  | 'selection-access-error'
  | 'opening-cold'
  | 'opening-saved'
  | 'opening-stale'
  | 'opening-error'
  | 'opening-empty'
  | 'opening-warm'
  | 'opening-hydration'
  | 'opening-late-prefill';

export function setupWorkspaceFormPreview(
  scenario: WorkspaceFormScenario,
  onOpenExternal?: (url: string) => void,
  onBranchRequest?: (request: { repository: string; status: string }) => void,
  onSubmission?: (submission: { repoPath: string; branch: string; prompt: string }) => void,
) {
  const restores: Array<() => void> = [];
  const opening = scenario.startsWith('opening-');
  restores.push(
    overrideMockIpcHandler('shell:openExternal', (params) => {
      if (
        typeof params !== 'object' ||
        params === null ||
        !('url' in params) ||
        typeof params.url !== 'string'
      ) {
        throw new TypeError('Expected an external URL in the workspace form preview');
      }
      onOpenExternal?.(params.url);
      return { success: true };
    }),
  );
  const previousForm = selectCompactWorkspaceInitializerFormState.select(store.state);
  store.dispatch(setCompactWorkspaceInitializerFormState(null));
  restores.push(() => store.dispatch(setCompactWorkspaceInitializerFormState(previousForm)));
  restores.push(
    setupSelectedRepositoryForm(
      scenario === 'config-error' ? 'gitlab' : 'github',
      scenario !== 'config-error',
      { deferHydration: opening },
    ),
  );
  if (opening || scenario === 'selection-recovery' || scenario === 'selection-access-error') {
    // Observe the form action only. This fixture never starts the creation saga.
    restores.push(
      store.runSaga(function* () {
        yield* takeEvery(workspaceInitializationSubmitted, function* (action) {
          const submission = action.payload.submission;
          if (submission.entrypoint === 'compact') {
            const { repoPath, branch, prompt } = submission;
            onSubmission?.({ repoPath, branch, prompt });
          }
        });
      }),
    );
  }
  if (scenario === 'opening-late-prefill') {
    const originalBranches = appClient.git.getBranches;
    const originalStatus = appClient.git.branchStatus;
    appClient.git.getBranches = async (repository) => {
      onBranchRequest?.({ repository, status: 'loading' });
      const result = {
        branches: ['trunk', 'release/next'],
        remoteBranches: [],
        currentBranch: 'release/next',
        defaultBranch: 'trunk',
      };
      onBranchRequest?.({ repository, status: 'ready' });
      return result;
    };
    appClient.git.branchStatus = async (_repository, branch) => ({
      branch,
      currentBranch: 'release/next',
      isCurrentBranch: branch === 'release/next',
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: false,
    });
    store.dispatch(
      hydrateWorkspaceInitializer({
        compactFormState: {
          repoType: 'local',
          repoPath: '/fixture/prefill',
          githubUrl: '',
          branch: '',
          isValidPath: true,
          selectedSpecialist: 'developer',
          isTeamMode: false,
          selectedProvider: 'codex',
          selectedModel: 'gpt-5.4',
          modelWasOverridden: true,
        },
        branchByRepo: {},
      }),
    );
    restores.push(() => {
      appClient.git.getBranches = originalBranches;
      appClient.git.branchStatus = originalStatus;
    });
  } else if (opening) {
    const previousInitializer = store.state.workspaceInitializer;
    const originalBranches = appClient.integrations.githubBranches;
    const originalCached = appClient.integrations.githubBranchesCached;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const releaseBranches = () => release?.();
    window.addEventListener('workspace-form:release-branches', releaseBranches);
    let requestCount = 0;
    appClient.integrations.githubBranchesCached = async () =>
      scenario === 'opening-warm'
        ? { cached: true, branches: ['cached-default'], defaultBranch: 'cached-default' }
        : { cached: false, branches: [] };
    appClient.integrations.githubBranches = async (owner, repo) => {
      const repository = `${owner}/${repo}`;
      const attempt = ++requestCount;
      onBranchRequest?.({ repository, status: 'loading' });
      await pending;
      if (scenario === 'opening-error' && attempt === 1) {
        onBranchRequest?.({ repository, status: 'error' });
        throw new Error('network unavailable in opening fixture');
      }
      if (scenario === 'opening-empty') {
        onBranchRequest?.({ repository, status: 'empty' });
        return { branches: [], defaultBranch: '' };
      }
      onBranchRequest?.({ repository, status: attempt > 1 ? 'retry-ready' : 'ready' });
      return {
        branches: scenario === 'opening-stale' ? ['trunk'] : ['trunk', 'main'],
        defaultBranch: 'trunk',
      };
    };
    const agentSettings = {
      selectedSpecialist: 'developer',
      isTeamMode: false,
      selectedProvider: 'codex',
      selectedModel: 'gpt-5.4',
      modelWasOverridden: true,
    };
    const remembered = scenario !== 'opening-cold' && scenario !== 'opening-warm';
    // Use the production hydration action, held until after mount in the late case.
    // This isolates the form's hydration consumer, not settings transport or persistence.
    const finishHydration = () =>
      store.dispatch(
        hydrateWorkspaceInitializer({
          compactFormState:
            scenario === 'opening-hydration'
              ? agentSettings
              : {
                  ...agentSettings,
                  repoType: 'github',
                  repoPath: 'intent-hq/intent',
                  githubUrl: 'https://github.com/intent-hq/intent',
                  branch: '',
                  isValidPath: true,
                },
          lastSelectedRepo: {
            type: 'github',
            path: 'intent-hq/intent',
            githubUrl: 'https://github.com/intent-hq/intent',
            isValidPath: true,
          },
          branchByRepo: remembered ? { 'intent-hq/intent': 'main' } : {},
          recentRepos: [],
        }),
      );
    if (scenario === 'opening-hydration') {
      window.addEventListener('workspace-form:release-hydration', finishHydration, { once: true });
    } else {
      finishHydration();
    }
    restores.push(() => {
      window.removeEventListener('workspace-form:release-branches', releaseBranches);
      window.removeEventListener('workspace-form:release-hydration', finishHydration);
      releaseBranches();
      appClient.integrations.githubBranches = originalBranches;
      appClient.integrations.githubBranchesCached = originalCached;
      store.dispatch(
        hydrateWorkspaceInitializer({
          branchByRepo: previousInitializer.branchByRepo,
          lastSelectedRepo: previousInitializer.lastSelectedRepo,
        }),
      );
    });
  }
  if (scenario === 'selection-recovery' || scenario === 'selection-access-error') {
    const originalBranches = appClient.integrations.githubBranches;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const releaseBranches = () => release?.();
    window.addEventListener('workspace-form:release-branches', releaseBranches);
    appClient.integrations.githubBranches = async (owner, repo) => {
      const repository = `${owner}/${repo}`;
      onBranchRequest?.({ repository, status: 'loading' });
      if (scenario === 'selection-access-error') {
        onBranchRequest?.({ repository, status: 'no-access' });
        throw new Error('404 Repository not found');
      }
      if (repository === 'fixture-owner/new-app') {
        await pending;
        onBranchRequest?.({ repository, status: 'ready' });
        return { branches: ['develop', 'feature/new-app'], defaultBranch: 'develop' };
      }
      const result = await originalBranches(owner, repo);
      onBranchRequest?.({ repository, status: 'ready' });
      return result;
    };
    restores.push(() => {
      window.removeEventListener('workspace-form:release-branches', releaseBranches);
      appClient.integrations.githubBranches = originalBranches;
      releaseBranches();
    });
  }
  restores.push(setupPreviewProviders());
  const unavailable = { available: false };
  restores.push(
    setupProviderSelectorPreviewHandlers({
      hasAnyProvider: true,
      hiddenProviders: [],
      providers: {
        codex: { available: true, authenticated: true },
        claudeCode: { available: true, authenticated: true },
        auggie: unavailable,
        cortex: unavailable,
        mock: unavailable,
        opencode: unavailable,
        pi: unavailable,
        droid: unavailable,
        grok: unavailable,
        unsloth: unavailable,
      },
    }),
  );
  restores.push(
    setupModelPickerPreviewHandler('codex', [
      { value: 'gpt-5.4', label: 'GPT-5.4', effortLevels: ['low', 'medium', 'high'] },
      { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    ]),
  );
  restores.push(
    setupModelPickerPreviewHandler('claude-code', [
      { value: 'claude-opus-4-6', label: 'Opus 4.6' },
    ]),
  );
  restores.push(
    overrideMockIpcHandler('system:check-git', () => ({
      success: true,
      data: { available: true, version: '2.50.0' },
    })),
  );
  const bridge = window.electronAPI;
  const previousInvoke = bridge?.invoke;
  if (bridge && previousInvoke) {
    bridge.invoke = (channel, ...args) =>
      channel === 'codex:get-models' || channel === 'claude-code:get-models'
        ? mockInvoke(channel, ...args)
        : previousInvoke.call(bridge, channel, ...args);
    restores.push(() => {
      bridge.invoke = previousInvoke;
    });
  }
  restores.push(store.runSaga(modelReloadSaga));
  if (scenario === 'empty') {
    const previousLastRepo = selectWorkspaceInitializerLastSelectedRepo.select(store.state);
    store.dispatch(setWorkspaceInitializerLastSelectedRepo(null));
    store.dispatch(setWorkspaceInitializerRecentRepos([]));
    restores.push(() => store.dispatch(setWorkspaceInitializerLastSelectedRepo(previousLastRepo)));
    restores.push(
      overrideMockIpcHandler(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, () => ({
        success: true,
        data: [],
      })),
    );
  }
  if (scenario === 'remote-attachments') {
    restores.push(
      setupStartOnPreview([startOnPreviewMachine('d-mac', 'Mac mini', 'connected', ['gpt-5.4'])], {
        remoteBackend: false,
      }),
    );
  }
  if (scenario === 'many-repos') {
    const repositories = Array.from({ length: 12 }, (_, index) => {
      const name = `history-repo-${String(index + 1).padStart(2, '0')}`;
      return {
        path: `fixture-owner/${name}`,
        name,
        owner: 'fixture-owner',
        githubUrl: `https://github.com/fixture-owner/${name}`,
        addedAt: '2026-09-01T00:00:00Z',
        lastUsedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
      };
    });
    restores.push(
      overrideMockIpcHandler(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, () => ({
        success: true,
        data: [...repositories, repositories[5]],
      })),
    );
  }
  if (scenario !== 'config-error' && !opening) {
    const name =
      scenario === 'long'
        ? 'a-deliberately-long-repository-name-for-workspace-navigation'
        : 'intent';
    store.dispatch(
      setCompactWorkspaceInitializerFormState({
        repoType: scenario === 'empty' ? 'local' : 'github',
        repoPath: scenario === 'empty' ? '' : `intent-hq/${name}`,
        githubUrl: scenario === 'empty' ? '' : `https://github.com/intent-hq/${name}`,
        branch:
          scenario === 'empty'
            ? ''
            : scenario === 'long'
              ? 'feature/a-long-branch-name-for-the-new-workspace-form'
              : 'trunk',
        isValidPath: scenario !== 'empty',
        selectedSpecialist: scenario === 'orchestration' ? 'spec-writer' : 'developer',
        isTeamMode: scenario === 'orchestration',
        selectedProvider: 'codex',
        selectedModel: 'gpt-5.4',
        modelWasOverridden: true,
        ...(scenario === 'remote-attachments' ? { startOnMachineId: 'd-mac' } : {}),
      }),
    );
  }

  return () => restores.reverse().forEach((restore) => restore());
}

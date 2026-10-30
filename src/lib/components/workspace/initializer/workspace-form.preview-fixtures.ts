import { setupSelectedRepositoryForm } from './selected-repository-form.test-fixtures';
import { setupPreviewProviders } from '$lib/components/settings/provider-selector.preview';
import {
  setupModelPickerPreviewHandler,
  setupProviderSelectorPreviewHandlers,
} from '../../../../test/catalog-preview-ipc';
import { mockInvoke, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { store } from '$store/renderer/store';
import {
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
  'default' | 'long' | 'empty' | 'config-error' | 'orchestration' | 'many-repos';

export function setupWorkspaceFormPreview(scenario: WorkspaceFormScenario) {
  const restores: Array<() => void> = [];
  const previousForm = selectCompactWorkspaceInitializerFormState.select(store.state);
  store.dispatch(setCompactWorkspaceInitializerFormState(null));
  restores.push(() => store.dispatch(setCompactWorkspaceInitializerFormState(previousForm)));
  restores.push(
    setupSelectedRepositoryForm(
      scenario === 'config-error' ? 'gitlab' : 'github',
      scenario !== 'config-error',
    ),
  );
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
      { value: 'gpt-5.4', label: 'GPT-5.4' },
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
  if (scenario !== 'config-error') {
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
      }),
    );
  }

  return () => restores.reverse().forEach((restore) => restore());
}

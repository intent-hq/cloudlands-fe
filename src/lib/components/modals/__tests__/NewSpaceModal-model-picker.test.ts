import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

const mocks = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe(run: (next: T) => void) {
      run(value);
      return () => {};
    },
  });
  const models = Array.from({ length: 12 }, (_, index) => ({
    value: `gpt5.${index + 1}`,
    label: `GPT 5.${index + 1}`,
    description: index === 11 ? 'Last model' : `Model ${index + 1}`,
    effortLevels: index === 5 ? ['low', 'medium', 'high'] : undefined,
  }));
  return {
    readable,
    models,
    availableProviderIds: ['auggie'],
    codexModels: [{ value: 'codex-model', label: 'Codex model', effortLevels: ['low', 'high'] }],
    formPersistence: false,
    compactFormState: null as
      | import('$store/renderer/slices/workspace-initializer/workspace-initializer-types').CompactWorkspaceInitializerFormState
      | null,
    lastSelectedRepo: null as
      | import('$store/renderer/slices/workspace-initializer/workspace-initializer-types').WorkspaceInitializerRepoSelection
      | null,
    recentRepos:
      [] as import('$store/renderer/slices/workspace-initializer/workspace-initializer-types').WorkspaceInitializerRecentRepo[],
    dispatch: vi.fn(),
    onClose: vi.fn(),
    create: vi.fn(),
    configuredModels: {} as Record<string, string>,
    selectedModel: undefined as string | undefined,
    defaultReasoningEffort: '',
    specialist: {
      id: 'spec-writer',
      name: 'Coordinator',
      description: '',
      source: 'user',
      resolvedModel: 'gpt5.5',
      resolvedProvider: 'auggie',
      model: undefined as string | undefined,
      defaultModel: undefined as string | undefined,
      reasoningEffort: undefined as string | undefined,
      resolvedReasoningEffort: undefined as string | undefined,
    },
  };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock(
  '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors')
    >()),
    selectWorkspaceInitializerGitAvailability: () => ({
      subscribe(run: (value: boolean) => void) {
        run(true);
        return () => {};
      },
    }),
    selectWorkspaceInitializerHydrated: () => mocks.readable(true),
    selectCompactWorkspaceInitializerFormState: () => mocks.readable(mocks.compactFormState),
    selectWorkspaceInitializerDefaultParentPath: () => mocks.readable(''),
    selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(mocks.lastSelectedRepo),
    // A remembered orchestration choice: the modal opens in team mode so the
    // team card's picker is live from the start.
    selectWorkspaceInitializerLastSubmittedAgent: () =>
      mocks.readable({ selectedSpecialist: 'spec-writer', isTeamMode: true }),
    selectWorkspaceInitializerRecentRepos: () => mocks.readable(mocks.recentRepos),
    selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(null),
    selectWorkspaceInitializerDraftAuthority: () =>
      mocks.readable({ restore: undefined, clear: undefined }),
  }),
);

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable('auggie'),
  selectEnabledProviders: () => mocks.readable({}),
  selectModelFetchProviderIds: () => mocks.readable(mocks.availableProviderIds),
  selectIsProviderModelAccessAllowed: () => mocks.readable(true),
  selectAvailableEnabledProviderIds: () => mocks.readable(mocks.availableProviderIds),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => mocks.readable(mocks.selectedModel),
  selectDefaultReasoningEffort: () => mocks.readable(mocks.defaultReasoningEffort),
  selectProviderModels: () => mocks.readable(mocks.configuredModels),
  selectAvailableModels: () => mocks.readable(mocks.models),
  selectAvailableModelsProviderId: () => mocks.readable('auggie'),
  selectModelFallbackInfo: () => mocks.readable(null),
  selectModelPickerCollapsedGroups: () => mocks.readable([]),
  selectIsLoadingModels: () => mocks.readable(false),
  selectLoadError: () => mocks.readable(null),
  selectAllProviderWarnings: () => mocks.readable({}),
  selectAllProviderStaleFlags: () => mocks.readable({}),
  selectModelEffortLevels: {
    select: (_state: unknown, modelId: string | undefined) =>
      mocks.models.find((model) => model.value === modelId)?.effortLevels,
  },
  selectAgentModelEffortLevels: Object.assign(() => mocks.readable(undefined), {
    select: () => undefined,
    withStore: () => () => mocks.readable(undefined),
  }),
}));

vi.mock('$store/renderer/slices/model/model-utils', () => ({
  getModelsForProvider: vi.fn(async () => mocks.models),
  getModelsForProviderForLoadingState: vi.fn(async (providerId: string) => ({
    models: providerId === 'codex' ? mocks.codexModels : mocks.models,
  })),
}));

vi.mock('$store/renderer/slices/agent-availability/agent-availability-selectors', () => ({
  selectHasCheckedOnce: () => mocks.readable(true),
}));
vi.mock('$store/renderer/slices/daemon-health/daemon-health-selectors', () => ({
  selectDaemonHealth: () => mocks.readable('healthy'),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => {
  const selectAgentSession = Object.assign(() => mocks.readable(undefined), {
    select: () => undefined,
    withStore: () => () => mocks.readable(undefined),
  });
  const selectAgentReasoningEffort = Object.assign(() => mocks.readable(undefined), {
    select: () => undefined,
    withStore: () => () => mocks.readable(undefined),
  });
  return { selectAgentSession, selectAgentReasoningEffort };
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(() => mocks.readable([mocks.specialist]), {
    select: () => [mocks.specialist],
  }),
  selectCustomSpecialistsLoaded: () => mocks.readable(true),
  selectFileSpecialistsLoaded: () => mocks.readable(true),
  selectUserOverrides: () => mocks.readable({ modelOverrides: {} }),
  selectEffectiveBehaviorPrompt: { select: () => undefined },
  filterPickableSpecialists: (specialists: unknown[]) => specialists,
  selectOrchestratorSpecialist: Object.assign(
    () =>
      mocks.readable({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
      }),
    {
      select: () => ({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
      }),
    },
  ),
  filterModalPickableSpecialists: (specialists: Array<{ role?: string }>) =>
    specialists.filter((s) => s.role !== 'internal'),
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => mocks.readable(true),
}));
vi.mock('$features/providers/provider-availability.client', () => ({
  getProviderAvailability: vi.fn(async () => ({
    providers: Object.fromEntries(
      mocks.availableProviderIds.map((id) => [id, { available: true }]),
    ),
  })),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    specialists: {
      list: vi.fn(async () => [mocks.specialist]),
    },
    git: { pull: vi.fn(async () => ({ success: true })) },
  },
}));
vi.mock('$features/agent/agent.client', () => ({
  agentClient: { setModel: vi.fn(async () => ({ ok: true, data: { success: true } })) },
}));
vi.mock('$features/agent/browser', () => ({}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

vi.mock('$features/setup-scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/setup-scripts')>()),
  SETUP_SCRIPT_TEMPLATES: [],
  getTemplateContent: vi.fn(() => ''),
  chooseDefaultSetupScript: vi.fn(() => ({ content: '', name: 'Custom', source: 'custom' })),
  createRepoConfigProbeScheduler: vi.fn(() => ({
    onSelectionChange: vi.fn(),
    settled: vi.fn(async () => {}),
    dispose: vi.fn(),
  })),
  resolveSetupScriptParam: vi.fn(() => undefined),
  REPO_CONFIG_SCRIPT_NAME: 'Repo config',
}));
vi.mock('$lib/config/debug', () => ({
  debugConfig: {
    get: vi.fn((key: string) => key === 'enableFormPersistence' && mocks.formPersistence),
  },
}));
vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (prompt: string) => ({ enhanced: prompt })),
  isEnhancePromptAvailable: vi.fn(() => false),
  EnhancePromptUnavailableError: class extends Error {},
}));
vi.mock('$lib/utils/workspace-validation', () => ({
  getGitErrorMessage: (message: string) => message,
  parseGitHubUrl: vi.fn(() => null),
  validateBranchName: vi.fn(() => ({ valid: true })),
  validateInitialPrompt: vi.fn(() => ({ valid: true })),
  validateRepoPath: vi.fn(async () => ({ valid: true })),
}));
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { create: mocks.create, update: vi.fn() },
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async (channel: string) =>
    channel === 'system:check-git'
      ? { success: true, data: { available: true, version: '2.44.0' } }
      : { success: true, data: null },
  ),
}));
vi.mock('$lib/components/workspace/initializer/new-workspace-draft', () => ({
  LEGACY_PROMPT_SESSION_KEY: 'legacy-prompt',
  restoreNewWorkspaceDraft: vi.fn(async () => ({ status: 'empty' })),
  createNewWorkspaceDraftSaver: vi.fn(() => ({ schedule: vi.fn(), flush: vi.fn() })),
  clearNewWorkspaceDraft: vi.fn(),
}));

vi.mock('$lib/components/ui/RichTextarea.svelte', async () => ({
  default: (await import('../../workspace/__tests__/mocks/MockRichTextarea.svelte')).default,
}));
vi.mock('$lib/components/modals/PullConflictDialog.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$lib/components/modals/SetupScriptModal.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$lib/components/workspace/initializer/IssueSuggestions.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
  preloadIssues: vi.fn(),
}));
vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('../../workspace/__tests__/mocks/MockRepoAndBranchPicker.svelte')).default,
}));
vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
}));
vi.mock('$features/agent/components/AgentProviderIcon.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockComponent.svelte'))
    .default,
  hasProviderIcon: () => false,
}));
vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('../../workspace/initializer/__tests__/mocks/MockDropdownMenu.svelte'))
    .default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import { updateHomeWorkspaceView } from '$features/home/home-workspaces-slice';
import { setRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { WorkspaceStatusEnum } from '$shared/types';
import NewSpaceModal from '../NewSpaceModal.svelte';
import CompactWorkspaceInitializer from '../../workspace/CompactWorkspaceInitializer.svelte';
import {
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerLastSelectedRepo,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { store as appStore } from '$store/renderer/store';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
import { loadEnabledProvidersFromStorage } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { modelReloadSaga } from '$store/renderer/slices/model/sagas/model-reload-saga';
import { workspaceInitializationSaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initialization-saga';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';

function persistedStates() {
  return mocks.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action?.type === setCompactWorkspaceInitializerFormState.type)
    .map((action) => action.payload[0]);
}

/** The repository fields the form currently shows (via the mock picker props). */
function shownSelection() {
  const text = (id: string) => screen.getByTestId(id).textContent ?? '';
  return {
    repoPath: text('picker-repo-path'),
    repoType: text('picker-repo-type'),
    githubUrl: text('picker-github-url'),
    branch: text('picker-branch'),
    skipIsolation: text('picker-skip-isolation') === 'true',
  };
}

/** Pick a repo and branch through the mock picker, click Create, return the request. */
async function submitWithRepo() {
  const picker = (
    window as unknown as {
      __mockRepoAndBranchPicker: {
        onRepoChange: (event: { detail: Record<string, unknown> }) => void;
        onBranchChange: (event: { detail: { branch: string } }) => void;
      };
    }
  ).__mockRepoAndBranchPicker;
  picker.onRepoChange({ detail: { path: '/tmp/test-repo', type: 'local', isValidPath: true } });
  picker.onBranchChange({ detail: { branch: 'main' } });
  const create = screen.getByRole('button', { name: /^Create workspace/ });
  await waitFor(() => expect(create.hasAttribute('disabled')).toBe(false));
  await fireEvent.click(create);
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  return mocks.create.mock.calls[0][0];
}

function modeCard(name: RegExp) {
  return screen.getByRole('button', { name });
}

function pickerTrigger(card: HTMLElement) {
  const trigger = card.querySelector('button[aria-haspopup="listbox"]');
  expect(trigger).toBeTruthy();
  return trigger as HTMLButtonElement;
}

function dropdownContent(listbox: HTMLElement) {
  const content = listbox.closest('[data-slot="dropdown-content"]');
  expect(content).toBeTruthy();
  return content as HTMLElement;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubGeometry(dialog: HTMLElement, trigger: HTMLButtonElement, triggerRect: DOMRect) {
  dialog.getBoundingClientRect = vi.fn(() => rect(80, 60, 840, 560));
  trigger.getBoundingClientRect = vi.fn(() => triggerRect);
  trigger.parentElement!.getBoundingClientRect = vi.fn(() => triggerRect);
}

let disposeStore: () => void;
let cancelCatalog: () => void;
let cancelInitialization: () => void;

describe('NewSpaceModal model-picker composition', () => {
  beforeEach(() => {
    mocks.formPersistence = false;
    mocks.compactFormState = null;
    mocks.lastSelectedRepo = null;
    mocks.recentRepos = [];
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.availableProviderIds = ['auggie'];
    mocks.configuredModels = {};
    mocks.selectedModel = undefined;
    mocks.defaultReasoningEffort = '';
    mocks.specialist = {
      id: 'spec-writer',
      name: 'Coordinator',
      description: '',
      source: 'user',
      resolvedModel: 'gpt5.5',
      resolvedProvider: 'auggie',
      model: undefined,
      defaultModel: undefined,
      reasoningEffort: undefined,
      resolvedReasoningEffort: undefined,
    };
    mocks.create.mockResolvedValue({ ok: false, error: 'Fixture stops after request capture' });
    disposeStore = appStore.init();
    admitLegacyPrincipal();
    appStore.dispatch(providerCatalogLoaded(MOCK_PROVIDER_CATALOG));
    appStore.dispatch(hydrateDefaultProvider('auggie'));
    appStore.dispatch(loadEnabledProvidersFromStorage({ auggie: true }));
    const dispatch = appStore.dispatch.bind(appStore);
    vi.spyOn(appStore, 'dispatch').mockImplementation((action) => {
      mocks.dispatch(action);
      return dispatch(action);
    });
    cancelCatalog = appStore.runSaga(modelReloadSaga);
    cancelInitialization = appStore.runSaga(workspaceInitializationSaga);
  });

  afterEach(() => {
    cleanup();
    cancelCatalog();
    cancelInitialization();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    disposeStore();
  });

  it.each(['team', 'single'] as const)(
    'preserves a bare non-default provider model and effort in %s mode',
    async (mode) => {
      mocks.availableProviderIds = ['auggie', 'codex'];
      render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
      const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
      const card = modeCard(mode === 'team' ? /Agent orchestration/i : /Single agent/i);
      if (mode === 'single') await fireEvent.click(card);
      await fireEvent.click(pickerTrigger(card));
      await fireEvent.click(await within(dialog).findByRole('tab', { name: /Codex/ }));
      await fireEvent.click(
        await within(dialog).findByRole('option', { name: 'Codex model', exact: true }),
      );
      await waitFor(() => expect(pickerTrigger(card).textContent).toContain('Codex model'));
      expect(card.getAttribute('aria-pressed')).toBe('true');
      expect(pickerTrigger(card).getAttribute('aria-expanded')).toBe('true');
      const effort = await within(dialog).findByTestId('effort-picker-trigger');
      await fireEvent.click(effort);
      const levels = document.getElementById(effort.getAttribute('aria-controls')!)!;
      await fireEvent.pointerUp(within(levels).getByRole('option', { name: 'High' }), {
        pointerType: 'mouse',
      });
      await waitFor(() =>
        expect(within(pickerTrigger(card)).getByLabelText('Codex model · High')).toBeTruthy(),
      );
      expect(mocks.onClose).not.toHaveBeenCalled();
      await fireEvent.click(pickerTrigger(card));
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      const request = await submitWithRepo();
      expect(request.initialAgent).toMatchObject({
        provider: 'codex',
        model: 'codex-model',
        reasoningEffort: 'high',
      });
      expect(request.initialAgent.metadata.workMode).toBe(mode);
    },
  );

  describe('sidebar repository defaults', () => {
    function selectSidebarRepo(key: string | null) {
      appStore.dispatch(
        setRepos([
          { path: '/repos/sidebar', name: 'sidebar', owner: 'acme', addedAt: '', lastUsedAt: '' },
          { path: '/repos/next', name: 'next', addedAt: '', lastUsedAt: '' },
          {
            path: 'acme/cloud',
            name: 'cloud',
            owner: 'acme',
            githubUrl: 'https://github.com/acme/cloud',
            addedAt: '',
            lastUsedAt: '',
          },
        ]),
      );
      appStore.dispatch(updateHomeWorkspaceView({ repoKey: key }));
    }

    beforeEach(() => {
      mocks.formPersistence = true;
      mocks.lastSelectedRepo = { path: '/repos/last-used', type: 'local', isValidPath: true };
      selectSidebarRepo('acme/sidebar');
    });

    it('uses the sidebar repository over the last-used repository', async () => {
      render(NewSpaceModal, { props: { open: true } });
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/sidebar'),
      );
    });

    it('replaces saved repository fields while retaining saved agent settings', async () => {
      mocks.compactFormState = {
        repoPath: '/repos/saved',
        repoType: 'remote',
        githubUrl: 'https://github.com/old/repo',
        branch: 'old-branch',
        scope: 'old-scope',
        scopeRepoPath: '/repos/saved',
        remoteSetup: {
          id: 'remote',
          name: 'Remote',
          host: 'example.com',
          port: 22,
          username: 'user',
          workspacePath: '/repos/remote',
        },
        selectedSpecialist: 'spec-writer',
      };
      render(NewSpaceModal, { props: { open: true } });
      await waitFor(() =>
        expect(shownSelection()).toMatchObject({
          repoPath: '/repos/sidebar',
          repoType: 'local',
          githubUrl: 'https://github.com/acme/sidebar',
          branch: '',
        }),
      );
      const picker = (
        window as unknown as {
          __mockRepoAndBranchPicker: {
            onBranchChange: (event: { detail: { branch: string } }) => void;
          };
        }
      ).__mockRepoAndBranchPicker;
      picker.onBranchChange({ detail: { branch: 'main' } });
      const create = screen.getByRole('button', { name: /^Create workspace/ });
      await waitFor(() => expect(create.hasAttribute('disabled')).toBe(false));
      await fireEvent.click(create);
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
      const request = mocks.create.mock.calls[0][0];
      expect(request).toMatchObject({ repositoryPath: '/repos/sidebar', baseRef: 'main' });
      expect(request.isRemote).toBeFalsy();
      expect(request.initialAgent.specialist).toBe('spec-writer');
    });

    it('retains the saved branch for the same repository', async () => {
      mocks.compactFormState = {
        repoPath: '/repos/sidebar',
        repoType: 'local',
        isValidPath: true,
        branch: 'feature',
      };
      render(NewSpaceModal, { props: { open: true } });
      await waitFor(() =>
        expect(shownSelection()).toMatchObject({ repoPath: '/repos/sidebar', branch: 'feature' }),
      );
    });

    it.each(['last-used', 'recent', 'empty'] as const)(
      'keeps the All repos %s fallback',
      async (history) => {
        selectSidebarRepo(null);
        if (history !== 'last-used') mocks.lastSelectedRepo = null;
        if (history === 'recent')
          mocks.recentRepos = [{ path: '/repos/recent', type: 'local', name: 'recent' }];
        render(NewSpaceModal, { props: { open: true } });
        await waitFor(() =>
          expect(screen.getByTestId('picker-repo-path').textContent).toBe(
            history === 'empty' ? '' : `/repos/${history}`,
          ),
        );
      },
    );

    it('uses the current selection on each opening without overwriting manual edits', async () => {
      const view = render(NewSpaceModal, { props: { open: true } });
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/sidebar'),
      );
      const picker = (
        window as unknown as {
          __mockRepoAndBranchPicker: {
            onRepoChange: (event: { detail: Record<string, unknown> }) => void;
          };
        }
      ).__mockRepoAndBranchPicker;
      picker.onRepoChange({ detail: { path: '/repos/manual', type: 'local', isValidPath: true } });
      selectSidebarRepo('/repos/next');
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/manual'),
      );
      await view.rerender({ open: false });
      await waitFor(() => expect(screen.queryByTestId('picker-repo-path')).toBeNull());
      await view.rerender({ open: true });
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/next'),
      );
    });

    it('keeps prompt-only prefills while defaulting to the sidebar repository', async () => {
      mocks.compactFormState = {
        repoPath: '/repos/saved',
        repoType: 'local',
        isValidPath: true,
        branch: 'old-branch',
      };
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({ title: 'Linear issue', prompt: 'ENG-123: Fix the issue' }),
      );
      render(NewSpaceModal, { props: { open: true } });
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/sidebar'),
      );
      expect(screen.getByTestId('mock-rich-textarea').textContent).toContain(
        'ENG-123: Fix the issue',
      );
      expect(shownSelection()).toMatchObject({ repoPath: '/repos/sidebar', branch: '' });
    });

    it('keeps explicit session repository and branch prefills', async () => {
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({ repoPath: '/repos/explicit', branch: 'feature' }),
      );
      render(NewSpaceModal, { props: { open: true } });
      await waitFor(() =>
        expect(shownSelection()).toMatchObject({ repoPath: '/repos/explicit', branch: 'feature' }),
      );
    });

    it('keeps standalone explicit initialRepo launches', async () => {
      render(CompactWorkspaceInitializer, {
        props: { isExpanded: true, initialRepo: { repoPath: '/repos/explicit' } },
      });
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/explicit'),
      );
    });

    it('preserves path-less GitHub selections', async () => {
      selectSidebarRepo('acme/cloud');
      render(NewSpaceModal, { props: { open: true } });
      await waitFor(() =>
        expect(shownSelection()).toMatchObject({
          repoPath: 'acme/cloud',
          repoType: 'github',
          githubUrl: 'https://github.com/acme/cloud',
        }),
      );
    });

    it.each(['skipIsolation', 'skipWorktree'] as const)(
      'clears saved %s for a GitHub sidebar default and requests an isolated checkout',
      async (flag) => {
        mocks.compactFormState = {
          repoPath: '/repos/saved',
          repoType: 'local',
          isValidPath: true,
          [flag]: true,
        };
        selectSidebarRepo('acme/cloud');
        sessionStorage.setItem(
          'workspace-prefill',
          JSON.stringify({ prompt: 'Work on the sidebar repository' }),
        );
        render(NewSpaceModal, { props: { open: true } });
        await waitFor(() =>
          expect(shownSelection()).toMatchObject({
            repoPath: 'acme/cloud',
            repoType: 'github',
            skipIsolation: false,
          }),
        );
        const picker = (
          window as unknown as {
            __mockRepoAndBranchPicker: {
              onBranchChange: (event: { detail: { branch: string } }) => void;
            };
          }
        ).__mockRepoAndBranchPicker;
        // Automatic branch selection does not emit a direct-work toggle change.
        picker.onBranchChange({ detail: { branch: 'main' } });
        const create = screen.getByRole('button', { name: /^Create workspace/ });
        await waitFor(() => expect(create.hasAttribute('disabled')).toBe(false));
        await fireEvent.click(create);
        await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
        expect(mocks.create.mock.calls[0][0]).toMatchObject({
          githubUrl: 'https://github.com/acme/cloud',
          repositoryPath: undefined,
          baseRef: 'main',
          skipIsolation: undefined,
        });
      },
    );

    describe('GitHub repository cloned by a "Pick a repo" workspace', () => {
      const clonePath = '/workspaces/ideate-future/intent';

      // A Pick-a-repo workspace is cloned into its own folder, so the daemon
      // reports the clone as both repositoryPath and worktreePath, and no
      // known repo row backs the group.
      function selectClonedSidebarRepo() {
        appStore.dispatch(setRepos([]));
        appStore.dispatch(
          replaceWorkspaceList([
            {
              id: 'ideate-future',
              title: 'Ideate',
              status: WorkspaceStatusEnum.Active,
              createdAt: '',
              updatedAt: '',
              changesets: [],
              timeline: [],
              conversationInfo: [],
              repositoryPath: clonePath,
              worktreePath: clonePath,
              repositoryOwner: 'intent-hq',
              repositoryName: 'intent',
            },
          ]),
        );
        appStore.dispatch(updateHomeWorkspaceView({ repoKey: 'intent-hq/intent' }));
      }

      it('defaults to the GitHub pick instead of copying the workspace clone', async () => {
        selectClonedSidebarRepo();
        render(NewSpaceModal, { props: { open: true } });
        await waitFor(() =>
          expect(shownSelection()).toMatchObject({
            repoPath: 'intent-hq/intent',
            repoType: 'github',
            githubUrl: 'https://github.com/intent-hq/intent',
            skipIsolation: false,
          }),
        );
      });

      it('keeps the saved GitHub pick of the same repository with its branch', async () => {
        mocks.compactFormState = {
          repoPath: 'intent-hq/intent',
          repoType: 'github',
          githubUrl: 'https://github.com/intent-hq/intent',
          isValidPath: true,
          branch: 'release',
        };
        selectClonedSidebarRepo();
        render(NewSpaceModal, { props: { open: true } });
        await waitFor(() =>
          expect(shownSelection()).toMatchObject({
            repoPath: 'intent-hq/intent',
            repoType: 'github',
            branch: 'release',
          }),
        );
      });

      it('replaces a saved local copy of the workspace clone with the GitHub pick', async () => {
        mocks.compactFormState = {
          repoPath: clonePath,
          repoType: 'local',
          githubUrl: 'https://github.com/intent-hq/intent',
          isValidPath: true,
          branch: 'main',
        };
        selectClonedSidebarRepo();
        render(NewSpaceModal, { props: { open: true } });
        await waitFor(() =>
          expect(shownSelection()).toMatchObject({
            repoPath: 'intent-hq/intent',
            repoType: 'github',
            branch: '',
          }),
        );
      });
    });

    it.each(['skipIsolation', 'skipWorktree'] as const)(
      'preserves saved %s for a local sidebar default',
      async (flag) => {
        mocks.compactFormState = {
          repoPath: '/repos/saved',
          repoType: 'local',
          isValidPath: true,
          [flag]: true,
        };
        render(NewSpaceModal, { props: { open: true } });
        await waitFor(() =>
          expect(shownSelection()).toMatchObject({
            repoPath: '/repos/sidebar',
            repoType: 'local',
            skipIsolation: true,
          }),
        );
      },
    );
  });

  it('does not let initializer timers override modal focus, while inline prompts still autofocus', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const modal = render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
    await tick();
    const modalPrompt = screen.getByTestId('mock-rich-textarea');
    await vi.advanceTimersByTimeAsync(500);
    expect(focus.mock.contexts).not.toContain(modalPrompt);
    modal.unmount();

    render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
    await tick();
    const inlinePrompt = screen.getByTestId('mock-rich-textarea');
    await vi.advanceTimersByTimeAsync(500);
    expect(focus.mock.contexts).toContain(inlinePrompt);
  });

  it('selects models in both modes without bubbling or closing', async () => {
    render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
    const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
    const team = modeCard(/Agent orchestration/i);
    const single = modeCard(/Single agent/i);

    const teamTrigger = pickerTrigger(team);
    stubGeometry(dialog, teamTrigger, rect(140, 520, 150, 28));
    await fireEvent.click(teamTrigger);
    const teamListbox = await within(dialog).findByRole('listbox');
    const teamContent = dropdownContent(teamListbox);
    expect(dialog.contains(teamListbox)).toBe(true);
    expect(teamContent.dataset.side).toBe('top');
    expect(teamContent.style.maxHeight).toBe('360px');
    expect(parseFloat(teamContent.style.maxWidth)).toBeLessThanOrEqual(824);
    expect(
      await within(teamListbox).findByRole('option', { name: /^GPT 5\.1 Model 1/ }),
    ).toBeTruthy();
    expect(within(teamListbox).getByRole('option', { name: /^GPT 5\.12 Last model/ })).toBeTruthy();
    await fireEvent.click(
      await within(teamListbox).findByRole('option', { name: /GPT 5\.6/ }, { timeout: 5000 }),
    );

    await waitFor(() => {
      expect(pickerTrigger(team).textContent).toContain('GPT 5.6');
      expect(team.getAttribute('aria-pressed')).toBe('true');
    });

    expect(pickerTrigger(team).getAttribute('aria-expanded')).toBe('true');
    const reasoningTrigger = await within(dialog).findByTestId('effort-picker-trigger');
    await fireEvent.click(reasoningTrigger);
    const reasoningListbox = document.getElementById(
      reasoningTrigger.getAttribute('aria-controls')!,
    )!;
    expect(reasoningListbox.getAttribute('role')).toBe('listbox');
    expect(reasoningListbox.getAttribute('tabindex')).toBe('-1');
    await fireEvent.pointerUp(within(reasoningListbox).getByRole('option', { name: 'High' }), {
      pointerType: 'mouse',
    });
    await waitFor(() => {
      const updatedTeamTrigger = pickerTrigger(team);
      expect(within(updatedTeamTrigger).getByLabelText('GPT 5.6 · High')).toBeTruthy();
      expect(updatedTeamTrigger.textContent).not.toContain('High');
      const effortGauge = within(updatedTeamTrigger).getByTestId('model-reasoning-effort-gauge');
      expect(effortGauge.dataset.gaugeValue).toBe('2');
      expect(effortGauge.dataset.gaugeSize).toBe('compact');
    });
    await fireEvent.click(pickerTrigger(team));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(team.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(within(pickerTrigger(team)).getByLabelText('GPT 5.6 · High')).toBeTruthy();
    expect(mocks.onClose).not.toHaveBeenCalled();

    await fireEvent.click(single);
    expect(single.getAttribute('aria-pressed')).toBe('true');
    const singleTrigger = pickerTrigger(single);
    stubGeometry(dialog, singleTrigger, rect(600, 120, 150, 28));
    await fireEvent.click(singleTrigger);
    const singleListbox = await within(dialog).findByRole('listbox');
    const singleContent = dropdownContent(singleListbox);
    expect(singleContent.dataset.side).toBe('bottom');
    expect(singleContent.style.maxHeight).toBe('360px');
    await fireEvent.click(
      await within(singleListbox).findByRole('option', { name: /GPT 5\.5/ }, { timeout: 5000 }),
    );

    await waitFor(() => {
      expect(pickerTrigger(single).textContent).toContain('GPT 5.5');
    });
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBe(dialog);
    expect(mocks.onClose).not.toHaveBeenCalled();
    await fireEvent.click(pickerTrigger(single));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    const request = await submitWithRepo();
    expect(request.initialAgent).toMatchObject({ provider: 'auggie', model: 'gpt5.5' });
    expect(request.initialAgent.metadata.workMode).toBe('single');
  });

  it.each([
    {
      name: 'explicit model with specialist effort',
      explicitModel: true,
      foreignPin: false,
      otherDefaultProvider: false,
    },
    {
      name: 'foreign specialist pin falling through to Settings',
      explicitModel: false,
      foreignPin: true,
      otherDefaultProvider: false,
    },
    {
      name: 'selected provider Settings outside the default provider',
      explicitModel: false,
      foreignPin: false,
      otherDefaultProvider: true,
    },
  ])(
    'submits Auto after displaying $name',
    async ({ explicitModel, foreignPin, otherDefaultProvider }) => {
      mocks.specialist.resolvedModel = 'gpt5.6';
      if (explicitModel) {
        mocks.specialist.reasoningEffort = 'high';
        mocks.specialist.resolvedReasoningEffort = 'high';
      } else {
        mocks.configuredModels = { auggie: 'gpt5.6' };
        mocks.selectedModel = 'gpt5.6';
        mocks.defaultReasoningEffort = 'high';
        if (foreignPin) {
          mocks.specialist.model = 'foreign-model';
          mocks.specialist.defaultModel = 'foreign-model';
        }
        if (otherDefaultProvider) appStore.dispatch(hydrateDefaultProvider('codex'));
      }
      const view = render(CompactWorkspaceInitializer, { props: { isExpanded: true } });
      const team = modeCard(/Agent orchestration/i);
      await waitFor(() =>
        expect(within(pickerTrigger(team)).getByLabelText('GPT 5.6 · High')).toBeTruthy(),
      );

      if (explicitModel) {
        await fireEvent.click(pickerTrigger(team));
        const modelListbox = await screen.findByRole('listbox');
        await fireEvent.click(within(modelListbox).getByRole('option', { name: /GPT 5\.6/ }));
        await waitFor(() =>
          expect(within(pickerTrigger(team)).getByLabelText('GPT 5.6 · High')).toBeTruthy(),
        );
      }

      if (!explicitModel) await fireEvent.click(pickerTrigger(team));
      const reasoningTrigger = await screen.findByTestId('effort-picker-trigger');
      await fireEvent.click(reasoningTrigger);
      const reasoningListbox = document.getElementById(
        reasoningTrigger.getAttribute('aria-controls')!,
      )!;
      await fireEvent.pointerUp(within(reasoningListbox).getByRole('option', { name: 'Auto' }), {
        pointerType: 'mouse',
      });
      await waitFor(() =>
        expect(within(pickerTrigger(team)).queryByLabelText('GPT 5.6 · High')).toBeNull(),
      );
      await fireEvent.click(pickerTrigger(team));

      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({
          repoPath: '/tmp/test-repo',
          branch: 'main',
          prompt: 'Clear inherited effort',
          autoCreate: true,
        }),
      );
      await view.component.applyPrefill();
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
      expect(mocks.create.mock.calls[0][0].initialAgent).toEqual({
        name: 'Coordinator',
        nameExplicitlySet: false,
        rememberSpecialist: true,
        model: explicitModel ? 'gpt5.6' : undefined,
        provider: 'auggie',
        specialist: 'spec-writer',
        reasoningEffort: '',
        behaviorPrompt: undefined,
        prompt: 'Clear inherited effort',
        agentType: 'workspace',
        contextReferences: undefined,
        imageBlocks: undefined,
        metadata: {
          source: 'compact-initializer',
          isInitialAgent: true,
          specialist: 'spec-writer',
          provider: 'auggie',
          workMode: 'team',
          createdAt: expect.any(String),
        },
      });
    },
  );

  describe('choices are saved only when a workspace is created', () => {
    beforeEach(() => {
      mocks.formPersistence = true;
      mocks.compactFormState = {
        repoPath: '/repos/created',
        repoType: 'local',
        isValidPath: true,
        branch: 'main',
      };
    });

    function savedSelections() {
      return mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) =>
          [
            setCompactWorkspaceInitializerFormState.type,
            setWorkspaceInitializerLastSelectedRepo.type,
            setWorkspaceInitializerBranchForRepo.type,
          ].includes(action?.type),
        );
    }

    it('does not save repo, branch or model changes after a failed create and cancel', async () => {
      const view = render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
      const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/created'),
      );
      const picker = (
        window as unknown as {
          __mockRepoAndBranchPicker: {
            onRepoChange: (event: { detail: Record<string, unknown> }) => void;
            onBranchChange: (event: { detail: { branch: string } }) => void;
          };
        }
      ).__mockRepoAndBranchPicker;
      picker.onRepoChange({ detail: { path: '/repos/other', type: 'local', isValidPath: true } });
      picker.onBranchChange({ detail: { branch: 'feature' } });
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/other'),
      );
      const trigger = pickerTrigger(modeCard(/Agent orchestration/i));
      await fireEvent.click(trigger);
      await fireEvent.click(
        await within(dialog).findByRole('option', { name: /GPT 5\.6/ }, { timeout: 5000 }),
      );
      await waitFor(() => expect(trigger.textContent).toContain('GPT 5.6'));

      // A create that fails must not save anything either.
      const create = screen.getByRole('button', { name: /^Create workspace/ });
      await waitFor(() => expect(create.hasAttribute('disabled')).toBe(false));
      await fireEvent.click(create);
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
      await mocks.create.mock.results[0].value;
      await tick();

      await view.rerender({ open: false });
      await waitFor(() => expect(screen.queryByTestId('picker-repo-path')).toBeNull());

      expect(savedSelections()).toEqual([]);
    });

    it('saves the created repo, branch and model after a successful create', async () => {
      mocks.create.mockResolvedValue({
        ok: true,
        data: {
          workspace: {
            id: 'ws-created',
            title: 'Created',
            status: WorkspaceStatusEnum.Active,
            createdAt: '',
            updatedAt: '',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            repositoryPath: '/repos/other',
          },
          initialAgent: { id: 'agent-created' },
        },
      });
      render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
      const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
      await waitFor(() =>
        expect(screen.getByTestId('picker-repo-path').textContent).toBe('/repos/created'),
      );
      const picker = (
        window as unknown as {
          __mockRepoAndBranchPicker: {
            onRepoChange: (event: { detail: Record<string, unknown> }) => void;
            onBranchChange: (event: { detail: { branch: string } }) => void;
          };
        }
      ).__mockRepoAndBranchPicker;
      picker.onRepoChange({ detail: { path: '/repos/other', type: 'local', isValidPath: true } });
      picker.onBranchChange({ detail: { branch: 'feature' } });
      const trigger = pickerTrigger(modeCard(/Agent orchestration/i));
      await fireEvent.click(trigger);
      await fireEvent.click(
        await within(dialog).findByRole('option', { name: /GPT 5\.6/ }, { timeout: 5000 }),
      );
      await waitFor(() => expect(trigger.textContent).toContain('GPT 5.6'));
      expect(savedSelections()).toEqual([]);

      const create = screen.getByRole('button', { name: /^Create workspace/ });
      await waitFor(() => expect(create.hasAttribute('disabled')).toBe(false));
      await fireEvent.click(create);
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

      await waitFor(() =>
        expect(persistedStates().at(-1)).toMatchObject({
          repoPath: '/repos/other',
          repoType: 'local',
          branch: 'feature',
          selectedModel: 'gpt5.6',
        }),
      );
      const lastRepo = mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action?.type === setWorkspaceInitializerLastSelectedRepo.type)
        .at(-1);
      expect(lastRepo?.payload[0]).toMatchObject({ path: '/repos/other', type: 'local' });
    });
  });

  it('keeps keyboard and dismissal behavior inside the open dialog', async () => {
    render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
    const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
    const team = modeCard(/Agent orchestration/i);
    const trigger = pickerTrigger(team);

    await fireEvent.click(trigger);
    await within(dialog).findByRole('option', { name: /GPT 5\.6/ }, { timeout: 5000 });
    const search = await within(dialog).findByRole('searchbox', { name: 'Search options' });
    await fireEvent.input(search, { target: { value: 'GPT 5.6' } });
    await fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(trigger.textContent).toContain('GPT 5.6'));
    expect(team.getAttribute('aria-pressed')).toBe('true');

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(await within(dialog).findByRole('listbox')).toBeTruthy();
    await fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBe(dialog);

    await fireEvent.click(trigger);
    const reopenedSearch = await within(dialog).findByRole('searchbox', { name: 'Search options' });
    await fireEvent.keyDown(reopenedSearch, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBe(dialog);
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('dismisses nested reasoning before the modal-aware model picker on Escape', async () => {
    render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
    const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
    const team = modeCard(/Agent orchestration/i);
    const modelTrigger = pickerTrigger(team);

    await fireEvent.click(modelTrigger);
    const modelListbox = await within(dialog).findByRole('listbox');
    await fireEvent.click(
      await within(modelListbox).findByRole('option', { name: /GPT 5\.6/ }, { timeout: 5000 }),
    );
    await waitFor(() => expect(modelTrigger.textContent).toContain('GPT 5.6'));

    expect(modelTrigger.getAttribute('aria-expanded')).toBe('true');
    const reasoningTrigger = await within(dialog).findByTestId('effort-picker-trigger');
    reasoningTrigger.focus();
    await fireEvent.keyDown(reasoningTrigger, { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByRole('listbox')).toHaveLength(2));
    // Escape must not commit the highlighted reasoning level.
    const effortShown = () =>
      within(modelTrigger).queryByTestId('model-reasoning-effort-gauge')?.dataset.gaugeValue;
    const effortBefore = effortShown();

    await fireEvent.keyDown(reasoningTrigger, { key: 'ArrowDown' });
    expect(screen.getAllByRole('listbox')).toHaveLength(2);
    await fireEvent.keyDown(reasoningTrigger, { key: 'Escape' });

    await waitFor(() => {
      expect(within(dialog).getAllByRole('listbox')).toHaveLength(1);
      expect(reasoningTrigger.getAttribute('aria-expanded')).toBe('false');
    });
    expect(document.activeElement).toBe(reasoningTrigger);
    expect(effortShown()).toBe(effortBefore);
    expect(mocks.onClose).not.toHaveBeenCalled();

    await fireEvent.keyDown(reasoningTrigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(modelTrigger);
    expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBe(dialog);
    expect(effortShown()).toBe(effortBefore);
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('affirms model picker bounds and options in every required visual state', async () => {
    for (const { theme, width, zoom, reducedMotion } of [
      { theme: 'light', width: 1024, zoom: 1, reducedMotion: false },
      { theme: 'dark', width: 520, zoom: 2, reducedMotion: true },
    ]) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 420 });
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
          matches: query.includes('prefers-reduced-motion') && reducedMotion,
          addEventListener() {},
          removeEventListener() {},
        }),
      });
      const view = render(NewSpaceModal, { props: { open: true, onClose: mocks.onClose } });
      view.container.style.zoom = String(zoom);
      const dialog = await screen.findByRole('dialog', { name: 'New Workspace' });
      dialog.getBoundingClientRect = vi.fn(() => rect(16, 16, 488, 388));
      const trigger = pickerTrigger(modeCard(/Agent orchestration/i));
      trigger.getBoundingClientRect = vi.fn(() => rect(210, 330, 150, 28));
      trigger.parentElement!.getBoundingClientRect = vi.fn(() => rect(210, 330, 150, 28));

      await fireEvent.mouseEnter(trigger);
      trigger.focus();
      await fireEvent.click(trigger);
      const listbox = await within(dialog).findByRole('listbox');
      const content = dropdownContent(listbox);
      expect(content.dataset.side).toBe('top');
      expect(parseFloat(content.style.maxHeight)).toBeLessThanOrEqual(306);
      expect(parseFloat(content.style.maxWidth)).toBeLessThanOrEqual(472);
      expect(listbox.className).toContain('overflow-y-auto');

      const search = within(content).getByRole('searchbox', { name: 'Search options' });
      expect(search.getAttribute('aria-controls')).toBe(listbox.id);
      expect(listbox.contains(search)).toBe(false);
      await within(listbox).findByRole('option', { name: /^GPT 5\.12 Last model/ });
      await fireEvent.keyDown(search, { key: 'End' });
      expect(
        within(listbox).getByRole('option', { name: /^GPT 5\.12 Last model/ }).dataset.highlighted,
      ).toBe('true');
      await fireEvent.keyDown(search, { key: 'Home' });
      expect(
        within(listbox).getByRole('option', { name: /^GPT 5\.1 Model 1/ }).dataset.highlighted,
      ).toBe('true');
      view.unmount();
    }
  });
});

vi.mock('$store/renderer/slices/provider-catalog/workspace-catalog-selectors', async () => {
  const providers =
    await import('$store/renderer/slices/provider-settings/provider-settings-selectors');
  const models = await import('$store/renderer/slices/model/model-selectors');
  const catalog =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-selectors');
  const specialists = await import('$store/renderer/slices/specialists/specialists-selectors');
  const availability =
    await import('$store/renderer/slices/agent-availability/agent-availability-selectors');
  return {
    selectWorkspaceCatalogEpoch: () => mocks.readable(0),
    selectContextProviderEntries: catalog.selectProviderCatalogEntries,
    selectContextDefaultProvider: providers.selectActiveProviderId,
    selectContextSelectedModel: models.selectSelectedModel,
    selectContextEnabledProviders: providers.selectEnabledProviders,
    selectContextAvailableProviderIds: providers.selectAvailableEnabledProviderIds,
    selectContextModelProviderIds: providers.selectModelFetchProviderIds,
    selectContextReadinessLoaded: availability.selectHasCheckedOnce,
    selectContextProviderWarnings: models.selectAllProviderWarnings,
    selectContextProviderStaleFlags: models.selectAllProviderStaleFlags,
    selectContextSpecialists: specialists.selectSpecialists,
  };
});

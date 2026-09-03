/**
 * @vitest-environment jsdom
 *
 * Regression tests (intent-hq/monorepo#2678) at the CompactWorkspaceInitializer
 * level, with the REAL InitialAgentPicker rendered: a valid persisted model
 * override survives workspace-initializer hydration and is submitted as
 * `initialAgent.model`; an in-session pick survives late hydration
 * (the applyAgentSettings re-application must not overwrite it).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompactWorkspaceInitializerFormState } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

const mocks = vi.hoisted(() => {
  function writable<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(run: (v: T) => void) {
        subs.add(run);
        run(value);
        return () => subs.delete(run);
      },
      set(v: T) {
        value = v;
        for (const run of subs) run(v);
      },
    };
  }
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  return {
    writable,
    readable,
    dispatch: vi.fn(),
    goto: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    hydrated$: writable(false),
    compactFormState$: writable<unknown>(null),
    lastSubmittedAgent$: writable<unknown>(null),
    // Never resolves: provider availability stays unknown, so it is never
    // clearing evidence — the provider-models catalog below decides validity.
    getProviderAvailability: vi.fn(() => new Promise(() => {})),
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { initialState, providerCatalogLoaded, providerCatalogReducer } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } =
    await import('../../../../test/fixtures/provider-catalog.fixture');
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );
  return createAppStoreMockModule({
    state: () => ({
      providerCatalog,
      providerSettings: { enabledProviders: {} },
      model: { defaultProviderId: 'auggie' },
      // The auggie catalog KNOWS opus4.6 — the restored override is valid.
      providerModels: {
        byProviderId: {
          auggie: {
            models: [
              { value: 'fable-5' },
              { value: 'opus4.6' },
              { value: 'user-picked-model' },
            ],
            fetchedAt: '2026-08-15T00:00:00.000Z',
          },
        },
        clearEpoch: 0,
      },
      hardwareConsole: { pttRecording: false, voiceTranscribing: false },
      workspaceCreateProgress: { byProgressId: {} },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
  selectCompactWorkspaceInitializerFormState: () => mocks.compactFormState$,
  selectWorkspaceInitializerLastSelectedRepo: () => mocks.readable(null),
  selectWorkspaceInitializerLastSubmittedAgent: () => mocks.lastSubmittedAgent$,
  selectWorkspaceInitializerRecentRepos: () => mocks.readable([]),
  selectWorkspaceInitializerPendingGitHubPrefill: () => mocks.readable(null),
  selectWorkspaceInitializerDefaultParentPath: () => mocks.readable(''),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAvailableModels: () => mocks.readable([]),
  selectAvailableModelsProviderId: () => mocks.readable(''),
  selectSelectedModel: () => mocks.readable(''),
  selectModelEffortLevels: { select: () => undefined },
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable('auggie'),
}));

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(
    () =>
      mocks.readable([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    { select: vi.fn(() => []) },
  ),
  selectCustomSpecialistsLoaded: () => mocks.readable(true),
  selectFileSpecialistsLoaded: () => mocks.readable(true),
  selectUserOverrides: { select: vi.fn(() => ({ modelOverrides: {} })) },
  selectEffectiveBehaviorPrompt: { select: vi.fn(() => undefined) },
  selectEffectiveModel: { select: vi.fn(() => undefined) },
  selectEffectiveCodingAgent: { select: vi.fn(() => undefined) },
  selectOrchestratorSpecialist: Object.assign(
    () =>
      mocks.readable({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
        teamAgents: ['implementor', 'verifier'],
        icon: 'coordinator',
      }),
    {
      select: vi.fn(() => ({
        id: 'spec-writer',
        name: 'Coordinator',
        description: '',
        role: 'orchestrator',
        teamAgents: ['implementor', 'verifier'],
        icon: 'coordinator',
      })),
    },
  ),
  filterModalPickableSpecialists: (specialists: Array<{ role?: string }>) =>
    specialists.filter((s) => s.role !== 'internal'),
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => mocks.readable(true),
}));

vi.mock('$features/providers/provider-availability.client', () => ({
  getProviderAvailability: mocks.getProviderAvailability,
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: vi.fn(),
}));

vi.mock('$features/setup-scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$features/setup-scripts')>()),
  SETUP_SCRIPT_TEMPLATES: [],
  getTemplateContent: vi.fn(() => ''),
  chooseDefaultSetupScript: vi.fn(() => ({ content: '', name: 'Custom', source: 'custom' })),
  fetchRepoConfigSetupScript: vi.fn(async () => null),
  fetchGitHubRepoConfigSetupScript: vi.fn(async () => null),
  probeRepoConfigSetupScript: vi.fn(),
  repoIdentityKey: vi.fn((identity: { path: string | null }) => identity.path),
  createRepoConfigProbeScheduler: vi.fn(() => ({
    onSelectionChange: vi.fn(),
    settled: vi.fn(async () => {}),
    dispose: vi.fn(),
  })),
  resolveSetupScriptParam: vi.fn(() => undefined),
  REPO_CONFIG_SCRIPT_NAME: 'Repo config',
}));

vi.mock('$features/setup-scripts/last-used', () => ({
  getLastUsedSetupScript: vi.fn(() => undefined),
  recordLastUsedSetupScript: vi.fn(),
}));

vi.mock('$lib/config/debug', () => ({
  debugConfig: { get: vi.fn(() => false) },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    git: { pull: vi.fn(async () => ({ success: true })) },
    drafts: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    },
    specialists: {
      list: vi.fn(async () => [
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    },
    agents: { setReasoningEffort: vi.fn(async () => ({ ok: true })) },
  },
}));

vi.mock('$lib/client/live/live-prompt-enhancement', () => ({
  enhancePrompt: vi.fn(async (p: string) => ({ enhanced: p })),
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
  workspaceClient: { create: mocks.create, update: mocks.update },
}));

vi.mock('$lib/electron-bridge', () => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(async (channel: string) => {
    if (channel === 'system:check-git') {
      return { success: true, data: { available: true, version: '2.44.0' } };
    }
    return { success: true, data: null };
  }),
  listen: vi.fn(async () => () => {}),
  listenSync: vi.fn(() => () => {}),
  emit: vi.fn(async () => {}),
}));

vi.mock('$lib/components/ui/RichTextarea.svelte', async () => ({
  default: (await import('./mocks/MockRichTextarea.svelte')).default,
}));

vi.mock('$lib/components/modals/PullConflictDialog.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/modals/SetupScriptModal.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/workspace/initializer/IssueSuggestions.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
  preloadIssues: vi.fn(),
}));

vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/chat/AttachmentPreview.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

// The REAL InitialAgentPicker is rendered; only its inner ModelPicker and
// dropdown are mocked (same boundaries as InitialAgentPicker.test.ts).
vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockModelPicker.svelte')).default,
}));

vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockDropdownMenu.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import CompactWorkspaceInitializer from '../CompactWorkspaceInitializer.svelte';
import { warmImport } from '../../../../test/warm-import';

const PREFILL_KEY = 'workspace-prefill';

function mockCreateSuccess() {
  mocks.create.mockResolvedValue({
    ok: true,
    data: {
      workspace: {
        id: 'ws-created',
        title: 'Created workspace',
        path: '/tmp/ws-created',
        repositoryPath: '/tmp/test-repo',
        worktreePath: '/tmp/ws-created',
        status: 'Active',
      },
      initialAgent: { id: 'agent-created' },
    },
  });
}

function submittedInitialAgent() {
  expect(mocks.create).toHaveBeenCalledTimes(1);
  return mocks.create.mock.calls[0][0].initialAgent;
}

warmImport(() => import('./mocks/MockRichTextarea.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockComponent.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockModelPicker.svelte'));
warmImport(() => import('../initializer/__tests__/mocks/MockDropdownMenu.svelte'));

const SAVED_AGENT_STATE: CompactWorkspaceInitializerFormState = {
  repoPath: '',
  repoType: 'local',
  githubUrl: '',
  branch: '',
  isNewRepo: false,
  isValidPath: false,
  scope: '',
  selectedSpecialist: 'spec-writer',
  selectedModel: 'opus4.6',
  modelWasOverridden: true,
  isTeamMode: true,
  selectedProvider: 'auggie',
};

describe('initializer model-override persistence (monorepo#2678)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.hydrated$.set(false);
    mocks.compactFormState$.set(null);
    mocks.lastSubmittedAgent$.set(null);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('submits a valid restored override as initialAgent.model after hydration', async () => {
    mockCreateSuccess();
    mocks.compactFormState$.set(SAVED_AGENT_STATE);
    mocks.hydrated$.set(true);
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({
        repoPath: '/tmp/test-repo',
        branch: 'main',
        prompt: 'Build the thing',
        autoCreate: true,
      }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: true },
    });
    // The restored override must survive hydration (visible in the picker)…
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-selected')[0].textContent).toBe('opus4.6'),
    );

    await component.applyPrefill();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));

    // …and be submitted as the initial agent's model.
    expect(submittedInitialAgent()).toMatchObject({
      model: 'opus4.6',
      provider: 'auggie',
    });
  });

  it('keeps an in-session pick when hydration lands late and is submitted', async () => {
    mockCreateSuccess();
    sessionStorage.setItem(
      PREFILL_KEY,
      JSON.stringify({
        repoPath: '/tmp/test-repo',
        branch: 'main',
        prompt: 'Build the thing',
      }),
    );

    const { component } = render(CompactWorkspaceInitializer, {
      props: { isExpanded: true },
    });
    await component.applyPrefill();

    // User picks a model while hydration is still pending.
    await fireEvent.click(screen.getAllByTestId('pick-model')[0]);
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-selected')[0].textContent).toBe('user-picked-model'),
    );

    // Late hydration re-applies persisted agent settings (opus4.6) — the
    // repo is already set, so the lastSubmittedAgent branch applies. The
    // in-session pick must survive.
    mocks.lastSubmittedAgent$.set(SAVED_AGENT_STATE);
    mocks.hydrated$.set(true);
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-selected')[0].textContent).toBe('user-picked-model'),
    );

    const createButton = screen.getByRole('button', { name: /create/i });
    await fireEvent.click(createButton);
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-created'));

    expect(submittedInitialAgent()).toMatchObject({ model: 'user-picked-model' });
  });
});

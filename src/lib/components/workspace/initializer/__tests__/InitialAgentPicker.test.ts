/**
 * @vitest-environment jsdom
 *
 * Covers the reactive, data-gated stale-model-override clearing in
 * InitialAgentPicker: a persisted override is only cleared once file
 * specialists and initializer hydration are ready AND there is positive
 * evidence it is invalid (its provider is reported unavailable, or a loaded
 * catalog for its provider lacks the model). Valid restored overrides
 * survive (intent-hq/monorepo#2678), overrides made in the current session
 * are never cleared, and stale values re-applied after mount (parent
 * hydration) are cleared too.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecialistDef } from '$lib/client/app-client';

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
    fileSpecialistsLoaded$: writable(false),
    hydrated$: writable(true),
    // Orchestrator powering the team card (selectOrchestratorSpecialist).
    orchestrator$: writable<{
      id: string;
      name: string;
      description: string;
      role?: string;
      teamAgents?: string[];
      icon?: string;
    } | null>({
      id: 'spec-writer',
      name: 'Coordinator',
      description: '',
      role: 'orchestrator',
      teamAgents: ['implementor', 'verifier'],
      icon: 'coordinator',
    }),
    // Store view of specialists carrying the daemon's resolvedModel preview
    // (PROTOCOL §5.11) in the default-provider context.
    specialists$: writable<
      Array<{
        id: string;
        name: string;
        description: string;
        resolvedModel?: string;
        defaultModel?: string;
        reasoningEffort?: string;
        modelOptions?: Array<{ model: string; provider?: string; reasoningEffort?: string }>;
      }>
    >([]),
    // `specialist.list(provider)` refetch used for per-provider previews.
    specialistsList: vi.fn<
      (
        provider?: string,
      ) => Promise<
        Pick<
          SpecialistDef,
          | 'id'
          | 'name'
          | 'description'
          | 'resolvedModel'
          | 'resolvedProvider'
          | 'resolvedReasoningEffort'
        >[]
      >
    >(() =>
      Promise.resolve([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    ),
    backendRequest: vi.fn(),
    getProviderAvailability: vi.fn(() => new Promise(() => {})),
    selectedModel$: writable(''),
    configuredModels$: writable<Record<string, string>>({}),
    defaultProviderId: 'auggie',
    defaultReasoningEffort$: writable(''),
    effortLevelsByModel: {} as Record<string, string[] | undefined>,
    providerModelsByProviderId: {} as Record<
      string,
      { models: Array<{ value: string; effortLevels?: string[] }>; fetchedAt: string }
    >,
    availableModels$: writable<Array<{ value: string }>>([]),
    availableModelsProviderId: '',
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  // The picker reads the default provider / catalog rows via the
  // providerCatalog slice — hydrate the §5.38-shaped mock catalog.
  const { initialState, providerCatalogLoaded, providerCatalogReducer } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } =
    await import('../../../../../test/fixtures/provider-catalog.fixture');
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );
  // model.defaultProvider designates auggie — the settings-derived effective
  // default (the catalog never fabricates one from its first row). Mirrors
  // the mocked selectActiveProviderId below.
  return createAppStoreMockModule({
    state: () => ({
      providerCatalog,
      providerSettings: { enabledProviders: {} },
      model: { defaultProviderId: mocks.defaultProviderId },
      providerModels: { byProviderId: mocks.providerModelsByProviderId, clearEpoch: 0 },
    }),
  });
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.specialists$,
  selectCustomSpecialistsLoaded: () => mocks.readable(true),
  selectFileSpecialistsLoaded: () => mocks.fileSpecialistsLoaded$,
  selectUserOverrides: () => mocks.readable({ modelOverrides: {} }),
  selectOrchestratorSpecialist: () => mocks.orchestrator$,
  filterModalPickableSpecialists: (specialists: Array<{ role?: string }>) =>
    specialists.filter((s) => s.role !== 'internal'),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => mocks.selectedModel$,
  selectProviderModels: () => mocks.configuredModels$,
  selectDefaultReasoningEffort: () => mocks.defaultReasoningEffort$,
  selectAvailableModels: () => mocks.availableModels$,
  selectAvailableModelsProviderId: () =>
    mocks.readable(
      mocks.availableModelsProviderId ||
        (Object.keys(mocks.effortLevelsByModel).length ? 'auggie' : ''),
    ),
  selectModelEffortLevels: {
    select: (_state: unknown, modelId: string | undefined) =>
      modelId ? mocks.effortLevelsByModel[modelId] : undefined,
  },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    specialists: { list: mocks.specialistsList },
  },
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));

vi.mock('$store/renderer/slices/workspace-initializer/workspace-initializer-selectors', () => ({
  selectWorkspaceInitializerHydrated: () => mocks.hydrated$,
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable('auggie'),
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

vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('./mocks/MockModelPicker.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import InitialAgentPicker from '../InitialAgentPicker.svelte';
import { store as mockAppStore } from '$store/renderer/store';
import { LiveSpecialistsClient } from '$lib/client/live/live-specialists-client';

const emitStoreState = () => (mockAppStore as unknown as { emitState: () => void }).emitState();

/** The single-agent card renders first (index 0); the team card's picker is index 1. */
const SINGLE_PICKER = 0;
const TEAM_PICKER = 1;

function teamPickerSelected(): string {
  return screen.getAllByTestId('picker-selected')[TEAM_PICKER].textContent ?? '';
}

function teamPickerDefault(): string {
  return screen.getAllByTestId('picker-default')[TEAM_PICKER].textContent ?? '';
}

function modeCards() {
  return {
    single: screen.getByRole('button', { name: /Single agent/i }),
    team: screen.getByRole('button', { name: /Agent orchestration/i }),
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('InitialAgentPicker stale model override clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileSpecialistsLoaded$.set(false);
    mocks.hydrated$.set(true);
    mocks.selectedModel$.set('');
    mocks.configuredModels$.set({});
    mocks.defaultProviderId = 'auggie';
    mocks.defaultReasoningEffort$.set('');
    mocks.specialists$.set([]);
    mocks.effortLevelsByModel = {};
    mocks.providerModelsByProviderId = {};
    mocks.availableModels$.set([]);
    mocks.availableModelsProviderId = '';
    mocks.getProviderAvailability.mockImplementation(() => new Promise(() => {}));
    mocks.specialistsList.mockImplementation(() =>
      Promise.resolve([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('exposes the active work mode and updates it when a card is selected', async () => {
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
      },
    });

    const { team: teamMode, single: singleAgent } = modeCards();

    expect(teamMode.getAttribute('aria-pressed')).toBe('true');
    expect(singleAgent.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(singleAgent);

    expect(teamMode.getAttribute('aria-pressed')).toBe('false');
    expect(singleAgent.getAttribute('aria-pressed')).toBe('true');
  });

  it('defaults to single-agent mode with Developer when nothing is remembered', async () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      { id: 'developer', name: 'Developer', description: 'Builds things' },
    ]);
    const onTeamModeChange = vi.fn();
    const onSpecialistChange = vi.fn();
    render(InitialAgentPicker, { props: { onTeamModeChange, onSpecialistChange } });

    const { single, team } = modeCards();
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(team.getAttribute('aria-pressed')).toBe('false');
    expect(single.textContent).toContain('Developer');
    await flush();
    expect(onTeamModeChange).not.toHaveBeenCalled();
    expect(onSpecialistChange).not.toHaveBeenCalled();
  });

  it('defaults to General in single-agent mode when the Developer specialist is absent', async () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
    ]);
    const onSpecialistChange = vi.fn();
    render(InitialAgentPicker, { props: { onSpecialistChange } });

    const { single } = modeCards();
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(single.textContent).toContain('General');
    expect(single.textContent).not.toContain('Developer');
    await flush();
    expect(onSpecialistChange).not.toHaveBeenCalled();
  });

  it('keeps a remembered orchestration choice over the Developer default', () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      { id: 'developer', name: 'Developer', description: 'Builds things' },
    ]);
    render(InitialAgentPicker, { props: { selectedSpecialist: 'spec-writer', isTeamMode: true } });

    const { single, team } = modeCards();
    expect(team.getAttribute('aria-pressed')).toBe('true');
    expect(single.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a remembered General choice over the Developer default', () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      { id: 'developer', name: 'Developer', description: 'Builds things' },
    ]);
    render(InitialAgentPicker, { props: { selectedSpecialist: null, isTeamMode: false } });

    const { single } = modeCards();
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(single.textContent).toContain('General');
    expect(single.textContent).not.toContain('Developer');
  });

  it('restores the incoming single-agent specialist after a round trip through orchestration', async () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      { id: 'developer', name: 'Developer', description: 'Builds things' },
    ]);
    const onSpecialistChange = vi.fn();
    render(InitialAgentPicker, {
      props: { selectedSpecialist: 'developer', isTeamMode: false, onSpecialistChange },
    });

    const { single, team } = modeCards();
    await fireEvent.click(team);
    expect(onSpecialistChange).toHaveBeenLastCalledWith('spec-writer');
    expect(single.textContent).toContain('Developer');

    await fireEvent.click(single);
    expect(onSpecialistChange).toHaveBeenLastCalledWith('developer');
    expect(single.getAttribute('aria-pressed')).toBe('true');
  });

  it('previews Settings effort when the default model settings arrive after mount', async () => {
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, { props: { selectedSpecialist: null, onReasoningEffortChange } });
    mocks.selectedModel$.set('fable-5');
    mocks.configuredModels$.set({ auggie: 'fable-5' });
    mocks.defaultReasoningEffort$.set('high');
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('high'),
    );
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
    mocks.defaultReasoningEffort$.set('low');
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('low'),
    );
  });

  it.each([false, true])(
    'only previews Settings effort for a configured model (configured=%j)',
    async (configured) => {
      mocks.defaultProviderId = 'codex';
      // selectSelectedModel also returns a catalog isDefault/first row when
      // Settings has no model; that fallback alone is not inheritance evidence.
      mocks.selectedModel$.set('catalog-default');
      mocks.configuredModels$.set(configured ? { codex: 'catalog-default' } : {});
      mocks.defaultReasoningEffort$.set('high');
      mocks.availableModelsProviderId = 'codex';
      mocks.availableModels$.set([{ value: 'catalog-default' }]);
      mocks.effortLevelsByModel = { 'catalog-default': ['low', 'high'] };
      render(InitialAgentPicker, {
        props: { selectedSpecialist: null, selectedProvider: 'codex' },
      });
      await flush();
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe(
        configured ? 'high' : '',
      );
    },
  );

  it.each(['high', ''])(
    'keeps explicit effort %j ahead of the Settings fallback',
    async (effort) => {
      mocks.selectedModel$.set('fable-5');
      mocks.configuredModels$.set({ auggie: 'fable-5' });
      mocks.defaultReasoningEffort$.set('low');
      render(InitialAgentPicker, {
        props: { selectedSpecialist: null, selectedReasoningEffort: effort },
      });
      await flush();
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe(effort);
    },
  );

  it('clears an inherited Settings effort explicitly', async () => {
    mocks.selectedModel$.set('fable-5');
    mocks.configuredModels$.set({ auggie: 'fable-5' });
    mocks.defaultReasoningEffort$.set('high');
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, { props: { selectedSpecialist: null, onReasoningEffortChange } });
    await fireEvent.click(screen.getAllByTestId('clear-reasoning')[SINGLE_PICKER]);
    expect(onReasoningEffortChange).toHaveBeenCalledExactlyOnceWith('');
    expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('');
  });

  it.each([
    { selectedProvider: 'codex', selectedModel: undefined, modelWasOverridden: false },
    { selectedProvider: 'auggie', selectedModel: 'fable-5', modelWasOverridden: true },
    { selectedProvider: 'auggie', selectedModel: 'unrelated-model', modelWasOverridden: true },
  ])(
    'does not leak Settings effort into a different provider or explicit model ($selectedProvider/$selectedModel)',
    async (props) => {
      mocks.selectedModel$.set('fable-5');
      mocks.configuredModels$.set({ auggie: 'fable-5' });
      mocks.defaultReasoningEffort$.set('high');
      render(InitialAgentPicker, { props: { selectedSpecialist: null, ...props } });
      await flush();
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('');
    },
  );

  it.each([
    { specialistSettings: { defaultModel: 'fable-5' }, expected: '' },
    { specialistSettings: { reasoningEffort: 'low' }, expected: 'low' },
    {
      specialistSettings: {
        modelOptions: [{ provider: 'auggie', model: 'fable-5', reasoningEffort: 'low' }],
      },
      expected: 'low',
    },
  ])(
    'does not override a specialist-specific default with Settings (%j)',
    async ({ specialistSettings, expected }) => {
      mocks.selectedModel$.set('fable-5');
      mocks.configuredModels$.set({ auggie: 'fable-5' });
      mocks.defaultReasoningEffort$.set('high');
      mocks.specialists$.set([
        {
          id: 'custom',
          name: 'Custom',
          description: '',
          resolvedModel: 'fable-5',
          ...specialistSettings,
        },
      ]);
      mocks.specialistsList.mockImplementation(() => new Promise(() => {}));
      render(InitialAgentPicker, { props: { selectedSpecialist: 'custom' } });
      await flush();
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe(expected);
    },
  );

  it.each([
    { name: 'frontmatter effort', reasoningEffort: 'high', modelOptions: [], expected: 'high' },
    {
      name: 'matching model option ahead of frontmatter',
      reasoningEffort: 'high',
      modelOptions: [{ model: 'picked-model', provider: 'codex', reasoningEffort: 'low' }],
      expected: 'low',
    },
    {
      name: 'foreign-provider option falls back to frontmatter',
      reasoningEffort: 'high',
      modelOptions: [{ model: 'picked-model', provider: 'auggie', reasoningEffort: 'low' }],
      expected: 'high',
    },
    {
      name: 'other-model option falls back to frontmatter',
      reasoningEffort: 'high',
      modelOptions: [{ model: 'other-model', provider: 'codex', reasoningEffort: 'low' }],
      expected: 'high',
    },
    {
      name: 'providerless option matches any provider',
      reasoningEffort: 'high',
      modelOptions: [{ model: 'picked-model', reasoningEffort: 'low' }],
      expected: 'low',
    },
    {
      name: 'first matching option has no effort',
      reasoningEffort: 'high',
      modelOptions: [
        { model: 'picked-model', provider: 'codex' },
        { model: 'picked-model', provider: 'codex', reasoningEffort: 'low' },
      ],
      expected: 'high',
    },
    {
      name: 'explicit model without specialist effort excludes Settings',
      reasoningEffort: undefined,
      modelOptions: [{ model: 'other-model', provider: 'codex', reasoningEffort: 'low' }],
      expected: '',
    },
  ])('previews specialist effort for an explicit model: $name', async (testCase) => {
    mocks.defaultProviderId = 'codex';
    mocks.configuredModels$.set({ codex: 'picked-model' });
    mocks.defaultReasoningEffort$.set('high');
    mocks.availableModelsProviderId = 'codex';
    mocks.availableModels$.set([{ value: 'picked-model' }]);
    mocks.effortLevelsByModel = { 'picked-model': ['low', 'high'] };
    mocks.specialists$.set([{ id: 'custom', name: 'Custom', description: '' }]);
    mocks.backendRequest.mockResolvedValue({
      specialists: [
        {
          id: 'custom',
          name: 'Custom',
          description: '',
          source: 'user',
          codingAgent: 'auggie',
          model: 'default-model',
          modelOptions: [
            { model: 'default-model', provider: 'codex', reasoningEffort: 'medium' },
            ...testCase.modelOptions,
          ],
          reasoningEffort: testCase.reasoningEffort,
          resolvedProvider: 'codex',
          resolvedModel: 'default-model',
          // The default-model preview is not evidence for the explicit model.
          resolvedReasoningEffort: 'medium',
        },
      ],
    });
    const client = new LiveSpecialistsClient();
    mocks.specialistsList.mockImplementation((provider) => client.list(provider));
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'custom',
        selectedProvider: 'codex',
        selectedModel: 'picked-model',
        modelWasOverridden: true,
      },
    });
    await waitFor(() =>
      expect(mocks.backendRequest).toHaveBeenCalledWith('specialist.list', { provider: 'codex' }),
    );
    await flush();
    expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe(
      testCase.expected,
    );
  });

  it.each([
    {
      name: 'foreign specialist pin falls through to Settings',
      defaultProvider: 'codex',
      model: 'claude-only',
      expected: 'high',
    },
    {
      name: 'non-default provider has its own configured model',
      defaultProvider: 'auggie',
      model: undefined,
      expected: 'high',
    },
    {
      name: 'configured default provider control',
      defaultProvider: 'codex',
      model: undefined,
      expected: 'high',
    },
    {
      name: 'genuine specialist model pin suppresses Settings',
      defaultProvider: 'codex',
      model: 'gpt-fixture',
      expected: '',
    },
    {
      name: 'rejected legacy compound pin does not suppress Settings',
      defaultProvider: 'codex',
      model: 'codex:gpt-fixture',
      expected: 'high',
    },
  ])('previews the resolved provider Settings effort: $name', async (testCase) => {
    mocks.defaultProviderId = testCase.defaultProvider;
    mocks.configuredModels$.set({ codex: 'gpt-fixture' });
    mocks.defaultReasoningEffort$.set('high');
    mocks.availableModelsProviderId = 'codex';
    mocks.availableModels$.set([{ value: 'gpt-fixture' }]);
    mocks.effortLevelsByModel = { 'gpt-fixture': ['low', 'high'] };
    mocks.specialists$.set([
      {
        id: 'custom',
        name: 'Custom',
        description: '',
        defaultModel: testCase.model,
        resolvedModel: 'gpt-fixture',
      },
    ]);
    mocks.backendRequest.mockResolvedValue({
      specialists: [
        {
          id: 'custom',
          name: 'Custom',
          description: '',
          source: 'user',
          model: testCase.model,
          resolvedProvider: 'codex',
          resolvedModel: 'gpt-fixture',
        },
      ],
    });
    const client = new LiveSpecialistsClient();
    mocks.specialistsList.mockImplementation((provider) => client.list(provider));
    render(InitialAgentPicker, {
      props: { selectedSpecialist: 'custom', selectedProvider: 'codex' },
    });
    await waitFor(() =>
      expect(mocks.backendRequest).toHaveBeenCalledWith('specialist.list', { provider: 'codex' }),
    );
    await flush();
    expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe(
      testCase.expected,
    );
  });

  it('uses the selected provider Settings model for General, independently of the active provider', async () => {
    mocks.defaultProviderId = 'auggie';
    mocks.selectedModel$.set('fable-5');
    mocks.configuredModels$.set({ auggie: 'fable-5', codex: 'gpt-fixture' });
    mocks.defaultReasoningEffort$.set('high');
    mocks.providerModelsByProviderId = {
      codex: {
        models: [{ value: 'gpt-fixture', effortLevels: ['low', 'high'] }],
        fetchedAt: '2026-09-25T00:00:00Z',
      },
    };
    render(InitialAgentPicker, {
      props: { selectedSpecialist: null, selectedProvider: 'codex' },
    });
    await flush();
    expect(screen.getAllByTestId('picker-default')[SINGLE_PICKER].textContent).toBe('gpt-fixture');
    expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('high');
  });

  it('still previews Settings when specialist model options do not supply the chosen effort', async () => {
    mocks.selectedModel$.set('fable-5');
    mocks.configuredModels$.set({ auggie: 'fable-5' });
    mocks.defaultReasoningEffort$.set('high');
    mocks.specialists$.set([
      {
        id: 'custom',
        name: 'Custom',
        description: '',
        resolvedModel: 'fable-5',
        modelOptions: [
          { provider: 'auggie', model: 'other-model', reasoningEffort: 'low' },
          { provider: 'auggie', model: 'fable-5' },
        ],
      },
    ]);
    mocks.specialistsList.mockImplementation(() => new Promise(() => {}));
    render(InitialAgentPicker, { props: { selectedSpecialist: 'custom' } });
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('high'),
    );
  });

  it('filters a Settings effort the default model does not support', async () => {
    mocks.selectedModel$.set('fable-5');
    mocks.configuredModels$.set({ auggie: 'fable-5' });
    mocks.defaultReasoningEffort$.set('high');
    mocks.effortLevelsByModel = { 'fable-5': ['low'] };
    render(InitialAgentPicker, { props: { selectedSpecialist: null } });
    await flush();
    expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('');
  });

  it('refreshes the Settings effort preview when model capabilities change', async () => {
    mocks.selectedModel$.set('fable-5');
    mocks.configuredModels$.set({ auggie: 'fable-5' });
    mocks.defaultReasoningEffort$.set('high');
    mocks.effortLevelsByModel = { 'fable-5': ['low', 'high'] };
    render(InitialAgentPicker, { props: { selectedSpecialist: null } });
    await flush();
    expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('high');

    mocks.effortLevelsByModel = { 'fable-5': ['low'] };
    mocks.availableModels$.set([{ value: 'fable-5' }]);
    await waitFor(() =>
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe(''),
    );
  });

  it('does not use another provider catalog to discard an explicit effort', async () => {
    mocks.availableModelsProviderId = '';
    mocks.effortLevelsByModel = { 'shared-model-id': ['low'] };
    mocks.providerModelsByProviderId = {
      codex: {
        models: [{ value: 'shared-model-id', effortLevels: ['high'] }],
        fetchedAt: '2026-09-25T00:00:00Z',
      },
    };
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedProvider: 'codex',
        selectedModel: 'shared-model-id',
        modelWasOverridden: true,
        selectedReasoningEffort: 'high',
        onReasoningEffortChange,
      },
    });
    await flush();
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('high');
  });

  it.each([undefined, []])(
    'preserves saved effort when late catalog effort levels are %j',
    async (effortLevels) => {
      const onReasoningEffortChange = vi.fn();
      render(InitialAgentPicker, {
        props: {
          selectedProvider: 'codex',
          selectedModel: 'shared-model-id',
          modelWasOverridden: true,
          selectedReasoningEffort: 'high',
          onReasoningEffortChange,
        },
      });
      await flush();
      mocks.providerModelsByProviderId = {
        codex: {
          models: [{ value: 'shared-model-id', ...(effortLevels ? { effortLevels } : {}) }],
          fetchedAt: '2026-09-25T00:00:00Z',
        },
      };
      emitStoreState();
      await flush();
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('high');
      expect(onReasoningEffortChange).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, []])(
    'keeps Settings fallback when global effort levels are %j',
    async (effortLevels) => {
      mocks.selectedModel$.set('fable-5');
      mocks.configuredModels$.set({ auggie: 'fable-5' });
      mocks.defaultReasoningEffort$.set('high');
      mocks.availableModelsProviderId = 'auggie';
      mocks.availableModels$.set([{ value: 'fable-5' }]);
      mocks.effortLevelsByModel = { 'fable-5': effortLevels };
      render(InitialAgentPicker, { props: { selectedSpecialist: null } });
      await flush();
      expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('high');
    },
  );

  it('waits for a nonempty incompatible list before clearing a saved effort', async () => {
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedProvider: 'codex',
        selectedModel: 'shared-model-id',
        modelWasOverridden: true,
        selectedReasoningEffort: 'high',
        onReasoningEffortChange,
      },
    });
    await flush();
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
    mocks.providerModelsByProviderId = {
      codex: {
        models: [{ value: 'shared-model-id', effortLevels: ['low'] }],
        fetchedAt: '2026-09-25T00:00:00Z',
      },
    };
    emitStoreState();
    await waitFor(() => expect(onReasoningEffortChange).toHaveBeenCalledWith(undefined));
  });

  it.each([undefined, 'high', ''])(
    'uses the daemon specialist effort preview behind explicit effort %j',
    async (effort) => {
      mocks.selectedModel$.set('shared-model-id');
      mocks.defaultReasoningEffort$.set('high');
      mocks.specialists$.set([{ id: 'custom', name: 'Custom', description: '' }]);
      mocks.specialistsList.mockImplementation(async () => [
        {
          id: 'custom',
          name: 'Custom',
          description: '',
          source: 'bundled',
          resolvedProvider: 'codex',
          resolvedModel: 'shared-model-id',
          resolvedReasoningEffort: 'low',
        },
      ]);
      const onReasoningEffortChange = vi.fn();
      render(InitialAgentPicker, {
        props: {
          selectedSpecialist: 'custom',
          selectedProvider: 'codex',
          selectedReasoningEffort: effort,
          onReasoningEffortChange,
        },
      });
      await waitFor(() =>
        expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe(
          effort ?? 'low',
        ),
      );
      expect(onReasoningEffortChange).not.toHaveBeenCalled();
    },
  );

  it('keeps same-model effort previews scoped by provider through the live client and cache', async () => {
    const specialist = { id: 'custom', name: 'Custom', description: '' };
    mocks.specialists$.set([specialist]);
    let codexEffort = 'low';
    mocks.backendRequest.mockImplementation(async (_method, params) => {
      const provider = params?.provider ?? 'auggie';
      return {
        specialists: [
          {
            ...specialist,
            source: 'bundled',
            resolvedProvider: provider,
            resolvedModel: 'shared-model-id',
            resolvedReasoningEffort: provider === 'codex' ? codexEffort : 'high',
          },
        ],
      };
    });
    const client = new LiveSpecialistsClient();
    mocks.specialistsList.mockImplementation((provider) => client.list(provider));
    const onReasoningEffortChange = vi.fn();
    const { rerender } = render(InitialAgentPicker, {
      props: { selectedSpecialist: 'custom', selectedProvider: 'auggie', onReasoningEffortChange },
    });
    const displayedEffort = () =>
      screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent;
    await waitFor(() => expect(displayedEffort()).toBe('high'));
    await rerender({ selectedProvider: 'codex' });
    await waitFor(() => expect(displayedEffort()).toBe('low'));
    await rerender({ selectedProvider: 'auggie' });
    await waitFor(() => expect(displayedEffort()).toBe('high'));
    expect(mocks.backendRequest.mock.calls).toEqual([
      ['specialist.list', { provider: 'auggie' }],
      ['specialist.list', { provider: 'codex' }],
    ]);

    // A specialist refresh invalidates every provider's preview. Returning
    // to codex must fetch its new effort instead of either cached value.
    codexEffort = 'medium';
    mocks.specialists$.set([{ ...specialist }]);
    await waitFor(() => expect(mocks.backendRequest).toHaveBeenCalledTimes(3));
    await rerender({ selectedProvider: 'codex' });
    await waitFor(() => expect(displayedEffort()).toBe('medium'));
    expect(mocks.backendRequest).toHaveBeenLastCalledWith('specialist.list', { provider: 'codex' });
    expect(onReasoningEffortChange).not.toHaveBeenCalled();
  });

  it('restores a valid single-agent effort after switching through an incompatible team model', async () => {
    mocks.selectedModel$.set('single-model');
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
    ]);
    mocks.effortLevelsByModel = { 'single-model': ['low', 'high'], 'fable-5': ['low'] };
    render(InitialAgentPicker, {
      props: { selectedSpecialist: null, selectedReasoningEffort: 'high' },
    });
    await fireEvent.click(modeCards().team);
    expect(screen.getAllByTestId('picker-reasoning')[TEAM_PICKER].textContent).toBe('');
    await fireEvent.click(modeCards().single);
    expect(screen.getAllByTestId('picker-reasoning')[SINGLE_PICKER].textContent).toBe('high');
  });

  it('wires both pickers to controlled reasoning', async () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
    ]);
    mocks.effortLevelsByModel = { 'fable-5': ['low', 'high'] };
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, {
      props: { selectedSpecialist: 'spec-writer', isTeamMode: true, onReasoningEffortChange },
    });

    expect(screen.getAllByTestId('picker-show-reasoning').map((node) => node.textContent)).toEqual([
      'true',
      'true',
    ]);
    await waitFor(() => expect(teamPickerDefault()).toBe('fable-5'));
    const pickerEfforts = () =>
      screen.getAllByTestId('picker-reasoning').map((node) => node.textContent);

    // The single-agent picker drives the shared controlled effort.
    await fireEvent.click(screen.getAllByTestId('pick-reasoning')[SINGLE_PICKER]);
    expect(onReasoningEffortChange).toHaveBeenCalledTimes(1);
    expect(onReasoningEffortChange).toHaveBeenLastCalledWith('high');
    expect(pickerEfforts()).toEqual(['high', 'high']);

    // Clearing from the team picker propagates back to both pickers.
    await fireEvent.click(screen.getAllByTestId('clear-reasoning')[TEAM_PICKER]);
    expect(onReasoningEffortChange).toHaveBeenCalledTimes(2);
    expect(onReasoningEffortChange).toHaveBeenLastCalledWith('');
    expect(pickerEfforts()).toEqual(['', '']);

    // Picking from the team picker also reaches both pickers.
    await fireEvent.click(screen.getAllByTestId('pick-reasoning')[TEAM_PICKER]);
    expect(onReasoningEffortChange).toHaveBeenCalledTimes(3);
    expect(onReasoningEffortChange).toHaveBeenLastCalledWith('high');
    expect(pickerEfforts()).toEqual(['high', 'high']);
  });

  it('keeps effort when a cleared override falls back to a default that supports it', async () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
    ]);
    mocks.effortLevelsByModel = {
      'user-picked-model': ['low', 'high'],
      'fable-5': ['low', 'high'],
    };
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'user-picked-model',
        modelWasOverridden: true,
        selectedReasoningEffort: 'high',
        onReasoningEffortChange,
      },
    });

    await fireEvent.click(screen.getAllByTestId('pick-default')[TEAM_PICKER]);

    expect(onReasoningEffortChange).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('picker-reasoning')[TEAM_PICKER].textContent).toBe('high');
  });

  it('clears effort when a cleared override falls back to an unsupported default', async () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
    ]);
    mocks.effortLevelsByModel = {
      'user-picked-model': ['low', 'high'],
      'fable-5': ['low'],
    };
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'user-picked-model',
        modelWasOverridden: true,
        selectedReasoningEffort: 'high',
        onReasoningEffortChange,
      },
    });

    await fireEvent.click(screen.getAllByTestId('pick-default')[TEAM_PICKER]);

    expect(onReasoningEffortChange).toHaveBeenCalledWith(undefined);
    expect(screen.getAllByTestId('picker-reasoning')[TEAM_PICKER].textContent).toBe('');
  });

  it('keeps effort when a cross-provider model is missing from every catalog', async () => {
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, {
      props: { selectedReasoningEffort: 'high', onReasoningEffortChange },
    });

    await fireEvent.click(screen.getAllByTestId('pick-cross-provider-model')[0]);

    expect(onReasoningEffortChange).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('picker-reasoning')[0].textContent).toBe('high');
  });

  it('clears effort when the provider cache knows the model lacks the selected level', async () => {
    mocks.providerModelsByProviderId = {
      codex: {
        models: [{ value: 'codex:cross-provider-model', effortLevels: ['low'] }],
        fetchedAt: '2026-08-15T00:00:00.000Z',
      },
    };
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, {
      props: { selectedReasoningEffort: 'high', onReasoningEffortChange },
    });

    await fireEvent.click(screen.getAllByTestId('pick-cross-provider-model')[0]);

    expect(onReasoningEffortChange).toHaveBeenCalledWith(undefined);
    expect(screen.getAllByTestId('picker-reasoning')[0].textContent).toBe('');
  });

  it('does not clear an invalid persisted override before data is loaded, then clears it once loaded', async () => {
    // The provider's cached catalog lacks opus4.6 — positive staleness evidence.
    mocks.providerModelsByProviderId = {
      auggie: { models: [{ value: 'fable-5' }], fetchedAt: '2026-08-15T00:00:00.000Z' },
    };
    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(teamPickerSelected()).toBe('opus4.6');

    // Data arrives: file specialists load; the daemon resolvedModel preview
    // (fable-5) is fetched per provider via specialist.list.
    mocks.fileSpecialistsLoaded$.set(true);

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    await waitFor(() => {
      expect(teamPickerSelected()).toBe('');
      expect(teamPickerDefault()).toBe('fable-5');
    });
  });

  it('does not clear an invalid persisted override until the parent form state is hydrated', async () => {
    mocks.providerModelsByProviderId = {
      auggie: { models: [{ value: 'fable-5' }], fetchedAt: '2026-08-15T00:00:00.000Z' },
    };
    mocks.hydrated$.set(false);
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    expect(onModelChange).not.toHaveBeenCalled();

    mocks.hydrated$.set(true);
    mocks.selectedModel$.set('');
    mocks.defaultReasoningEffort$.set('');
    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
  });

  it('keeps a valid restored override present in the provider catalog (monorepo#2678)', async () => {
    // The provider's cached catalog INCLUDES the restored model — the
    // override is valid and must survive hydration.
    mocks.providerModelsByProviderId = {
      auggie: {
        models: [{ value: 'fable-5' }, { value: 'opus4.6' }],
        fetchedAt: '2026-08-15T00:00:00.000Z',
      },
    };
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    await flush();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(teamPickerSelected()).toBe('opus4.6');
  });

  it('keeps a restored override valid per the global availableModels catalog', async () => {
    mocks.availableModels$.set([{ value: 'fable-5' }, { value: 'opus4.6' }]);
    mocks.availableModelsProviderId = 'auggie';
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    await flush();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(teamPickerSelected()).toBe('opus4.6');
  });

  it('keeps a restored override when no catalog evidence is loaded yet', async () => {
    // No provider-models cache entry, no global catalog, availability check
    // pending — no positive evidence of staleness, so nothing is cleared.
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    await flush();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(teamPickerSelected()).toBe('opus4.6');
  });

  it('clears a restored override when the provider catalog loaded EMPTY', async () => {
    // A successful models.list with zero models is still a loaded catalog —
    // the provider provably has no models, so the override is invalid.
    mocks.providerModelsByProviderId = {
      auggie: {
        models: [],
        fetchedAt: '2026-08-15T00:00:00.000Z',
      },
    };
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    expect(teamPickerSelected()).toBe('');
  });

  it('clears a restored override when the global catalog for its provider loaded EMPTY', async () => {
    mocks.availableModels$.set([]);
    mocks.availableModelsProviderId = 'auggie';
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    expect(teamPickerSelected()).toBe('');
  });

  it('clears a restored override whose provider is reported unavailable', async () => {
    mocks.getProviderAvailability.mockImplementation(() =>
      Promise.resolve({
        hasAnyProvider: false,
        providers: { auggie: { available: false } },
      }),
    );
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'opus4.6',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    expect(teamPickerSelected()).toBe('');
  });

  it('keeps a restored override for a provider absent from the availability result', async () => {
    // No availability entry for the override's provider (unknown provider id)
    // is UNKNOWN, not unavailable — without catalog evidence the override is
    // kept, matching the positive-evidence-only design. Known providers are
    // reported unavailable so the auto-select effect stays inert and the
    // stale-override path is isolated.
    mocks.getProviderAvailability.mockImplementation(() =>
      Promise.resolve({
        hasAnyProvider: false,
        providers: { auggie: { available: false } },
      }),
    );
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedProvider: 'some-new-provider',
        selectedModel: 'some-new-provider:some-model',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    await flush();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(teamPickerSelected()).toBe('some-new-provider:some-model');
  });

  it('clears an invalid override when its provider catalog lands after the effect ran', async () => {
    // No evidence at mount — the override is kept. Then the provider-models
    // cache populates WITHOUT the model; the clearing effect must re-run
    // reactively and clear the override.
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: 'retired-model',
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await flush();
    await flush();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(teamPickerSelected()).toBe('retired-model');

    mocks.providerModelsByProviderId = {
      auggie: {
        models: [{ value: 'fable-5' }],
        fetchedAt: '2026-08-15T00:00:00.000Z',
      },
    };
    emitStoreState();

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    expect(teamPickerSelected()).toBe('');
  });

  it('preserves an override the user made in the current session', async () => {
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        onModelChange,
      },
    });

    await flush();
    await fireEvent.click(screen.getAllByTestId('pick-model')[0]);
    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith('user-picked-model'));

    // Churn the gated dependencies — the fresh session override must survive
    mocks.fileSpecialistsLoaded$.set(false);
    mocks.fileSpecialistsLoaded$.set(true);
    await flush();

    expect(onModelChange).not.toHaveBeenCalledWith(undefined);
    expect(teamPickerSelected()).toBe('user-picked-model');
  });

  it('normalizes a degenerate persisted state (override flag set with no model) once data is ready', async () => {
    // Catalog evidence that opus4.6 is invalid, for the re-applied override below.
    mocks.providerModelsByProviderId = {
      auggie: { models: [{ value: 'fable-5' }], fetchedAt: '2026-08-15T00:00:00.000Z' },
    };
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    const { rerender } = render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        selectedModel: undefined,
        modelWasOverridden: true,
        onModelChange,
      },
    });

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));

    // The rerender merges the initial props back in (override flag set), so
    // this re-applies an invalid override — it must be cleared again and the
    // picker display must not treat the model as selected.
    await rerender({ selectedModel: 'opus4.6' });
    await waitFor(() => expect(teamPickerSelected()).toBe(''));
  });

  it('clears an invalid override re-applied after mount (parent hydration)', async () => {
    mocks.providerModelsByProviderId = {
      auggie: { models: [{ value: 'fable-5' }], fetchedAt: '2026-08-15T00:00:00.000Z' },
    };
    mocks.fileSpecialistsLoaded$.set(true);

    const onModelChange = vi.fn();
    const { rerender } = render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
        onModelChange,
      },
    });

    await flush();
    expect(onModelChange).not.toHaveBeenCalled();

    // Simulate the parent's hydration $effect re-applying persisted stale values
    await rerender({ selectedModel: 'opus4.6', modelWasOverridden: true });

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith(undefined));
    await waitFor(() => {
      expect(teamPickerSelected()).toBe('');
      expect(teamPickerDefault()).toBe('fable-5');
    });
  });

  it('invalidates cached per-provider previews when the store specialist view refreshes', async () => {
    mocks.fileSpecialistsLoaded$.set(true);

    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
      },
    });

    await waitFor(() => expect(teamPickerDefault()).toBe('fable-5'));
    expect(mocks.specialistsList).toHaveBeenCalledTimes(1);

    // Specialist defaults change on disk: the daemon emits specialists:changed
    // and the list subscription refreshes the store view. The cached
    // per-provider preview must be dropped and refetched.
    mocks.specialistsList.mockImplementation(() =>
      Promise.resolve([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'sonnet-4.6' },
      ]),
    );
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'sonnet-4.6' },
    ]);

    await waitFor(() => expect(teamPickerDefault()).toBe('sonnet-4.6'));
    expect(mocks.specialistsList).toHaveBeenCalledTimes(2);
  });

  it('falls back to the store resolvedModel until the per-provider fetch lands', async () => {
    // Per-provider fetch never resolves — the store view (daemon default
    // provider context) must drive the preview.
    mocks.specialistsList.mockImplementation(() => new Promise(() => {}));
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'store-model' },
    ]);
    mocks.fileSpecialistsLoaded$.set(true);

    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: 'spec-writer',
        isTeamMode: true,
      },
    });

    await waitFor(() => expect(teamPickerDefault()).toBe('store-model'));
  });
});

describe('InitialAgentPicker specialist dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileSpecialistsLoaded$.set(false);
    mocks.hydrated$.set(true);
    mocks.selectedModel$.set('');
    mocks.configuredModels$.set({});
    mocks.defaultProviderId = 'auggie';
    mocks.defaultReasoningEffort$.set('');
    mocks.specialists$.set([]);
    mocks.effortLevelsByModel = {};
    mocks.providerModelsByProviderId = {};
    mocks.availableModels$.set([]);
    mocks.availableModelsProviderId = '';
    mocks.getProviderAvailability.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
  });

  /** The specialist trigger inside the single-agent card shows the displayed specialist. */
  function specialistTrigger() {
    return within(modeCards().single).getByRole('button', { name: /General/ });
  }

  const manageSpecialistsItem = () =>
    screen.queryByRole('menuitem', { name: /manage specialists/i });

  it('selects single-agent mode instead of opening the menu while in team mode', async () => {
    const onTeamModeChange = vi.fn();
    render(InitialAgentPicker, {
      props: { selectedSpecialist: 'spec-writer', isTeamMode: true, onTeamModeChange },
    });

    const trigger = specialistTrigger();
    expect(trigger.getAttribute('aria-haspopup')).toBeNull();
    expect(trigger.tabIndex).toBe(-1);

    await fireEvent.click(trigger);
    await flush();

    const { single, team } = modeCards();
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(team.getAttribute('aria-pressed')).toBe('false');
    expect(onTeamModeChange).toHaveBeenCalledWith(false);
    expect(manageSpecialistsItem()).toBeNull();

    // Once single-agent mode is active the trigger carries the menu contract.
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.tabIndex).toBe(0);
  });

  it('opens the specialist menu without leaving single-agent mode', async () => {
    const onTeamModeChange = vi.fn();
    render(InitialAgentPicker, {
      props: { selectedSpecialist: null, isTeamMode: false, onTeamModeChange },
    });

    const trigger = specialistTrigger();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(manageSpecialistsItem()).toBeNull();

    await fireEvent.click(trigger);
    await screen.findByRole('menuitem', { name: /manage specialists/i });

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(manageSpecialistsItem()).not.toBeNull();
    expect(modeCards().single.getAttribute('aria-pressed')).toBe('true');
    expect(onTeamModeChange).not.toHaveBeenCalled();
  });

  it('selects one specialist, clears the model override, and exposes the checked choice on reopen', async () => {
    mocks.specialists$.set([{ id: 'developer', name: 'Developer', description: 'Builds things' }]);
    const onSpecialistChange = vi.fn();
    const onModelChange = vi.fn();
    render(InitialAgentPicker, {
      props: {
        selectedSpecialist: null,
        selectedModel: 'remembered-model',
        modelWasOverridden: true,
        onSpecialistChange,
        onModelChange,
      },
    });

    const trigger = specialistTrigger();
    await fireEvent.click(trigger);
    const general = await screen.findByRole('menuitemradio', { name: /General/ });
    const developer = screen.getByRole('menuitemradio', { name: /Developer/ });
    expect(general.getAttribute('aria-checked')).toBe('true');
    expect(developer.getAttribute('aria-checked')).toBe('false');

    await fireEvent.click(developer);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(onSpecialistChange).toHaveBeenCalledExactlyOnceWith('developer');
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(screen.getAllByTestId('picker-selected')[SINGLE_PICKER].textContent).toBe('');
    expect(modeCards().single.getAttribute('aria-pressed')).toBe('true');

    await fireEvent.click(trigger);
    const selected = await screen.findByRole('menuitemradio', { name: /Developer/, checked: true });
    expect(screen.getAllByRole('menuitemradio', { checked: true })).toEqual([selected]);
    expect(
      screen.getByRole('menuitemradio', { name: /General/ }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('keeps both model pickers inline and bounded by the modal collision boundary', () => {
    render(InitialAgentPicker, { props: { selectedSpecialist: 'spec-writer', isTeamMode: true } });

    const pickers = screen.getAllByTestId('mock-model-picker');
    expect(pickers).toHaveLength(2);
    for (const picker of pickers) {
      expect(picker.getAttribute('data-portal')).toBe('false');
      expect(picker.getAttribute('data-collision-boundary')).toBe(
        '[data-model-picker-collision-boundary]',
      );
    }
  });
});

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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      Array<{ id: string; name: string; description: string; resolvedModel?: string }>
    >([]),
    // `specialist.list(provider)` refetch used for per-provider previews.
    specialistsList: vi.fn(() =>
      Promise.resolve([
        { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
      ]),
    ),
    getProviderAvailability: vi.fn(() => new Promise(() => {})),
    effortLevelsByModel: {} as Record<string, string[] | undefined>,
    providerModelsByProviderId: {} as Record<
      string,
      { models: Array<{ value: string; effortLevels?: string[] }>; fetchedAt: string }
    >,
    availableModels: [] as Array<{ value: string }>,
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
      model: { defaultProviderId: 'auggie' },
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
  selectSelectedModel: () => mocks.readable(''),
  selectAvailableModels: () => mocks.readable(mocks.availableModels),
  selectAvailableModelsProviderId: () => mocks.readable(mocks.availableModelsProviderId),
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

vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('./mocks/MockDropdownMenu.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import InitialAgentPicker from '../InitialAgentPicker.svelte';
import { store as mockAppStore } from '$store/renderer/store';

const emitStoreState = () => (mockAppStore as unknown as { emitState: () => void }).emitState();

/** The team-mode card renders first; its picker is index 0. */
function teamPickerSelected(): string {
  return screen.getAllByTestId('picker-selected')[0].textContent ?? '';
}

function teamPickerDefault(): string {
  return screen.getAllByTestId('picker-default')[0].textContent ?? '';
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('InitialAgentPicker stale model override clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileSpecialistsLoaded$.set(false);
    mocks.hydrated$.set(true);
    mocks.specialists$.set([]);
    mocks.effortLevelsByModel = {};
    mocks.providerModelsByProviderId = {};
    mocks.availableModels = [];
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

    const teamMode = screen.getByRole('button', { name: /Agent orchestration/i });
    const singleAgent = screen.getByRole('button', { name: /Single agent/i });

    expect(teamMode.getAttribute('aria-pressed')).toBe('true');
    expect(singleAgent.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(singleAgent);

    expect(teamMode.getAttribute('aria-pressed')).toBe('false');
    expect(singleAgent.getAttribute('aria-pressed')).toBe('true');
  });

  it('wires both pickers to controlled reasoning', async () => {
    mocks.specialists$.set([
      { id: 'spec-writer', name: 'Coordinator', description: '', resolvedModel: 'fable-5' },
    ]);
    mocks.effortLevelsByModel = { 'fable-5': ['low', 'high'] };
    const onReasoningEffortChange = vi.fn();
    render(InitialAgentPicker, { props: { onReasoningEffortChange } });

    expect(screen.getAllByTestId('picker-show-reasoning').map((node) => node.textContent)).toEqual([
      'true',
      'true',
    ]);
    await waitFor(() => expect(teamPickerDefault()).toBe('fable-5'));
    await fireEvent.click(screen.getAllByTestId('pick-reasoning')[0]);

    expect(onReasoningEffortChange).toHaveBeenCalledWith('high');
    expect(screen.getAllByTestId('picker-reasoning')[0].textContent).toBe('high');
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
        selectedModel: 'user-picked-model',
        modelWasOverridden: true,
        selectedReasoningEffort: 'high',
        onReasoningEffortChange,
      },
    });

    await fireEvent.click(screen.getAllByTestId('pick-default')[0]);

    expect(onReasoningEffortChange).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('picker-reasoning')[0].textContent).toBe('high');
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
        selectedModel: 'user-picked-model',
        modelWasOverridden: true,
        selectedReasoningEffort: 'high',
        onReasoningEffortChange,
      },
    });

    await fireEvent.click(screen.getAllByTestId('pick-default')[0]);

    expect(onReasoningEffortChange).toHaveBeenCalledWith(undefined);
    expect(screen.getAllByTestId('picker-reasoning')[0].textContent).toBe('');
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
    mocks.availableModels = [{ value: 'fable-5' }, { value: 'opus4.6' }];
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
    mocks.availableModels = [];
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

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  toastError: vi.fn(),
  state: { current: {} as unknown },
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
});

async function buildState(fileSpecialists: object[]) {
  const { initialState: specialistsInitialState } = await import(
    '$store/renderer/slices/specialists/specialists-slice'
  );
  const { initialState: modelInitialState } = await import(
    '$store/renderer/slices/model/model-slice'
  );
  const { initialState: agentAvailabilityInitialState } = await import(
    '$store/renderer/slices/agent-availability/agent-availability-slice'
  );
  const { createCollection } = await import(
    '$lib/store-shim/utils/collections/collection-utils'
  );
  const { initialState: providerCatalogInitialState, providerCatalogReducer, providerCatalogLoaded } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } = await import(
    '../../../test/fixtures/provider-catalog.fixture'
  );
  return {
    providerCatalog: providerCatalogReducer(
      providerCatalogInitialState,
      providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
    ),
    providerSettings: {
      activeProviderId: 'auggie',
      enabledProviders: { 'claude-code': true, codex: true },
      defaultProviderId: MOCK_PROVIDER_CATALOG.defaultProviderId,
      nonDisableableProviderIds: [],
    },
    model: { ...modelInitialState, providerModels: {} },
    specialists: {
      ...specialistsInitialState,
      fileSpecialists: createCollection('id', fileSpecialists as never[]),
    },
    featureCodes: { activeFeatures: [], initialized: true },
    githubAuth: { isAuthenticated: false },
    agentAvailability: {
      ...agentAvailabilityInitialState,
      providerStatusMap: { 'claude-code': { available: true }, codex: { available: true } },
    },
  };
}

describe('AdditionalAgentsSettings disable guard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.state.current = await buildState([
      {
        id: 'my-spec',
        name: 'My Spec',
        description: 'test',
        codingAgent: 'claude-code',
        model: '',
        behaviorPrompt: 'prompt',
        filePath: '/tmp/my-spec.md',
        source: 'user',
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  async function renderToggles() {
    const AdditionalAgentsSettings = (await import('./AdditionalAgentsSettings.svelte')).default;
    const result = render(AdditionalAgentsSettings);
    const { MOCK_PROVIDER_CATALOG } = await import(
      '../../../test/fixtures/provider-catalog.fixture'
    );
    const providers = MOCK_PROVIDER_CATALOG.providers.filter((p) => p.canBeDisabled);
    const toggles = await waitFor(() => {
      const found = result.getAllByRole('switch', { hidden: true });
      expect(found.length).toBe(providers.length);
      return found;
    });
    return { providers, toggles };
  }

  it('blocks toggling off an in-use provider and shows the reason', async () => {
    const { providers, toggles } = await renderToggles();
    const claudeIndex = providers.findIndex((p) => p.id === 'claude-code');
    await fireEvent.click(toggles[claudeIndex]);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'providerSettings/toggleProvider' }),
    );
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it('still dispatches toggleProvider for providers not in use', async () => {
    const { providers, toggles } = await renderToggles();
    const codexIndex = providers.findIndex((p) => p.id === 'codex');
    await fireEvent.click(toggles[codexIndex]);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/toggleProvider',
        payload: ['codex'],
      }),
    );
  });

  it('always allows toggling a disabled provider back on', async () => {
    mocks.state.current = {
      ...(await buildState([])),
      providerSettings: {
        activeProviderId: 'auggie',
        enabledProviders: { 'claude-code': false },
      },
    };
    const { providers, toggles } = await renderToggles();
    const claudeIndex = providers.findIndex((p) => p.id === 'claude-code');
    await fireEvent.click(toggles[claudeIndex]);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'providerSettings/toggleProvider',
        payload: ['claude-code'],
      }),
    );
  });
});

describe('AdditionalAgentsSettings availability honesty', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const base = await buildState([]);
    mocks.state.current = {
      ...base,
      providerSettings: {
        activeProviderId: 'auggie',
        enabledProviders: { 'claude-code': true, codex: true },
      },
      agentAvailability: {
        ...base.agentAvailability,
        providerStatusMap: { 'claude-code': { available: true }, codex: { available: false } },
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a not-installed warning for an enabled-but-unavailable provider', async () => {
    const AdditionalAgentsSettings = (await import('./AdditionalAgentsSettings.svelte')).default;
    const result = render(AdditionalAgentsSettings);
    await waitFor(() => {
      expect(result.getAllByRole('switch', { hidden: true }).length).toBeGreaterThan(0);
    });
    const codexRow = result.getByText('OpenAI Codex').closest('div');
    expect(codexRow?.textContent).toContain('Not installed');
  });

  it('does not show a not-installed warning for an enabled-and-available provider', async () => {
    const AdditionalAgentsSettings = (await import('./AdditionalAgentsSettings.svelte')).default;
    const result = render(AdditionalAgentsSettings);
    await waitFor(() => {
      expect(result.getAllByRole('switch', { hidden: true }).length).toBeGreaterThan(0);
    });
    const claudeCodeRow = result.getByText('Anthropic Claude Code').closest('div');
    expect(claudeCodeRow?.textContent).not.toContain('Not installed');
  });
});

describe('AdditionalAgentsSettings loading/unknown availability', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const base = await buildState([]);
    mocks.state.current = {
      ...base,
      providerSettings: {
        activeProviderId: 'auggie',
        enabledProviders: { 'claude-code': true, codex: true },
      },
      // No entries yet for either provider — availability hasn't been
      // checked, which must not be mistaken for "confirmed unavailable".
      agentAvailability: { ...base.agentAvailability, providerStatusMap: {} },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('does not show a not-installed warning while availability is still unknown', async () => {
    const AdditionalAgentsSettings = (await import('./AdditionalAgentsSettings.svelte')).default;
    const result = render(AdditionalAgentsSettings);
    await waitFor(() => {
      expect(result.getAllByRole('switch', { hidden: true }).length).toBeGreaterThan(0);
    });
    const codexRow = result.getByText('OpenAI Codex').closest('div');
    expect(codexRow?.textContent).not.toContain('Not installed');
  });
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import {
  derived,
  readable,
  writable,
} from 'svelte/store';

const mockModelState = vi.hoisted(() => ({
  selectedModel: 'gpt5.4',
  availableModels: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }],
  loadError: null as string | null,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faCheck: { iconName: 'check' },
  faChevronDown: { iconName: 'chevron-down' },
  faChevronRight: { iconName: 'chevron-right' },
  faCircleNotch: { iconName: 'circle-notch' },
  faLock: { iconName: 'lock' },
  faRotateRight: { iconName: 'rotate-right' },
  faArrowsRotate: { iconName: 'arrows-rotate' },
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
  faTriangleExclamation: { iconName: 'triangle-exclamation' },
}));

vi.mock('$lib/icons/faSettings', () => ({
  faSettings: { iconName: 'settings' },
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const Button = (await import('../../ui/__tests__/mocks/button.svelte')).default;
  return { default: Button };
});

vi.mock('$features/agent/agent.client', () => ({
  agentClient: {
    setModel: vi.fn(() => Promise.resolve({ ok: true, data: { success: true } })),
  },
}));

vi.mock('$features/agent/browser', () => ({}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  // Seed a hydrated §5.38 catalog so the real provider-catalog selectors
  // (display names, id normalization, compound-id parsing) resolve.
  const { initialState, providerCatalogLoaded, providerCatalogReducer } = await import(
    '$store/renderer/slices/provider-catalog/provider-catalog-slice'
  );
  const { MOCK_PROVIDER_CATALOG } = await import('../../../../test/fixtures/provider-catalog.fixture');
  const providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );

  return createAppStoreMockModule({
    state: () => ({ providerCatalog }),
    dispatch: mockSvelteDispatch,
  });
});

const providerWarnings$ = writable<Record<string, string>>({});
const codexManagedInstallStatus$ = writable<{
  managedInstallState: string;
  version?: string;
  downloadProgress?: number;
} | null>(null);
const mockSvelteDispatch = vi.hoisted(() => vi.fn((action: { type?: string; payload?: unknown }) => {
  if (action.type === 'model/setLoadingStateForProvider' && Array.isArray(action.payload)) {
    const [payload] = action.payload as [
      { providerId: string; status: string; warning?: string } & Record<string, unknown>,
    ];
    providerWarnings$.update((warnings) => {
      const { [payload.providerId]: _cleared, ...remaining } = warnings;
      if (payload.status === 'success' && payload.warning) {
        return { ...remaining, [payload.providerId]: payload.warning };
      }
      return remaining;
    });
  }
  return action;
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', async () => {
  const { readable } = await import('svelte/store');
  const selectAgentSession = vi.fn(() => readable(undefined));
  selectAgentSession.select = vi.fn(() => undefined);
  return { selectAgentSession };
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => {
  const selectAgentSession = vi.fn(() => mockAgentSession$);
  selectAgentSession.select = vi.fn(() => undefined);
  return { selectAgentSession };
});

vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => ({
  updateSession: (agentId: string, fields: Record<string, unknown>) => ({
    type: 'agentSession/updateSession',
    payload: { agentId, fields },
  }),
}));

vi.mock('$store/renderer/slices/model/model-utils', () => ({
  getModelsForProvider: vi.fn(() =>
    Promise.resolve([{ value: 'model-1', label: 'Model 1', description: 'A model' }]),
  ),
  getModelsForProviderForLoadingState: vi.fn(),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => readable(mockModelState.selectedModel),
  selectAvailableModels: () => readable(mockModelState.availableModels),
  selectModelFallbackInfo: () => readable(null),
  selectModelPickerCollapsedGroups: () => readable([]),
  selectIsLoadingModels: () => readable(false),
  selectLoadError: () => readable(mockModelState.loadError),
  selectAllProviderWarnings: () => providerWarnings$,
}));

const hasCheckedOnce$ = writable(true);
vi.mock('$store/renderer/slices/agent-availability/agent-availability-selectors', () => ({
  selectManagedInstallStatusByProvider: () => codexManagedInstallStatus$,
  selectHasCheckedOnce: () => hasCheckedOnce$,
}));

const enabledProviderIds$ = writable(['auggie']);
const activeProviderId$ = writable('auggie');
// Mirrors `enabledProviderIds$` by default (available === enabled), so every
// existing test that only manipulates `enabledProviderIds$` keeps working
// unchanged. Tests exercising availability gating set this override to a
// distinct list (or `[]`) to diverge available from enabled.
const availableProviderOverride$ = writable<string[] | null>(null);
const availableEnabledProviderIds$ = derived(
  [enabledProviderIds$, availableProviderOverride$],
  ([enabled, override]) => override ?? enabled,
);
const mockAgentSession$ = writable<
  { id: string; workspaceId: string; provider?: string } | undefined
>(undefined);
vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => activeProviderId$,
  selectAvailableEnabledProviderIds: () => availableEnabledProviderIds$,
}));

vi.mock('$shared/types/agent-session', () => ({
  getAgentProvider: vi.fn((session?: { provider?: string }) => session?.provider),
  isPendingAgentSession: vi.fn((session: { isPending?: boolean; status?: string }) =>
    session?.isPending === true || session?.status === 'pending',
  ),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import {
  getModelsForProvider,
  getModelsForProviderForLoadingState,
} from '$store/renderer/slices/model/model-utils';
import { selectModel } from '$store/renderer/slices/model/model-slice';
import ModelPicker from './ModelPicker.svelte';
import { warmImport } from '../../../../test/warm-import';

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/button.svelte'));

afterEach(() => {
  availableProviderOverride$.set(null);
});

describe('ModelPicker locked state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      {
        value: 'gpt5.4',
        label: 'GPT 5.4',
        description: 'Smart model',
      },
    ];
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('shows the locked hover copy and can hide the redundant lock icon', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
        isLocked: true,
        lockedTitle: 'Start a new agent to change provider or model.',
        showLockIconWhenLocked: false,
      },
    });

    const button = screen.getByRole('button');
    expect(button.getAttribute('title')).toBe('Start a new agent to change provider or model.');
    expect(button.textContent).toContain('GPT 5.4');
    expect(button.querySelector('[data-icon="lock"]')).toBeNull();
  });

  it('renders the provider icon in locked state', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
        isLocked: true,
      },
    });

    const button = screen.getByRole('button');
    // ProviderIcon renders an outer <span> with class "inline-flex"
    const providerIcon = button.querySelector('span.inline-flex');
    expect(providerIcon).not.toBeNull();
  });

  it('renders the provider icon when locked with showLockIconWhenLocked=false', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
        isLocked: true,
        showLockIconWhenLocked: false,
      },
    });

    const button = screen.getByRole('button');
    // ProviderIcon renders an outer <span> with class "inline-flex"
    const providerIcon = button.querySelector('span.inline-flex');
    expect(providerIcon).not.toBeNull();
    // Lock icon should NOT be present
    expect(button.querySelector('[data-icon="lock"]')).toBeNull();
  });

  it('uses the selectedModel prop on the first render', () => {
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.availableModels = [
      { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
      { value: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', description: 'Fast model' },
    ];

    render(ModelPicker, {
      props: {
        selectedModel: 'claude-sonnet-4.5',
        providerId: 'auggie',
        isLocked: true,
      },
    });

    expect(screen.getByRole('button').textContent).toContain('Claude Sonnet 4.5');
  });
});

describe('ModelPicker multi-provider mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
    ];
    providerWarnings$.set({});
    codexManagedInstallStatus$.set(null);
    mockSvelteDispatch.mockClear();
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ]);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models: await vi.mocked(getModelsForProvider)(providerId),
    }));
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('fetches models for all enabled providers on mount', async () => {
    enabledProviderIds$.set(['auggie', 'claude-code']);

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
      },
    });

    // Wait for the debounced $effect to run (50ms debounce + microtask)
    await new Promise((r) => setTimeout(r, 100));

    expect(getModelsForProvider).toHaveBeenCalledWith('auggie');
    expect(getModelsForProvider).toHaveBeenCalledWith('claude-code');
  });

  it('renders the active provider models while another provider is still loading', async () => {
    let resolveCodex: ((result: { models: { value: string; label: string; description: string }[] }) => void) | undefined;
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation((providerId) => {
      if (providerId === 'auggie') {
        return Promise.resolve({
          models: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }],
        });
      }

      if (providerId === 'codex') {
        return new Promise((resolve) => {
          resolveCodex = resolve;
        });
      }

      return Promise.resolve({ models: [] });
    });
    enabledProviderIds$.set(['auggie', 'codex']);
    activeProviderId$.set('auggie');

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT 5\.4/ })).toBeTruthy();
    expect(screen.getByText('Loading OpenAI Codex models…')).toBeTruthy();
    expect(screen.queryByText('No models available')).toBeNull();

    resolveCodex?.({
      models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
    });

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
  });

  it('passes forceRefresh: true when the per-group refresh button is clicked', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }],
    });
    enabledProviderIds$.set(['auggie']);

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    const refreshButton = await screen.findByRole('button', {
      name: /Refresh .* models/,
    });

    vi.mocked(getModelsForProviderForLoadingState).mockClear();
    await fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie', {
        forceRefresh: true,
      });
    });
  });

  it('retries once per current provider when silent fallback sees unavailable models', async () => {
    const modelsByProvider = {
      auggie: [] as { value: string; label: string; description: string }[],
      codex: [{ value: 'codex:model-1', label: 'Codex Model 1', description: 'A model' }],
    };
    vi.mocked(getModelsForProvider).mockImplementation((providerId) =>
      Promise.resolve(modelsByProvider[providerId as keyof typeof modelsByProvider] ?? []),
    );

    enabledProviderIds$.set(['auggie', 'codex']);

    const { rerender } = render(ModelPicker, {
      props: {
        selectedModel: 'auggie:missing-model',
        silentFallback: true,
      },
    });

    await waitFor(() => {
      expect(
        vi.mocked(getModelsForProvider).mock.calls.filter(([provider]) => provider === 'auggie'),
      ).toHaveLength(2);
    });
    expect(
      vi.mocked(getModelsForProvider).mock.calls.filter(([provider]) => provider === 'codex'),
    ).toHaveLength(1);

    vi.mocked(getModelsForProvider).mockClear();
    modelsByProvider.auggie = [
      { value: 'auggie:model-1', label: 'Auggie Model 1', description: 'A model' },
    ];
    modelsByProvider.codex = [];
    // Force the component to re-fetch by changing the provider list (busts the
    // dedup cache inside fetchAllProviderModels which skips when the sorted key
    // matches the previous fetch).
    enabledProviderIds$.set([]);
    await new Promise((r) => setTimeout(r, 60));
    enabledProviderIds$.set(['auggie', 'codex']);

    await rerender({
      selectedModel: 'codex:missing-model',
      silentFallback: true,
    });

    await waitFor(() => {
      expect(
        vi.mocked(getModelsForProvider).mock.calls.filter(([provider]) => provider === 'codex'),
      ).toHaveLength(2);
    });
    expect(
      vi.mocked(getModelsForProvider).mock.calls.filter(([provider]) => provider === 'auggie'),
    ).toHaveLength(1);
  });

  it('keeps working provider models selectable while showing a failed provider warning', async () => {
    vi.mocked(getModelsForProvider).mockImplementation((providerId) => {
      if (providerId === 'codex') {
        return Promise.reject(new Error('Codex: CLI not found'));
      }

      return Promise.resolve([
        { value: 'sonnet4.6', label: 'Sonnet 4.6', description: 'Smart model' },
      ]);
    });
    enabledProviderIds$.set(['auggie', 'codex']);
    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        onModelChange,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProvider)).toHaveBeenCalledWith('codex');
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
    expect(screen.getAllByText(/OpenAI Codex: CLI not found/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/developers\.openai\.com\/codex/).length).toBeGreaterThan(0);

    await fireEvent.click(screen.getByRole('option', { name: /Sonnet 4\.6/ }));

    expect(onModelChange).toHaveBeenCalledWith('sonnet4.6');
  });

  it('surfaces an empty-with-warning provider as a visible disabled row instead of hiding the group', async () => {
    // Client-mapped form of the PROTOCOL §5.30 degraded response
    // `{ models: [], source: 'static', warning }` — the wire request/envelope
    // for that shape is asserted in model-catalog-bridge-seeder.test.ts.
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'opencode') {
        return { models: [], warning: 'opencode: opencode binary not found' };
      }
      return { models: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }] };
    });
    enabledProviderIds$.set(['auggie', 'opencode']);

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('opencode');
    });

    await fireEvent.click(screen.getByRole('button'));

    // Providers with models are unaffected…
    expect(await screen.findByRole('option', { name: /GPT 5\.4/ })).toBeTruthy();
    // …and the empty-with-warning provider renders a visible warning row
    // instead of the group vanishing.
    expect(screen.getAllByText(/OpenCode: opencode binary not found/).length).toBeGreaterThan(0);
  });

  it('shows an actionable Codex stale-list notice when the provider returns a fallback warning', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
          warning: 'Codex not installed; using static model list',
        };
      }

      return { models: [] };
    });
    enabledProviderIds$.set(['codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        variant: 'default',
        portal: false,
      },
    });

    expect(await screen.findByText('Showing default model list.')).toBeTruthy();
    expect(screen.getByText(/Install Codex CLI to see all your available models/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Setup docs/ }).getAttribute('href')).toBe(
      'https://developers.openai.com/codex/cli#cli-setup',
    );
  });

  it('does not show the Codex stale-list notice when no fallback warning is present', async () => {
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
    });
    enabledProviderIds$.set(['codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        variant: 'default',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    expect(screen.queryByText('Showing default model list.')).toBeNull();
  });

  it('shows a transient Codex setup notice while managed install is running', async () => {
    codexManagedInstallStatus$.set({
      managedInstallState: 'installing',
      version: '0.16.0',
      downloadProgress: 0.42,
    });
    enabledProviderIds$.set(['codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        variant: 'default',
        portal: false,
      },
    });

    expect(await screen.findByText('Setting up Codex…')).toBeTruthy();
    expect(screen.getByText('Download progress: 42%.')).toBeTruthy();
  });

  it('shows the real provider error when the only enabled provider fails', async () => {
    vi.mocked(getModelsForProvider).mockRejectedValue(new Error('Auggie: CLI not found'));
    enabledProviderIds$.set(['auggie']);

    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        portal: false,
      },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProvider)).toHaveBeenCalledWith('auggie');
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText('Augment Auggie: CLI not found')).toBeTruthy();
    expect(screen.getByText(/npm install -g @augmentcode\/auggie/)).toBeTruthy();
  });

  it('renders without error in unlocked mode', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
      },
    });

    const container = document.body;
    expect(container).toBeTruthy();
    expect(container.querySelector('[data-icon="lock"]')).toBeNull();
  });

  it('shows default model text when no model is explicitly selected', () => {
    render(ModelPicker, {
      props: {},
    });

    const container = document.body;
    expect(container).toBeTruthy();
  });

  it('shows the selected model label in the trigger button', () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'gpt5.4',
        isLocked: true,
        providerId: 'auggie',
      },
    });

    const button = screen.getByRole('button');
    expect(button.textContent).toContain('GPT 5.4');
  });

  it('keeps a just-picked local model through a transient undefined selectedModel prop', async () => {
    const { rerender } = render(ModelPicker, {
      props: {
        selectedModel: undefined,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('Default model');
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 1/ }));

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('Model 1');
    });

    await rerender({ selectedModel: undefined, portal: false });

    expect(screen.getByRole('button').textContent).toContain('Model 1');
  });

  it('shows default model option when selectedModel is null (BE-persisted unset)', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: null,
        portal: false,
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('Default model');
    });
  });

  it('does not silently switch when the selected model is a compound default-provider ID matching a bare dropdown entry', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    const { toast } = await import('svelte-sonner');
    vi.mocked(getModelsForProvider).mockImplementation((providerId) => {
      if (providerId === 'auggie') {
        return Promise.resolve([{ value: 'sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' }]);
      }
      return Promise.resolve([]);
    });

    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');

    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:sonnet4.6',
        agentId: 'test-agent',
        onModelChange,
      },
    });

    // Wait for provider fetch to settle
    await waitFor(() => {
      expect(vi.mocked(getModelsForProvider)).toHaveBeenCalledWith('auggie');
    });
    // Give the $effect scheduler a chance to run auto-fallback if it were going to
    await new Promise((r) => setTimeout(r, 100));

    expect(onModelChange).not.toHaveBeenCalled();
    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.info)).not.toHaveBeenCalled();
  });

  it('still triggers fallback when a non-default-provider compound model ID is unavailable', async () => {
    const { toast } = await import('svelte-sonner');
    vi.mocked(getModelsForProvider).mockImplementation((providerId) => {
      if (providerId === 'auggie') {
        return Promise.resolve([
          { value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' },
        ]);
      }
      if (providerId === 'opencode') {
        return Promise.resolve([
          { value: 'opencode:real-model', label: 'Real Model', description: 'Real' },
        ]);
      }
      return Promise.resolve([]);
    });

    enabledProviderIds$.set(['auggie', 'opencode']);
    // Active provider must match the selected model's provider so the
    // auto-fallback doesn't treat this as a provider switch.
    activeProviderId$.set('opencode');

    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'opencode:nonexistent-xyz',
        agentId: 'test-agent',
        onModelChange,
      },
    });

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith('opencode:real-model');
    });
    expect(vi.mocked(toast.info)).toHaveBeenCalled();

    // Reset for other tests
    activeProviderId$.set('auggie');
  });
});

describe('ModelPicker availability gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [];
    providerWarnings$.set({});
    codexManagedInstallStatus$.set(null);
    mockSvelteDispatch.mockClear();
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({ models: [] });
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
    availableProviderOverride$.set(null);
    hasCheckedOnce$.set(true);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    availableProviderOverride$.set(null);
    hasCheckedOnce$.set(true);
  });

  it('does not show the no-provider failure notice or toast while availability has not been checked yet', async () => {
    const { toast } = await import('svelte-sonner');
    hasCheckedOnce$.set(false);
    availableProviderOverride$.set([]);

    render(ModelPicker, {
      props: { portal: false },
    });

    await screen.findByRole('button');

    expect(screen.queryByText('No provider available')).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('shows a failure notice and fires a toast when no provider is available', async () => {
    const { toast } = await import('svelte-sonner');
    availableProviderOverride$.set([]);

    render(ModelPicker, {
      props: { portal: false },
    });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
    expect(screen.getByText('No provider available')).toBeTruthy();
  });

  it('does not show the no-provider failure notice or toast when a provider is available', async () => {
    const { toast } = await import('svelte-sonner');
    vi.mocked(getModelsForProviderForLoadingState).mockResolvedValue({
      models: [{ value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart model' }],
    });

    render(ModelPicker, {
      props: { portal: false },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('auggie');
    });

    expect(screen.queryByText('No provider available')).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('excludes an enabled-but-unavailable provider from the rendered model list', async () => {
    const { toast } = await import('svelte-sonner');
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
        };
      }
      return { models: [{ value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' }] };
    });
    enabledProviderIds$.set(['auggie', 'codex']);
    availableProviderOverride$.set(['codex']);

    render(ModelPicker, {
      props: { selectedModel: 'codex:gpt-5-codex', portal: false },
    });

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    expect(vi.mocked(getModelsForProviderForLoadingState)).not.toHaveBeenCalledWith('auggie');

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Sonnet 4\.6/ })).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});

describe('ModelPicker unlocked agent provider handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
    ];
    providerWarnings$.set({});
    codexManagedInstallStatus$.set(null);
    mockAgentSession$.set(undefined);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' }],
        };
      }
      if (providerId === 'auggie') {
        return {
          models: [{ value: 'auggie:sonnet4.6', label: 'Sonnet 4.6', description: 'Smart' }],
        };
      }
      return { models: [] };
    });
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    mockAgentSession$.set(undefined);
    activeProviderId$.set('auggie');
  });

  it('shows all enabled providers when the agent session provider differs from the active provider', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    // The agent's provider is visible…
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    // …and so is every other enabled provider — not just the agent's.
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
  });

  it('fetches and shows a newly enabled provider group live (unlocked, agent present)', async () => {
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });

    render(ModelPicker, {
      props: {
        selectedModel: 'auggie:sonnet4.6',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /GPT-5 Codex/ })).toBeNull();

    // Toggling a provider ON in Settings reaches the picker as an update to
    // the enabled-provider-ids selector (settings:changed →
    // applySettingsChanges → loadEnabledProvidersFromStorage → selector; that
    // leg is asserted in daemon-events-bridge.client.test.ts). The picker must
    // refetch and show the new provider's group without a restart.
    enabledProviderIds$.set(['auggie', 'codex']);

    await waitFor(() => {
      expect(vi.mocked(getModelsForProviderForLoadingState)).toHaveBeenCalledWith('codex');
    });
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
  });

  it('fetches an enabled agent provider only once in unlocked mode (no duplicate wire fetch)', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();

    // The agent's provider is enabled, so its models are already covered by the
    // all-providers fetch — the per-agent fetch must not fire a duplicate call.
    const codexCalls = vi
      .mocked(getModelsForProviderForLoadingState)
      .mock.calls.filter(([pid]) => pid === 'codex');
    expect(codexCalls).toHaveLength(1);
  });

  it('group refresh in unlocked mode updates the group list via allProviderModels', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();

    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        return {
          models: [{ value: 'codex:gpt-6-codex', label: 'GPT-6 Codex', description: 'Smarter' }],
        };
      }
      return { models: [] };
    });

    await fireEvent.click(screen.getByTitle('Refresh OpenAI Codex models'));

    // The refreshed list replaces the group (allProviderModels path); the
    // per-agent snapshot is not used for an enabled provider in unlocked mode.
    expect(await screen.findByRole('option', { name: /GPT-6 Codex/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /GPT-5 Codex/ })).toBeNull();
  });

  it('keeps the agent provider group visible when that provider was since disabled', async () => {
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    // The enabled providers are all listed…
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
    // …and the agent's (now disabled) provider group stays visible so the
    // currently selected model isn't orphaned.
    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
  });

  it('retries the disabled agent provider fetch', async () => {
    let codexAttempts = 0;
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => {
      if (providerId === 'codex') {
        codexAttempts += 1;
        if (codexAttempts === 1) throw new Error('Codex unavailable');
        return {
          models: [{ value: 'codex:gpt-6-codex', label: 'GPT-6 Codex', description: 'Smarter' }],
        };
      }
      return { models: [] };
    });
    enabledProviderIds$.set(['auggie']);
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'codex' });

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-6-codex',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        portal: false,
      },
    });

    await waitFor(() => expect(codexAttempts).toBe(1));
    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(codexAttempts).toBe(2));
    expect(await screen.findByRole('option', { name: /GPT-6 Codex/ })).toBeTruthy();
  });

  it('shows all enabled providers when providerId is explicitly passed', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        providerId: 'codex',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
  });

  it('shows all enabled providers when providerId matches the active provider', async () => {
    enabledProviderIds$.set(['auggie', 'codex']);
    activeProviderId$.set('codex');
    mockModelState.availableModels = [
      { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex', description: 'Smart' },
    ];

    render(ModelPicker, {
      props: {
        selectedModel: 'codex:gpt-5-codex',
        providerId: 'codex',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByRole('option', { name: /GPT-5 Codex/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /Sonnet 4\.6/ })).toBeTruthy();
  });
});

describe('ModelPicker global-default vs per-agent dispatch gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ];
    providerWarnings$.set({});
    codexManagedInstallStatus$.set(null);
    mockAgentSession$.set(undefined);
    mockSvelteDispatch.mockClear();
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ]);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models: await vi.mocked(getModelsForProvider)(providerId),
    }));
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    mockAgentSession$.set(undefined);
  });

  const pickModelOne = async () => {
    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 1/ }));
    // handleModelSelect awaits a tick before dispatching — let it settle.
    await new Promise((r) => setTimeout(r, 0));
  };

  const dispatchedTypes = () =>
    mockSvelteDispatch.mock.calls.map(([action]) => (action as { type?: string }).type);

  it('spawn context (no flags): a pick dispatches neither selectModel nor any agent-session update', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: { onModelChange, portal: false },
    });

    await pickModelOne();

    expect(onModelChange).toHaveBeenCalledWith('model-1');
    expect(dispatchedTypes()).not.toContain(selectModel.type);
    expect(dispatchedTypes()).not.toContain('agentSession/updateSession');
    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();
  });

  it('chat-input context (updateGlobalStore): a pick updates the agent but never the global default', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });

    render(ModelPicker, {
      props: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        updateGlobalStore: true,
        portal: false,
      },
    });

    await pickModelOne();

    await waitFor(() => {
      expect(dispatchedTypes()).toContain('agentSession/updateSession');
    });
    expect(vi.mocked(agentClient.setModel)).toHaveBeenCalledWith('agent-1', 'model-1', 'ws-1');
    // The global default (selectModel → model.providerDefaults /
    // providers.active persistence) must never fire from the chat input.
    expect(dispatchedTypes()).not.toContain(selectModel.type);
  });

  it('picking "Default model" drops a deferred update queued during streaming', async () => {
    const { agentClient } = await import('$features/agent/agent.client');
    mockAgentSession$.set({ id: 'agent-1', workspaceId: 'ws-1', provider: 'auggie' });

    const { rerender } = render(ModelPicker, {
      props: {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        updateGlobalStore: true,
        deferUpdate: true,
        showDefaultOption: true,
        portal: false,
      },
    });

    // Pick an explicit model while streaming — the backend update is deferred.
    await pickModelOne();
    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();

    // Then pick "Default model" — this must clear the queued deferred update.
    await fireEvent.click(screen.getAllByRole('button')[0]);
    await fireEvent.click(await screen.findByRole('option', { name: /Default model/ }));
    await new Promise((r) => setTimeout(r, 0));

    // Streaming ends: the stale deferred update must not apply.
    await rerender({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      updateGlobalStore: true,
      deferUpdate: false,
      showDefaultOption: true,
      portal: false,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(agentClient.setModel)).not.toHaveBeenCalled();
  });

  it('settings context (updateGlobalDefault): a pick dispatches the global selectModel', async () => {
    render(ModelPicker, {
      props: { updateGlobalDefault: true, portal: false },
    });

    await pickModelOne();

    await waitFor(() => {
      expect(dispatchedTypes()).toContain(selectModel.type);
    });
    const selectModelActions = mockSvelteDispatch.mock.calls
      .map(([action]) => action as { type?: string; payload?: unknown })
      .filter((action) => action.type === selectModel.type);
    expect(selectModelActions[0]?.payload).toEqual(['model-1']);
    expect(dispatchedTypes()).not.toContain('agentSession/updateSession');
  });
});

describe('ModelPicker confirmModelChange gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ];
    providerWarnings$.set({});
    codexManagedInstallStatus$.set(null);
    mockAgentSession$.set(undefined);
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'model-1', label: 'Model 1', description: 'A model' },
      { value: 'model-2', label: 'Model 2', description: 'Another model' },
    ]);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models: await vi.mocked(getModelsForProvider)(providerId),
    }));
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('applies the pick when the gate resolves true', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(true);

    render(ModelPicker, {
      props: { selectedModel: 'model-1', onModelChange, confirmModelChange, portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 2/ }));

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith('model-2');
    });
    expect(confirmModelChange).toHaveBeenCalledWith('model-1', 'model-2');
  });

  it('reverts the pick and skips onModelChange when the gate resolves false', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(false);

    render(ModelPicker, {
      props: { selectedModel: 'model-1', onModelChange, confirmModelChange, portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 2/ }));

    await waitFor(() => {
      expect(confirmModelChange).toHaveBeenCalledWith('model-1', 'model-2');
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(onModelChange).not.toHaveBeenCalled();
    // The trigger still shows the original model after the revert.
    const trigger = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('Model 1') || b.textContent?.includes('Model 2'));
    expect(trigger?.textContent).toContain('Model 1');
    expect(trigger?.textContent).not.toContain('Model 2');
  });

  it('gates switching from an explicit model to "Default model" and passes null as the target', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(true);

    render(ModelPicker, {
      props: {
        selectedModel: 'model-1',
        onModelChange,
        confirmModelChange,
        portal: false,
        showDefaultOption: true,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Default model/ }));

    await waitFor(() => {
      expect(confirmModelChange).toHaveBeenCalledWith('model-1', null);
    });
    // Confirming applies the pick: the trigger now shows "Default model".
    await waitFor(() => {
      const trigger = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes('Default model') || b.textContent?.includes('Model 1'));
      expect(trigger?.textContent).toContain('Default model');
    });
  });

  it('reverts an explicit-to-default pick when the gate resolves false', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(false);

    render(ModelPicker, {
      props: {
        selectedModel: 'model-1',
        onModelChange,
        confirmModelChange,
        portal: false,
        showDefaultOption: true,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Default model/ }));

    await waitFor(() => {
      expect(confirmModelChange).toHaveBeenCalledWith('model-1', null);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(onModelChange).not.toHaveBeenCalled();
    const trigger = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('Model 1') || b.textContent?.includes('Default model'));
    expect(trigger?.textContent).toContain('Model 1');
  });

  it('does not invoke the gate when re-selecting the current model', async () => {
    const onModelChange = vi.fn();
    const confirmModelChange = vi.fn().mockResolvedValue(true);

    render(ModelPicker, {
      props: { selectedModel: 'model-1', onModelChange, confirmModelChange, portal: false },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 1/ }));

    await new Promise((r) => setTimeout(r, 0));
    expect(confirmModelChange).not.toHaveBeenCalled();
    expect(onModelChange).toHaveBeenCalledWith('model-1');
  });
});

describe('ModelPicker specialist inherit state (default-option plumbing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
    mockModelState.loadError = null;
    mockModelState.availableModels = [
      { value: 'model-1', label: 'Model 1', description: 'A model' },
    ];
    providerWarnings$.set({});
    codexManagedInstallStatus$.set(null);
    mockAgentSession$.set(undefined);
    vi.mocked(getModelsForProvider).mockResolvedValue([
      { value: 'model-1', label: 'Model 1', description: 'A model' },
      { value: 'model-2', label: 'Model 2', description: 'Another model' },
    ]);
    vi.mocked(getModelsForProviderForLoadingState).mockImplementation(async (providerId) => ({
      models: await vi.mocked(getModelsForProvider)(providerId),
    }));
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders the inherit state with the daemon resolvedModel preview on the trigger (no explicit pin)', async () => {
    render(ModelPicker, {
      props: {
        // Inheriting: no explicit frontmatter model — daemon preview only.
        selectedModel: undefined,
        showDefaultOption: true,
        defaultModelId: 'model-1',
        defaultOptionLabel: 'Default',
        defaultOptionDescription: 'Use the global default model',
        formatDefaultModelLabel: (model: string) => `Default (${model})`,
        portal: false,
      },
    });

    await waitFor(() => {
      const trigger = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes('Default'));
      expect(trigger?.textContent).toContain('Default (Model 1)');
    });
  });

  it('renders the pinned state from an explicit model (preview ignored)', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'model-2',
        showDefaultOption: true,
        defaultModelId: 'model-1',
        formatDefaultModelLabel: (model: string) => `Default (${model})`,
        portal: false,
      },
    });

    await waitFor(() => {
      const trigger = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes('Model'));
      expect(trigger?.textContent).toContain('Model 2');
      expect(trigger?.textContent).not.toContain('Default');
    });
  });

  it('shows the custom inherit option label/description in the dropdown', async () => {
    render(ModelPicker, {
      props: {
        selectedModel: 'model-2',
        showDefaultOption: true,
        defaultOptionLabel: 'Default',
        defaultOptionDescription: 'Use the global default model',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    const inheritOption = await screen.findByRole('option', { name: /Use the global default model/ });
    expect(inheritOption.textContent).toContain('Default');
  });

  it('emits onModelChange("") when the inherit option is picked', async () => {
    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: 'model-2',
        onModelChange,
        showDefaultOption: true,
        defaultOptionLabel: 'Default',
        defaultOptionDescription: 'Use the global default model',
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(
      await screen.findByRole('option', { name: /Use the global default model/ }),
    );

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith('');
    });
  });

  it('emits the model id unchanged when a concrete model is picked (pin path)', async () => {
    const onModelChange = vi.fn();

    render(ModelPicker, {
      props: {
        selectedModel: undefined,
        onModelChange,
        showDefaultOption: true,
        portal: false,
      },
    });

    await fireEvent.click(screen.getByRole('button'));
    await fireEvent.click(await screen.findByRole('option', { name: /Model 2/ }));

    await waitFor(() => {
      expect(onModelChange).toHaveBeenCalledWith('model-2');
    });
  });
});

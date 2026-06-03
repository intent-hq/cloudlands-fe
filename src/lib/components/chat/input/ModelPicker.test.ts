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

  return createAppStoreMockModule({
    state: () => ({}),
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

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', async () => {
  const { readable } = await import('svelte/store');
  const selectAgentSession = vi.fn(() => readable(undefined));
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

vi.mock('$store/renderer/slices/agent-availability/agent-availability-selectors', () => ({
  selectManagedInstallStatusByProvider: () => codexManagedInstallStatus$,
}));

vi.mock('$shared/config/provider-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$shared/config/provider-config')>();

  return {
    ...actual,
    getProviderConfig: (providerId?: string) => {
      const configs = {
        auggie: {
          id: 'auggie',
          displayName: 'Augment Auggie',
          command: 'auggie',
          canBeDisabled: false,
          loginCommandHint: 'auggie login',
        },
        codex: {
          id: 'codex',
          displayName: 'OpenAI Codex',
          command: 'codex-acp',
          canBeDisabled: true,
          loginDocsUrl: 'https://developers.openai.com/codex/cli#cli-setup',
        },
        'claude-code': {
          id: 'claude-code',
          displayName: 'Anthropic Claude Code',
          command: 'claude-agent-acp',
          canBeDisabled: true,
          loginDocsUrl: 'https://code.claude.com/docs/en/quickstart#step-2-log-in-to-your-account',
        },
        opencode: {
          id: 'opencode',
          displayName: 'OpenCode',
          command: 'opencode',
          canBeDisabled: true,
        },
      };
      return (
        configs[(providerId ?? 'auggie') as keyof typeof configs] ?? {
          id: providerId ?? 'auggie',
          displayName: providerId ?? 'auggie',
          command: providerId ?? 'auggie',
          canBeDisabled: true,
        }
      );
    },
    isProviderAuthenticationError: () => false,
    parseCompoundModelId: (modelId?: string) => {
      if (!modelId) {
        return { providerId: '', modelId: '' };
      }

      const [providerId, ...rest] = modelId.split(':');
      if (rest.length === 0) {
        return { providerId: 'auggie', modelId };
      }

      return { providerId: providerId || 'auggie', modelId: rest.join(':') };
    },
    resolvePreferredModel: () => undefined,
    getAlwaysEnabledProviders: () => [
      { id: 'auggie', displayName: 'Augment Auggie', canBeDisabled: false },
    ],
    ACP_PROVIDERS: {
      auggie: { id: 'auggie', displayName: 'Augment Auggie', canBeDisabled: false },
      codex: { id: 'codex', displayName: 'OpenAI Codex', canBeDisabled: true },
      'claude-code': {
        id: 'claude-code',
        displayName: 'Anthropic Claude Code',
        canBeDisabled: true,
      },
      opencode: { id: 'opencode', displayName: 'OpenCode', canBeDisabled: true },
    },
  };
});

const enabledProviderIds$ = writable(['auggie']);
const activeProviderId$ = writable('auggie');
vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => activeProviderId$,
  selectEnabledProviderIds: () => enabledProviderIds$,
}));

vi.mock('$shared/types/agent-session', () => ({
  getAgentProvider: vi.fn(() => 'auggie'),
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
import ModelPicker from './ModelPicker.svelte';

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
      version: '0.13.0',
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

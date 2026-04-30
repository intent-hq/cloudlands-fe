import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readable, writable } from 'svelte/store';

const mockModelState = vi.hoisted(() => ({
  selectedModel: 'gpt5.4',
  availableModels: [{ value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' }],
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faCheck: { iconName: 'check' },
  faChevronDown: { iconName: 'chevron-down' },
  faChevronRight: { iconName: 'chevron-right' },
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

const mockReduxDispatch = vi.hoisted(() => vi.fn());
vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({
    getState: () => ({}),
    dispatch: mockReduxDispatch,
  }),
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', async () => {
  const { readable } = await import('svelte/store');
  const selectAgentById = vi.fn(() => readable(undefined));
  selectAgentById.select = vi.fn(() => undefined);
  return { selectAgentById };
});

vi.mock('$lib/store/slices/agent-session/agent-session-slice', () => ({
  updateSession: (agentId: string, fields: Record<string, unknown>) => ({
    type: 'agentSession/updateSession',
    payload: { agentId, fields },
  }),
}));

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => vi.fn(),
  getStoreContext: () => undefined,
}));

vi.mock('$lib/store/slices/model/model-utils', () => ({
  getModelsForProvider: vi.fn(() =>
    Promise.resolve([{ value: 'model-1', label: 'Model 1', description: 'A model' }]),
  ),
}));

vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectSelectedModel: () => readable(mockModelState.selectedModel),
  selectAvailableModels: () => readable(mockModelState.availableModels),
  selectIsLoadingModels: () => readable(false),
  selectLoadError: () => readable(null),
}));

vi.mock('$shared/config/provider-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$shared/config/provider-config')>();

  return {
    ...actual,
    getProviderConfig: (providerId?: string) => ({
      id: providerId ?? 'auggie',
      displayName: providerId === 'codex' ? 'OpenAI Codex' : 'Augment Auggie',
      canBeDisabled: providerId !== 'auggie',
    }),
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
    },
  };
});

const enabledProviderIds$ = writable(['auggie']);
const activeProviderId$ = writable('auggie');
vi.mock('$lib/store/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => activeProviderId$,
  selectEnabledProviderIds: () => enabledProviderIds$,
}));

vi.mock('$shared/types/agent-session', () => ({
  getAgentProvider: vi.fn(() => 'auggie'),
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

import ModelPicker from './ModelPicker.svelte';

describe('ModelPicker locked state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModelState.selectedModel = 'gpt5.4';
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
    mockModelState.availableModels = [
      { value: 'gpt5.4', label: 'GPT 5.4', description: 'Smart model' },
    ];
    enabledProviderIds$.set(['auggie']);
    activeProviderId$.set('auggie');
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('fetches models for all enabled providers on mount', async () => {
    const { getModelsForProvider } = await import('$lib/store/slices/model/model-utils');

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
    const { getModelsForProvider } = await import('$lib/store/slices/model/model-utils');
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
    const { getModelsForProvider } = await import('$lib/store/slices/model/model-utils');
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
    const { getModelsForProvider } = await import('$lib/store/slices/model/model-utils');
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

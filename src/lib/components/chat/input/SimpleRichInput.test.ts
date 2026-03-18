import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';

const { resolveCompatibleModelForProviderMock, setModelMock } = vi.hoisted(() => ({
  resolveCompatibleModelForProviderMock: vi.fn(),
  setModelMock: vi.fn(),
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faChevronDown: { iconName: 'chevron-down' },
  faMagicWandSparkles: { iconName: 'magic-wand' },
  faPaperclip: { iconName: 'paperclip' },
  faPaperPlane: { iconName: 'paper-plane' },
  faSpinner: { iconName: 'spinner' },
  faXmark: { iconName: 'xmark' },
  faLayerGroup: { iconName: 'layer-group' },
  faStop: { iconName: 'stop' },
  faLock: { iconName: 'lock' },
  faCheck: { iconName: 'check' },
  faChevronRight: { iconName: 'chevron-right' },
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../ui/button/button.svelte', async () => {
  const Button = (await import('../../ui/__tests__/mocks/button.svelte')).default;
  return { default: Button };
});

vi.mock('./TipTapEditor.svelte', async () => {
  const TipTapEditor = (await import('../__tests__/mocks/TipTapEditor.svelte')).default;
  return { default: TipTapEditor };
});

vi.mock('./ModelPicker.svelte', async () => {
  const ModelPicker = (await import('../__tests__/mocks/ModelPicker.svelte')).default;
  return { default: ModelPicker };
});

vi.mock('./ContextPickerButton.svelte', async () => {
  const SlotOnly = (await import('../__tests__/mocks/SlotOnly.svelte')).default;
  return { default: SlotOnly };
});

vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('../__tests__/mocks/SlotOnly.svelte')).default;
  return { TooltipShortcut: SlotOnly };
});

vi.mock('$lib/store/slices/multi-panel-context/multi-panel-context-selectors', () => ({
  selectPanels: () => readable([]),
  selectSelections: () => readable([]),
}));

vi.mock('$lib/store/slices/additional-agents/additional-agents-selectors', () => ({
  selectEnabledProviderIds: () => readable(['auggie', 'codex']),
}));

vi.mock('$lib/store/utils/utils', () => ({
  getDispatch: () => vi.fn(),
  getStoreContext: () => undefined,
}));

vi.mock('$lib/stores/additional-agents.store.svelte', () => ({
  additionalAgentsStore: {
    getEnabledProviderIds: () => ['auggie', 'codex'],
  },
}));

vi.mock('$lib/stores/specialists.store.svelte', () => ({
  specialistsStore: {
    getSpecialistName: (specialistId: string) =>
      specialistId === 'implementor' ? 'Implementor' : null,
  },
}));

vi.mock('$lib/utils/provider-model-selection', () => ({
  buildProviderDropdownOptions: (providerIds: string[]) =>
    providerIds.map((providerId) => ({
      value: providerId,
      label: providerId === 'auggie' ? 'Augment Auggie' : providerId === 'codex' ? 'OpenAI Codex' : providerId,
    })),
  getSelectableProviderIds: ({
    enabledProviderIds,
    usableProviderIds,
    selectedProviderId,
  }: {
    enabledProviderIds: string[];
    usableProviderIds: string[];
    selectedProviderId?: string;
  }) => {
    const usableSet = new Set(usableProviderIds);
    const filtered = enabledProviderIds.filter((providerId) => usableSet.has(providerId));
    return [...new Set(selectedProviderId ? [selectedProviderId, ...filtered] : filtered)];
  },
  shouldShowChatProviderControl: ({
    defaultProviderId,
    selectableProviderIds,
    selectedProviderId,
  }: {
    defaultProviderId: string;
    selectableProviderIds: string[];
    selectedProviderId?: string;
  }) => {
    if (!selectedProviderId) {
      return false;
    }

    if (selectedProviderId !== defaultProviderId) {
      return true;
    }

    return selectableProviderIds.length > 1;
  },
  resolveCompatibleModelForProvider: resolveCompatibleModelForProviderMock,
  resolveUsableProviderIds: async (providerIds: string[]) => providerIds,
}));

vi.mock('$features/agent/agent.client', () => ({
  agentClient: {
    setModel: setModelMock,
  },
}));

import { sessionStore } from '$features/agent/browser';
import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import SimpleRichInput from './SimpleRichInput.svelte';

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    status: 'idle',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: 'gpt5.4',
    provider: 'auggie',
    metadata: { provider: 'auggie' },
    ...overrides,
  } as any;
}

describe('SimpleRichInput provider switch sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCompatibleModelForProviderMock.mockResolvedValue('codex:gpt-5-codex');
    setModelMock.mockResolvedValue({ ok: true, data: { success: true, modelId: 'codex:gpt-5-codex' } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    unifiedStateStore.setCurrentWorkspace('ws-1' as any);
    sessionStore.addSession(createSession());
  });

  afterEach(() => {
    cleanup();
    sessionStore.removeSession('agent-1');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps the visible provider and model picker in sync after a successful switch even before parent props catch up', async () => {
    const onmodelChange = vi.fn();
    const workspace = {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any;

    const { container } = render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        workspace,
        agentId: 'agent-1',
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
        onmodelChange,
      },
    });

    const triggerText = await within(container).findByText('Augment Auggie');
    const trigger = triggerText.closest('button');
    expect(trigger).toBeTruthy();

    await fireEvent.click(trigger!);
    await fireEvent.click(await screen.findByText('OpenAI Codex'));

    await waitFor(() => {
      expect(resolveCompatibleModelForProviderMock).toHaveBeenCalledWith('codex', {
        currentModel: 'gpt5.4',
      });
      expect(setModelMock).toHaveBeenCalledWith('agent-1', 'codex:gpt-5-codex', 'ws-1');
      expect(within(container).getByText('OpenAI Codex')).toBeTruthy();
      expect(screen.getByTestId('model-picker-provider').textContent).toBe('codex');
      expect(screen.getByTestId('model-picker-model').textContent).toBe('codex:gpt-5-codex');
      expect(onmodelChange).toHaveBeenCalledWith('codex:gpt-5-codex');
    });
  });

  it('waits for hydrated model props instead of seeding a fallback model on reopen', async () => {
    const onmodelChange = vi.fn();
    const workspace = {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any;

    const { rerender } = render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        workspace,
        agentId: 'agent-1',
        providerId: 'codex',
        onmodelChange,
      },
    });

    expect(screen.getByTestId('model-picker-provider').textContent).toBe('codex');
    expect(screen.getByTestId('model-picker-model').textContent).toBe('');
    expect(onmodelChange).not.toHaveBeenCalled();
    expect(setModelMock).not.toHaveBeenCalled();

    await rerender({
      value: '',
      contextItems: [],
      workspace,
      agentId: 'agent-1',
      providerId: 'codex',
      selectedModel: 'codex:gpt-5-codex',
      onmodelChange,
    });

    await waitFor(() => {
      expect(screen.getByTestId('model-picker-provider').textContent).toBe('codex');
      expect(screen.getByTestId('model-picker-model').textContent).toBe('codex:gpt-5-codex');
    });

    expect(onmodelChange).not.toHaveBeenCalled();
    expect(setModelMock).not.toHaveBeenCalled();
  });

  it('hydrates the persisted provider from session state instead of showing the default provider on reopen', async () => {
    sessionStore.removeSession('agent-1');
    sessionStore.addSession(
      createSession({
        model: 'codex:gpt-5-codex',
        provider: 'codex',
        metadata: { provider: 'codex' },
      }),
    );

    const workspace = {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any;

    render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        workspace,
        agentId: 'agent-1',
        selectedModel: 'codex:gpt-5-codex',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('OpenAI Codex')).toBeTruthy();
      expect(screen.queryByText('Augment Auggie')).toBeNull();
      expect(screen.getByTestId('model-picker-provider').textContent).toBe('codex');
    });

    expect(setModelMock).not.toHaveBeenCalled();
  });

  it('locks provider and model together with shared hover copy and no extra model lock icon', async () => {
    sessionStore.removeSession('agent-1');
    sessionStore.addSession(
      createSession({
        metadata: {
          provider: 'auggie',
        },
      }),
    );

    const workspace = {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any;

    render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        workspace,
        agentId: 'agent-1',
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
        isProviderChangeLocked: true,
      },
    });

    const modelPicker = screen.getByTestId('model-picker');
    expect(modelPicker.getAttribute('data-locked')).toBe('true');
    expect(modelPicker.getAttribute('data-show-lock-icon')).toBe('false');
    expect(modelPicker.getAttribute('title')).toBe('Start a new agent to change provider or model.');

    await waitFor(() => {
      expect(screen.getAllByTitle('Start a new agent to change provider or model.')).toHaveLength(2);
    });
  });

  it('hides the provider control when only the default provider is selectable', async () => {
    const workspace = {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any;

    render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        workspace,
        agentId: 'agent-1',
        selectedModel: 'gpt5.4',
        providerId: 'auggie',
      },
    });

    await waitFor(() => {
      expect(screen.queryByText('OpenAI Codex')).toBeNull();
      expect(screen.queryByText('Augment Auggie')).toBeNull();
      expect(screen.getByTestId('model-picker-provider').textContent).toBe('auggie');
      expect(screen.getByTestId('model-picker-model').textContent).toBe('gpt5.4');
    });
  });

  it('keeps the provider control visible when the current provider is non-default', async () => {
    sessionStore.removeSession('agent-1');
    sessionStore.addSession(
      createSession({
        model: 'codex:gpt-5-codex',
        provider: 'codex',
        metadata: { provider: 'codex' },
      }),
    );

    const workspace = {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any;

    render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        workspace,
        agentId: 'agent-1',
        selectedModel: 'codex:gpt-5-codex',
        providerId: 'codex',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('OpenAI Codex')).toBeTruthy();
      expect(screen.getByTestId('model-picker-provider').textContent).toBe('codex');
    });
  });
});

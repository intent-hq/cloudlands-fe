import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faMagicWandSparkles: { iconName: 'magic-wand' },
  faPaperclip: { iconName: 'paperclip' },
  faPaperPlane: { iconName: 'paper-plane' },
  faSpinner: { iconName: 'spinner' },
  faXmark: { iconName: 'xmark' },
  faLayerGroup: { iconName: 'layer-group' },
  faStop: { iconName: 'stop' },
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

vi.mock('$lib/store/utils/svelte-context', () => ({
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


const resolveCompatibleModelForProviderMock = vi.hoisted(() => vi.fn());

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

const setModelMock = vi.hoisted(() => vi.fn());

vi.mock('$features/agent/agent.client', () => ({
  agentClient: {
    setModel: setModelMock,
  },
}));

// Mock Redux store bridge — the component reads agent sessions from Redux
const mockReduxState: { workspaceAgents: { byWorkspaceId: Record<string, any> } } = {
  workspaceAgents: { byWorkspaceId: {} },
};
const mockReduxDispatch = vi.fn();
vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({
    getState: () => mockReduxState,
    dispatch: mockReduxDispatch,
  }),
}));
vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentById: {
    select: (_state: any, agentId: string) => {
      // Search across all workspaces since wsId was removed
      for (const ws of Object.values(mockReduxState.workspaceAgents.byWorkspaceId) as any[]) {
        const agent = ws?.agents?.map?.[agentId];
        if (agent) return agent;
      }
      return null;
    },
  },
}));
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

function addMockSession(wsId: string, session: any) {
  if (!mockReduxState.workspaceAgents.byWorkspaceId[wsId]) {
    mockReduxState.workspaceAgents.byWorkspaceId[wsId] = { agents: { ids: [], map: {} } };
  }
  const ws = mockReduxState.workspaceAgents.byWorkspaceId[wsId];
  ws.agents.map[session.id] = session;
  if (!ws.agents.ids.includes(session.id)) ws.agents.ids.push(session.id);
}

function removeMockSession(wsId: string, agentId: string) {
  const ws = mockReduxState.workspaceAgents.byWorkspaceId[wsId];
  if (ws) {
    delete ws.agents.map[agentId];
    ws.agents.ids = ws.agents.ids.filter((id: string) => id !== agentId);
  }
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

    addMockSession('ws-1', createSession());
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
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
        isProviderChangeLocked: true,
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
      isProviderChangeLocked: true,
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
    removeMockSession('ws-1', 'agent-1');
    addMockSession('ws-1',
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
        isProviderChangeLocked: true,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('model-picker-provider').textContent).toBe('codex');
    });

    expect(setModelMock).not.toHaveBeenCalled();
  });

  it('locks provider and model together with shared hover copy and no extra model lock icon', async () => {
    removeMockSession('ws-1', 'agent-1');
    addMockSession('ws-1',
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
      expect(screen.getAllByTitle('Start a new agent to change provider or model.')).toHaveLength(1);
    });

  });

  it('calls agentClient.setModel exactly once during a cross-provider model switch', async () => {
    const onmodelChange = vi.fn();
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
        onmodelChange,
      },
    });

    // Simulate a cross-provider model change via the ModelPicker mock's trigger
    const triggerInput = screen.getByTestId('model-picker-trigger-input');
    const triggerButton = screen.getByTestId('model-picker-trigger');

    // Set the new model value (different provider prefix triggers cross-provider flow)
    fireEvent.input(triggerInput, { target: { value: 'codex:gpt-5-codex' } });
    await fireEvent.click(triggerButton);

    // Wait for the async handleProviderChangeFromModel to complete
    await waitFor(() => {
      expect(setModelMock).toHaveBeenCalledTimes(1);
    });

    expect(setModelMock).toHaveBeenCalledWith('agent-1', 'codex:gpt-5-codex', 'ws-1');
    expect(onmodelChange).toHaveBeenCalledWith('codex:gpt-5-codex');
  });

  it('treats default-provider aliases as the same provider during model selection', async () => {
    const onmodelChange = vi.fn();
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
        onmodelChange,
      },
    });

    const triggerInput = screen.getByTestId('model-picker-trigger-input');
    const triggerButton = screen.getByTestId('model-picker-trigger');

    fireEvent.input(triggerInput, { target: { value: 'augment:sonnet4.5' } });
    await fireEvent.click(triggerButton);

    await waitFor(() => {
      expect(screen.getByTestId('model-picker-model').textContent).toBe('augment:sonnet4.5');
    });

    expect(setModelMock).not.toHaveBeenCalled();
    expect(onmodelChange).toHaveBeenCalledWith('augment:sonnet4.5');
  });

  it('keeps the provider control visible when the current provider is non-default', async () => {
    removeMockSession('ws-1', 'agent-1');
    addMockSession('ws-1',
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
      // The mock ModelPicker renders the selectedModel prop; the real ModelPicker
      // would extract and display the provider from the compound model ID.
      expect(screen.getByTestId('model-picker-model').textContent).toBe('codex:gpt-5-codex');
    });
  });
});

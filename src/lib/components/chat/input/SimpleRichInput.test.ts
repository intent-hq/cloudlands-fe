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
import { readable } from 'svelte/store';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faMagicWandSparkles: { iconName: 'magic-wand' },
  faMicrophone: { iconName: 'microphone' },
  faPaperclip: { iconName: 'paperclip' },
  faPaperPlane: { iconName: 'paper-plane' },
  faSpinner: { iconName: 'spinner' },
  faXmark: { iconName: 'xmark' },
  faLayerGroup: { iconName: 'layer-group' },
  faStop: { iconName: 'stop' },
  faCheck: { iconName: 'check' },
  faChevronRight: { iconName: 'chevron-right' },
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
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

// The effort control has its own suite (EffortPicker.test.ts); stub it here so
// this suite does not need the reasoning-effort selector surface.
vi.mock('./EffortPicker.svelte', async () => {
  const SlotOnly = (await import('../__tests__/mocks/SlotOnly.svelte')).default;
  return { default: SlotOnly };
});

vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('../__tests__/mocks/SlotOnly.svelte')).default;
  return { TooltipShortcut: SlotOnly };
});

vi.mock('$store/renderer/slices/multi-panel-context/multi-panel-context-selectors', () => ({
  selectPanels: () => readable([]),
  selectSelections: () => readable([]),
}));

vi.mock('$store/renderers/additional-agents.store.svelte', () => ({
  additionalAgentsStore: {
    getEnabledProviderIds: () => ['auggie', 'codex'],
  },
}));

vi.mock('$store/renderers/specialists.store.svelte', () => ({
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

const enhancePromptMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/client/live/live-prompt-enhancement', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$lib/client/live/live-prompt-enhancement')>();
  return { ...actual, enhancePrompt: enhancePromptMock };
});

// Mock Redux store bridge — the component reads agent sessions from Redux
const mockReduxState = vi.hoisted(
  (): {
    workspaceAgents: { byWorkspaceId: Record<string, any> };
    providerSettings: { activeProviderId: string };
    hardwareConsole: { pttRecording: boolean; voiceTranscribing: boolean };
    voiceSettings: {
      isLoading: boolean;
      engine: string;
      osEngineAvailable: boolean;
      provider: string;
      keyConfigured: Record<string, boolean>;
    };
    providerCatalog?: unknown;
  } => ({
    workspaceAgents: { byWorkspaceId: {} },
    // Unset active provider — the §5.31 gate treats this as auggie (default)
    providerSettings: { activeProviderId: '' },
    // The composer mic button subscribes to these hardware-console flags
    hardwareConsole: { pttRecording: false, voiceTranscribing: false },
    // Mic visibility reads the effective voice engine off this slice
    voiceSettings: {
      isLoading: false,
      engine: 'daemon',
      osEngineAvailable: false,
      provider: 'elevenlabs',
      keyConfigured: { elevenlabs: true, openai: false },
    },
  }),
);
const mockReduxDispatch = vi.hoisted(() => vi.fn());
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  // The input resolves provider ids/display names via the providerCatalog
  // slice — hydrate the §5.38-shaped mock catalog into the mocked state.
  const { initialState, providerCatalogLoaded, providerCatalogReducer } = await import(
    '$store/renderer/slices/provider-catalog/provider-catalog-slice'
  );
  const { MOCK_PROVIDER_CATALOG } = await import(
    '../../../../test/fixtures/provider-catalog.fixture'
  );
  mockReduxState.providerCatalog = providerCatalogReducer(
    initialState,
    providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
  );

  return createAppStoreMockModule({
    state: () => mockReduxState,
    dispatch: mockReduxDispatch,
  });
});
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentSession: {
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
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: {
    select: (_state: any, agentId: string) => {
      for (const ws of Object.values(mockReduxState.workspaceAgents.byWorkspaceId) as any[]) {
        const agent = ws?.agents?.map?.[agentId];
        if (agent) return agent;
      }
      return null;
    },
  },
}));
import SimpleRichInput from './SimpleRichInput.svelte';
import { warmImport } from '../../../../test/warm-import';

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

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/button.svelte'));
warmImport(() => import('../__tests__/mocks/TipTapEditor.svelte'));
warmImport(() => import('../__tests__/mocks/ModelPicker.svelte'));
warmImport(() => import('../__tests__/mocks/SlotOnly.svelte'));

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
        requiresModelSwitchConfirmation: true,
        onmodelChange,
      },
    });

    expect(screen.getByTestId('model-picker-provider').textContent).toBe('');
    expect(screen.getByTestId('model-picker-model').textContent).toBe('');
    expect(onmodelChange).not.toHaveBeenCalled();
    expect(setModelMock).not.toHaveBeenCalled();

    await rerender({
      value: '',
      contextItems: [],
      workspace,
      agentId: 'agent-1',
      providerId: 'codex',
      requiresModelSwitchConfirmation: true,
      selectedModel: 'codex:gpt-5-codex',
      onmodelChange,
    });

    await waitFor(() => {
      expect(screen.getByTestId('model-picker-provider').textContent).toBe('');
      expect(screen.getByTestId('model-picker-model').textContent).toBe('codex:gpt-5-codex');
    });

    expect(onmodelChange).not.toHaveBeenCalled();
    expect(setModelMock).not.toHaveBeenCalled();
  });

  it('hydrates the persisted model without passing the session provider as a filter', async () => {
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
        requiresModelSwitchConfirmation: true,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('model-picker-provider').textContent).toBe('');
      expect(screen.getByTestId('model-picker-model').textContent).toBe('codex:gpt-5-codex');
    });

    expect(setModelMock).not.toHaveBeenCalled();
  });

  it('keeps the model picker unlocked mid-conversation (confirmation replaces the lock)', async () => {
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
        requiresModelSwitchConfirmation: true,
      },
    });

    const modelPicker = screen.getByTestId('model-picker');
    expect(modelPicker.getAttribute('data-locked')).toBe('false');
  });

  it('shows the confirm dialog before a mid-conversation switch and applies on confirm', async () => {
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
        requiresModelSwitchConfirmation: true,
        onmodelChange,
      },
    });

    const triggerInput = screen.getByTestId('model-picker-trigger-input');
    const triggerButton = screen.getByTestId('model-picker-trigger');

    // Cross-provider switch → dialog opens with the stronger provider warning
    fireEvent.input(triggerInput, { target: { value: 'codex:gpt-5-codex' } });
    await fireEvent.click(triggerButton);

    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[role="dialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(dialog.textContent).toContain('Switch provider mid-conversation?');
    expect(setModelMock).not.toHaveBeenCalled();
    expect(onmodelChange).not.toHaveBeenCalled();

    // Confirm → the cross-provider switch flow runs
    const confirmButton = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Switch provider'),
    );
    expect(confirmButton).toBeTruthy();
    await fireEvent.click(confirmButton!);

    await waitFor(() => {
      expect(setModelMock).toHaveBeenCalledWith('agent-1', 'codex:gpt-5-codex', 'ws-1');
    });
    expect(onmodelChange).toHaveBeenCalledWith('codex:gpt-5-codex');
  });

  it('cancel in the confirm dialog leaves session state untouched', async () => {
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
        requiresModelSwitchConfirmation: true,
        onmodelChange,
      },
    });

    const triggerInput = screen.getByTestId('model-picker-trigger-input');
    const triggerButton = screen.getByTestId('model-picker-trigger');

    fireEvent.input(triggerInput, { target: { value: 'codex:gpt-5-codex' } });
    await fireEvent.click(triggerButton);

    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[role="dialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    const cancelButton = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel',
    );
    expect(cancelButton).toBeTruthy();
    await fireEvent.click(cancelButton!);

    await waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });
    expect(setModelMock).not.toHaveBeenCalled();
    expect(onmodelChange).not.toHaveBeenCalled();
    expect(mockReduxDispatch).not.toHaveBeenCalled();
    // Revert-before-send leaves no trace: the picker still shows the
    // original model, exactly as if the switch was never attempted.
    expect(screen.getByTestId('model-picker-model').textContent).toBe('gpt5.4');
  });

  it('same-provider switch shows the model-only dialog and applies without the provider flow', async () => {
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
        requiresModelSwitchConfirmation: true,
        onmodelChange,
      },
    });

    const triggerInput = screen.getByTestId('model-picker-trigger-input');
    const triggerButton = screen.getByTestId('model-picker-trigger');

    // Same-provider switch (auggie → auggie) → the milder model-only dialog
    fireEvent.input(triggerInput, { target: { value: 'auggie:sonnet4.5' } });
    await fireEvent.click(triggerButton);

    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[role="dialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(dialog.textContent).toContain('Switch model mid-conversation?');
    expect(dialog.textContent).not.toContain('Switch provider mid-conversation?');

    const confirmButton = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Switch model',
    );
    expect(confirmButton).toBeTruthy();
    await fireEvent.click(confirmButton!);

    await waitFor(() => {
      expect(onmodelChange).toHaveBeenCalledWith('auggie:sonnet4.5');
    });
    // Same provider — no cross-provider switch flow, no setModel wire call here
    // (the real ModelPicker dispatches the model update itself).
    expect(setModelMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('model-picker-model').textContent).toBe('auggie:sonnet4.5');
  });

  it('does not show the dialog before the conversation has started', async () => {
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
        requiresModelSwitchConfirmation: false,
        onmodelChange,
      },
    });

    const triggerInput = screen.getByTestId('model-picker-trigger-input');
    const triggerButton = screen.getByTestId('model-picker-trigger');

    fireEvent.input(triggerInput, { target: { value: 'augment:sonnet4.5' } });
    await fireEvent.click(triggerButton);

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await waitFor(() => {
      expect(onmodelChange).toHaveBeenCalledWith('augment:sonnet4.5');
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

describe('SimpleRichInput Stop-button visibility', () => {
  const baseProps = () => ({
    value: '',
    contextItems: [],
    workspace: {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any,
    agentId: 'agent-1',
    selectedModel: 'gpt5.4',
  });

  // The mocked Button component strips aria-label, so locate the Send/Stop
  // affordances via the Fa icon's data-icon attribute instead. The icon mocks
  // above render `data-icon="stop"` for the Stop button and
  // `data-icon="paper-plane"` for the Send button.
  function stopButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="stop"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }
  function sendButton(): HTMLButtonElement | null {
    const icons = document.body.querySelectorAll('[data-icon="paper-plane"]');
    for (const icon of icons) {
      const btn = icon.closest('button') as HTMLButtonElement | null;
      // Skip the interrupt-and-send split button inside the Stop block; that
      // button carries data-testid="interrupt-btn".
      if (btn && btn.dataset.testid !== 'interrupt-btn') return btn;
    }
    return null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('shows Send (not Stop) when the agent is idle', () => {
    render(SimpleRichInput, { props: baseProps() });

    expect(stopButton()).toBeNull();
    expect(sendButton()).not.toBeNull();
  });

  it('shows Stop when isResponding is true (pre-first-chunk processing window)', () => {
    render(SimpleRichInput, { props: { ...baseProps(), isResponding: true } });

    expect(stopButton()).not.toBeNull();
    expect(sendButton()).toBeNull();
  });

  it('shows Stop when isStreaming is true (assistant chunks arriving)', () => {
    render(SimpleRichInput, { props: { ...baseProps(), isStreaming: true } });

    expect(stopButton()).not.toBeNull();
    expect(sendButton()).toBeNull();
  });

  it('shows Send (not Stop) when only the broader running signal would be true, IDLE-1', () => {
    // A coordinator whose own turn has ended but is still waiting on delegated
    // children clears `isStreaming` / `isResponding` in the agent-session slice
    // (PROTOCOL §5.5 isWaitingForOtherAgents is a separate BE-authoritative flag,
    // no longer plumbed into this component). There is no turn to stop in that
    // state — Send must be the visible affordance.
    render(SimpleRichInput, { props: { ...baseProps() } });

    expect(stopButton()).toBeNull();
    expect(sendButton()).not.toBeNull();
  });

  it('reverts to Send when all responding signals go false (agent:idle)', async () => {
    const { rerender } = render(SimpleRichInput, {
      props: { ...baseProps(), isResponding: true, isStreaming: true },
    });
    expect(stopButton()).not.toBeNull();

    await rerender({
      ...baseProps(),
      isResponding: false,
      isStreaming: false,
    });

    await waitFor(() => {
      expect(stopButton()).toBeNull();
      expect(sendButton()).not.toBeNull();
    });
  });

  it('invokes onstop when the Stop button is clicked while responding', async () => {
    const onstop = vi.fn();
    render(SimpleRichInput, { props: { ...baseProps(), isResponding: true, onstop } });

    const btn = stopButton();
    expect(btn).not.toBeNull();
    await fireEvent.click(btn!);

    expect(onstop).toHaveBeenCalledTimes(1);
  });
});

describe('SimpleRichInput enhance-button provider gate (§5.31)', () => {
  const baseProps = () => ({
    value: 'make this prompt better',
    contextItems: [],
    workspace: {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any,
    agentId: 'agent-1',
    selectedModel: 'gpt5.4',
  });

  // The mocked Button strips aria-label — locate the enhance affordance via
  // the Fa icon mock's data-icon attribute (faMagicWandSparkles → magic-wand).
  function enhanceButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="magic-wand"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    enhancePromptMock.mockResolvedValue({
      enhanced: 'enhanced prompt',
      original: 'make this prompt better',
      mode: 'enhance',
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    addMockSession('ws-1', createSession());
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    mockReduxState.providerSettings.activeProviderId = '';
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('shows the enhance button when the active provider is auggie', () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    render(SimpleRichInput, { props: baseProps() });

    expect(enhanceButton()).not.toBeNull();
  });

  it('shows the enhance button when no active provider is set (daemon default is auggie)', () => {
    mockReduxState.providerSettings.activeProviderId = '';
    render(SimpleRichInput, { props: baseProps() });

    expect(enhanceButton()).not.toBeNull();
  });

  it('hides the enhance button when the active provider is not auggie', () => {
    mockReduxState.providerSettings.activeProviderId = 'codex';
    render(SimpleRichInput, { props: baseProps() });

    expect(enhanceButton()).toBeNull();
  });

  it('ignores the Cmd+/ enhance shortcut when the active provider is not auggie', async () => {
    mockReduxState.providerSettings.activeProviderId = 'codex';
    render(SimpleRichInput, { props: baseProps() });

    window.dispatchEvent(new CustomEvent('chat:enhance-prompt'));

    await waitFor(() => {
      expect(enhancePromptMock).not.toHaveBeenCalled();
    });
  });

  it('runs the Cmd+/ enhance shortcut when the active provider is auggie', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    render(SimpleRichInput, { props: baseProps() });

    window.dispatchEvent(new CustomEvent('chat:enhance-prompt'));

    await waitFor(() => {
      expect(enhancePromptMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('SimpleRichInput input lock while enhancing', () => {
  const baseProps = () => ({
    value: 'make this prompt better',
    contextItems: [],
    workspace: {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any,
    agentId: 'agent-1',
    selectedModel: 'gpt5.4',
  });

  function editorTextarea(): HTMLTextAreaElement {
    return screen.getByTestId('tiptap-editor') as HTMLTextAreaElement;
  }

  // The mocked Button strips aria-label — locate affordances via the Fa icon
  // mock's data-icon attribute.
  function enhanceButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="magic-wand"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  function stopEnhanceButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="stop"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  function sendButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="paper-plane"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    addMockSession('ws-1', createSession());
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    mockReduxState.providerSettings.activeProviderId = '';
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('disables the editor and send button while enhancing and restores them on success', async () => {
    let resolveEnhance!: (value: unknown) => void;
    enhancePromptMock.mockImplementation(
      () => new Promise((resolve) => { resolveEnhance = resolve; }),
    );
    render(SimpleRichInput, { props: baseProps() });

    expect(editorTextarea().disabled).toBe(false);
    expect(sendButton()!.disabled).toBe(false);

    await fireEvent.click(enhanceButton()!);

    await waitFor(() => expect(editorTextarea().disabled).toBe(true));
    expect(sendButton()!.disabled).toBe(true);

    resolveEnhance({
      enhanced: 'enhanced prompt',
      original: 'make this prompt better',
      mode: 'enhance',
    });

    await waitFor(() => expect(editorTextarea().disabled).toBe(false));
    expect(sendButton()!.disabled).toBe(false);
  });

  it('restores editability and submission when enhancement fails', async () => {
    let rejectEnhance!: (error: unknown) => void;
    enhancePromptMock.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectEnhance = reject; }),
    );
    render(SimpleRichInput, { props: baseProps() });

    await fireEvent.click(enhanceButton()!);
    await waitFor(() => expect(editorTextarea().disabled).toBe(true));

    rejectEnhance(new Error('enhance failed'));

    await waitFor(() => expect(editorTextarea().disabled).toBe(false));
    expect(sendButton()!.disabled).toBe(false);
  });

  it('keeps the cancel-enhance button clickable and restores editability on cancel', async () => {
    enhancePromptMock.mockImplementation(() => new Promise(() => {}));
    render(SimpleRichInput, { props: baseProps() });

    await fireEvent.click(enhanceButton()!);
    await waitFor(() => expect(editorTextarea().disabled).toBe(true));

    const stopButton = stopEnhanceButton();
    expect(stopButton).not.toBeNull();
    expect(stopButton!.disabled).toBe(false);

    await fireEvent.click(stopButton!);

    await waitFor(() => expect(editorTextarea().disabled).toBe(false));
    expect(sendButton()!.disabled).toBe(false);
  });

  it('blocks submission while enhancing even if the click handler fires', async () => {
    enhancePromptMock.mockImplementation(() => new Promise(() => {}));
    const onsubmit = vi.fn();
    render(SimpleRichInput, { props: { ...baseProps(), onsubmit } });

    await fireEvent.click(enhanceButton()!);
    await waitFor(() => expect(editorTextarea().disabled).toBe(true));

    await fireEvent.click(sendButton()!);
    expect(onsubmit).not.toHaveBeenCalled();
  });
});

describe('SimpleRichInput mic-button visibility (effective voice engine)', () => {
  const baseProps = () => ({
    value: '',
    contextItems: [],
    workspace: {
      id: 'ws-1',
      name: 'Workspace',
      path: '/tmp/workspace',
      createdAt: new Date().toISOString(),
    } as any,
    agentId: 'agent-1',
    selectedModel: 'gpt5.4',
  });

  // The mocked Button strips data-testid/aria-label — locate the mic
  // affordance via the Fa icon mock's data-icon (faMicrophone → microphone).
  function micButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="microphone"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    addMockSession('ws-1', createSession());
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    mockReduxState.voiceSettings = {
      isLoading: false,
      engine: 'daemon',
      osEngineAvailable: false,
      provider: 'elevenlabs',
      keyConfigured: { elevenlabs: true, openai: false },
    };
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders the mic button when the daemon key is configured', () => {
    render(SimpleRichInput, { props: baseProps() });
    expect(micButton()).not.toBeNull();
  });

  it('renders the mic button when the key is missing but the OS engine exists (macOS fallback)', () => {
    mockReduxState.voiceSettings.keyConfigured = { elevenlabs: false, openai: false };
    mockReduxState.voiceSettings.osEngineAvailable = true;
    render(SimpleRichInput, { props: baseProps() });
    expect(micButton()).not.toBeNull();
  });

  it('hides the mic button when no engine can transcribe at all (no key, no OS dictation)', () => {
    mockReduxState.voiceSettings.keyConfigured = { elevenlabs: false, openai: false };
    mockReduxState.voiceSettings.osEngineAvailable = false;
    render(SimpleRichInput, { props: baseProps() });
    expect(micButton()).toBeNull();
  });

  it('keeps the mic button while the initial settings read is loading (never hide on unsettled state)', () => {
    mockReduxState.voiceSettings.isLoading = true;
    mockReduxState.voiceSettings.keyConfigured = { elevenlabs: false, openai: false };
    render(SimpleRichInput, { props: baseProps() });
    expect(micButton()).not.toBeNull();
  });
});

describe('SimpleRichInput mic-button cancel-while-transcribing', () => {
  // The transcribing spinner button (located via the Fa mock's data-icon).
  function transcribingButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="spinner"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    addMockSession('ws-1', createSession());
    mockReduxState.hardwareConsole.voiceTranscribing = true;
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    mockReduxState.hardwareConsole.voiceTranscribing = false;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders an enabled cancel control (not a disabled spinner) while transcribing', async () => {
    const { m } = await import('$shared/paraglide/messages.js');
    render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        workspace: {
          id: 'ws-1',
          name: 'Workspace',
          path: '/tmp/workspace',
          createdAt: new Date().toISOString(),
        } as any,
        agentId: 'agent-1',
        selectedModel: 'gpt5.4',
      },
    });
    const button = transcribingButton();
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    expect(button!.getAttribute('aria-label')).toBe(
      m.chat_richInput_micCancelTranscribing_label(),
    );
  });

  it('clicking the cancel control abandons the in-flight transcription session', async () => {
    const { beginTranscriptionSession, hasActiveTranscriptionSession, resetTranscriptionCancellation } =
      await import('$features/hardware-console/voice/transcription-cancellation');
    const onCancel = vi.fn();
    beginTranscriptionSession(onCancel);

    render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        workspace: {
          id: 'ws-1',
          name: 'Workspace',
          path: '/tmp/workspace',
          createdAt: new Date().toISOString(),
        } as any,
        agentId: 'agent-1',
        selectedModel: 'gpt5.4',
      },
    });
    await fireEvent.click(transcribingButton()!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(hasActiveTranscriptionSession()).toBe(false);
    resetTranscriptionCancellation();
  });
});

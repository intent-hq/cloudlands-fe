import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';

vi.mock('$lib/components/shared/icons/FaWrapper.svelte', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/icons/phosphor-icons', () => ({
  faFile: { iconName: 'file' },
  faFileAlt: { iconName: 'file-alt' },
  faFileCode: { iconName: 'file-code' },
  faImage: { iconName: 'image' },
  faMagicWandSparkles: { iconName: 'magic-wand' },
  faMicrophone: { iconName: 'microphone' },
  faPaperclip: { iconName: 'paperclip' },
  faArrowRight: { iconName: 'arrow-right' },
  faSpinner: { iconName: 'spinner' },
  faXmark: { iconName: 'xmark' },
  faLayerGroup: { iconName: 'layer-group' },
  faStop: { iconName: 'stop' },
  faCheck: { iconName: 'check' },
  faChevronRight: { iconName: 'chevron-right' },
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
  faPlus: { iconName: 'plus' },
  faClock: { iconName: 'clock' },
  faWandMagicSparkles: { iconName: 'wand-magic-sparkles' },
  faRotateLeft: { iconName: 'rotate-left' },
  faAt: { iconName: 'at' },
  // Placement lifecycle pill icons (placing spinner / failed + retry)
  faCircleExclamation: { iconName: 'circle-exclamation' },
  faRotateRight: { iconName: 'rotate-right' },
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

const toggleComposerMicRecordingMock = vi.hoisted(() => vi.fn(() => 'started'));
const isComposerMicRecordingMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('$features/hardware-console/voice/composer-mic-controller', () => ({
  toggleComposerMicRecording: toggleComposerMicRecordingMock,
  isComposerMicRecording: isComposerMicRecordingMock,
  cancelComposerMicRecording: vi.fn(() => false),
  resetComposerMic: vi.fn(),
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
      label:
        providerId === 'auggie'
          ? 'Augment Auggie'
          : providerId === 'codex'
            ? 'OpenAI Codex'
            : providerId,
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
const reconcileAgentReasoningEffortMock = vi.hoisted(() => vi.fn(async () => true));
const modelEffortLevels = vi.hoisted(() => ({}) as Record<string, string[] | undefined>);
const agentModelEffortLevels = vi.hoisted(() => ({ value: undefined as string[] | undefined }));

vi.mock('$features/agent/agent.client', () => ({
  agentClient: {
    setModel: setModelMock,
  },
}));

vi.mock('$features/agent/reasoning-effort', () => ({
  reconcileAgentReasoningEffort: reconcileAgentReasoningEffortMock,
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAgentModelEffortLevels: () => readable(agentModelEffortLevels.value),
  selectModelEffortLevels: {
    select: (_state: unknown, modelId: string) => modelEffortLevels[modelId],
  },
}));

const enhancePromptMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/client/live/live-prompt-enhancement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/client/live/live-prompt-enhancement')>();
  return { ...actual, enhancePrompt: enhancePromptMock };
});

const placeAttachmentMock = vi.hoisted(() => vi.fn());

vi.mock('./attachment-placement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./attachment-placement')>();
  return { ...actual, placeAttachmentViaTransport: placeAttachmentMock };
});

// Mock Redux store bridge — the component reads agent sessions from Redux
const mockReduxState = vi.hoisted(
  (): {
    workspaceAgents: { byWorkspaceId: Record<string, any> };
    providerSettings: { activeProviderId: string };
    readonly model: { defaultProviderId: string };
    hardwareConsole: { pttRecording: boolean; voiceTranscribing: boolean };
    skills: {
      byWorkspaceId: Record<
        string,
        {
          skills: Array<{ name: string; description: string; location: string }>;
          loading: boolean;
          error: string | null;
        }
      >;
    };
    voiceSettings: {
      isLoading: boolean;
      engine: string;
      osEngineAvailable: boolean;
      provider: string;
      keyConfigured: Record<string, boolean>;
    };
    providerCatalog?: unknown;
    daemonHealth: { hostLocality: 'local' | 'remote' | null; transport: unknown };
  } => ({
    workspaceAgents: { byWorkspaceId: {} },
    // Unset default provider — the §5.31 gate resolves CLOSED for ''.
    // Tests mutate providerSettings.activeProviderId; the model slice
    // (where selectActiveProviderId reads from) mirrors it via this getter.
    providerSettings: { activeProviderId: '' },
    get model() {
      return { defaultProviderId: this.providerSettings.activeProviderId };
    },
    // The composer mic button subscribes to these hardware-console flags
    hardwareConsole: { pttRecording: false, voiceTranscribing: false },
    skills: { byWorkspaceId: {} },
    // The oversized-attachment placement flow reads daemon locality to pick
    // the sourcePath fast path vs. the wire data variant
    daemonHealth: { hostLocality: null, transport: null },
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
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  // The input resolves provider ids/display names via the providerCatalog
  // slice — hydrate the §5.38-shaped mock catalog into the mocked state.
  const { initialState, providerCatalogLoaded, providerCatalogReducer } =
    await import('$store/renderer/slices/provider-catalog/provider-catalog-slice');
  const { MOCK_PROVIDER_CATALOG } =
    await import('../../../../test/fixtures/provider-catalog.fixture');
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
  selectAgentReasoningEffort: () => readable(undefined),
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

describe('SimpleRichInput workspace skills', () => {
  afterEach(() => {
    cleanup();
    mockReduxState.skills.byWorkspaceId = {};
  });

  it('follows workspace changes and live Redux skill updates', async () => {
    mockReduxState.skills.byWorkspaceId = {
      'ws-1': {
        skills: [{ name: 'review', description: 'Review', location: '/skills/review' }],
        loading: false,
        error: null,
      },
      'ws-2': {
        skills: [{ name: 'research', description: 'Research', location: '/skills/research' }],
        loading: true,
        error: null,
      },
    };
    const workspace = (id: string) => ({ id, path: `/tmp/${id}` }) as any;
    const view = render(SimpleRichInput, {
      props: { value: '', contextItems: [], workspace: workspace('ws-1') },
    });
    const editor = screen.getByTestId('tiptap-editor');
    expect(editor.getAttribute('data-skills')).toBe('review');

    await view.rerender({ value: '', contextItems: [], workspace: workspace('ws-2') });
    const { store } = await import('$store/renderer/store');
    (store as typeof store & { emitState: () => void }).emitState();
    await waitFor(() => expect(editor.getAttribute('data-skills')).toBe('research'));
    expect(editor.getAttribute('data-skills-loading')).toBe('true');

    mockReduxState.skills.byWorkspaceId['ws-2'] = {
      skills: [{ name: 'audit', description: 'Audit', location: '/skills/audit' }],
      loading: false,
      error: 'refresh failed',
    };
    (store as typeof store & { emitState: () => void }).emitState();

    await waitFor(() => expect(editor.getAttribute('data-skills')).toBe('audit'));
    expect(editor.getAttribute('data-skills-loading')).toBe('false');
    expect(editor.getAttribute('data-skills-error')).toBe('refresh failed');
  });
});

describe('SimpleRichInput draft change notification', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('reports each editor update synchronously', async () => {
    const onvaluechange = vi.fn();
    render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        onvaluechange,
      },
    });

    await fireEvent.input(screen.getByTestId('tiptap-editor'), {
      target: { value: 'draft that must survive remounts' },
    });

    expect(onvaluechange).toHaveBeenLastCalledWith('draft that must survive remounts');
  });

  it('keeps the localized placeholder mounted while focus toggles its fade state', async () => {
    render(SimpleRichInput, { props: { value: '', contextItems: [] } });
    const editor = screen.getByTestId('tiptap-editor');
    const editorWrapper = editor.closest('.editor-wrapper');

    expect(editor.getAttribute('placeholder')).toBe('Ask anything');
    expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(true);
    await fireEvent.focusIn(editor);
    expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(false);
    await fireEvent.focusOut(editor);
    expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(true);
    expect(editor.getAttribute('placeholder')).toBe('Ask anything');
  });
});

describe('SimpleRichInput image paste', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('adds a pasted image thumbnail without entering a reactive update loop', async () => {
    render(SimpleRichInput, { props: { value: '', contextItems: [] } });
    const file = new File(['image-bytes'], 'pasted.png', { type: 'image/png' });

    await fireEvent.paste(screen.getByTestId('message-input'), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(await screen.findByRole('img', { name: 'pasted.png' })).toBeTruthy();
  });
});

describe('SimpleRichInput external drop target (ChatPanel full-panel drop zone)', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  function makeFileDropEvent(files: File[]) {
    return {
      dataTransfer: { types: ['Files'], files },
    };
  }

  it('handleDroppedFiles forwards files into the attach pipeline like a direct drop', async () => {
    const { component } = render(SimpleRichInput, { props: { value: '', contextItems: [] } });
    const file = new File(['image-bytes'], 'dropped.png', { type: 'image/png' });

    await component.handleDroppedFiles([file]);

    expect(await screen.findByRole('img', { name: 'dropped.png' })).toBeTruthy();
  });

  it('disables the container drop handlers when externalDropTarget is set', async () => {
    render(SimpleRichInput, {
      props: { value: '', contextItems: [], externalDropTarget: true },
    });
    const file = new File(['image-bytes'], 'ignored.png', { type: 'image/png' });

    await fireEvent.drop(screen.getByTestId('message-input'), makeFileDropEvent([file]));

    expect(screen.queryByRole('img', { name: 'ignored.png' })).toBeNull();
  });

  it('keeps local drop handling when externalDropTarget is not set', async () => {
    render(SimpleRichInput, { props: { value: '', contextItems: [] } });
    const file = new File(['image-bytes'], 'local.png', { type: 'image/png' });

    await fireEvent.drop(screen.getByTestId('message-input'), makeFileDropEvent([file]));

    expect(await screen.findByRole('img', { name: 'local.png' })).toBeTruthy();
  });
});

describe('SimpleRichInput action bar layout', () => {
  afterEach(() => {
    agentModelEffortLevels.value = undefined;
    cleanup();
    document.body.innerHTML = '';
  });

  it('delegates reasoning effort to the model picker without a standalone control', () => {
    agentModelEffortLevels.value = ['low', 'high'];
    render(SimpleRichInput, {
      props: {
        value: '',
        contextItems: [],
        agentId: 'agent-1',
        workspace: { id: 'ws-1' } as any,
      },
    });

    expect(screen.getByTestId('model-picker').getAttribute('data-show-reasoning')).toBe('true');
    expect(screen.queryByTestId('effort-picker-trigger')).toBeNull();
  });

  it('affirms nested composer menus in every required visual state', async () => {
    const observed = await exerciseVisualStates(() => {
      const view = render(SimpleRichInput, { props: { value: '', contextItems: [] } });
      const target = view.getByTestId('prompt-actions-trigger');
      return {
        ...view,
        target,
        assertCapability: () => {
          const primaryActions = view.container.querySelector('[data-chat-input-primary-actions]');
          const submitActions = view.container.querySelector('[data-chat-input-submit-actions]');
          expect(primaryActions?.contains(target)).toBe(false);
          expect(submitActions?.contains(target)).toBe(true);
          expect(view.getByTestId('message-input').className).toContain('focus-within:border-ring');
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('keeps the model left and places the prompt menu before dictation on the right', async () => {
    const { container } = render(SimpleRichInput, {
      props: { value: '', contextItems: [] },
    });

    const actionBar = container.querySelector('[data-chat-input-action-bar]');
    const primaryActions = container.querySelector('[data-chat-input-primary-actions]');
    const submitActions = container.querySelector('[data-chat-input-submit-actions]');
    const promptMenu = screen.getByTestId('prompt-actions-trigger');
    const micButton = screen.getByTestId('composer-mic-button');

    expect(actionBar?.className).toContain('items-center');
    expect(actionBar?.className).toContain('pr-1.5!');
    expect(primaryActions?.className).toContain('items-center');
    expect(submitActions?.className).toContain('items-center');
    expect(submitActions?.className).toContain('gap-1');
    expect(submitActions?.className).not.toContain('gap-px');
    expect(submitActions?.querySelector('.mr-1')).toBeNull();
    expect(primaryActions?.contains(promptMenu)).toBe(false);
    expect(submitActions?.contains(promptMenu)).toBe(true);
    expect(
      promptMenu.compareDocumentPosition(micButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(promptMenu.dataset.size).toBe('icon-sm');
    expect(promptMenu.querySelector('[data-icon="plus"]')).toBeTruthy();
    expect(submitActions?.contains(micButton)).toBe(true);
    await fireEvent.click(promptMenu);
    expect(await screen.findByRole('menuitem', { name: /Add Context/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Attach files/i })).toBeTruthy();
    const modelPickerClass = screen.getByTestId('model-picker').className;
    expect(modelPickerClass).toContain('px-0');
    expect(modelPickerClass).toContain('font-medium');
    expect(modelPickerClass).toContain('hover:bg-transparent');
    expect(screen.getByTestId('message-input').className).toContain('focus-within:border-ring');
    expect(screen.getByTestId('message-input').className).toContain('focus-within:ring-0');
    expect(screen.getByTestId('message-input').className).not.toContain('focus-within:ring-2');
  });

  it('uses the nested sidebar surface only when edge-docked', () => {
    render(SimpleRichInput, {
      props: { value: '', contextItems: [], edgeDocked: true },
    });

    const edgeDockedInput = screen.getByTestId('message-input');
    expect(edgeDockedInput.className).toContain('rounded-lg');
    expect(edgeDockedInput.className).toContain('border-0');
    expect(edgeDockedInput.className).toContain('bg-sidebar');
    expect(edgeDockedInput.className).not.toContain('bg-transparent');
    expect(document.querySelector('[data-chat-input-action-bar]')?.className).toContain(
      'flex-wrap',
    );
    expect(document.querySelector('[data-chat-input-submit-actions]')?.className).toContain(
      'justify-end',
    );

    cleanup();
    render(SimpleRichInput, { props: { value: '', contextItems: [] } });
    const standaloneInput = screen.getByTestId('message-input');
    expect(standaloneInput.className).toContain('border-border');
    expect(standaloneInput.className).not.toContain('bg-sidebar');
    expect(document.querySelector('[data-chat-input-action-bar]')?.className).not.toContain(
      'flex-wrap',
    );
    expect(document.querySelector('[data-chat-input-submit-actions]')?.className).toContain(
      'shrink-0',
    );
  });
});

describe('SimpleRichInput provider switch sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const modelId of Object.keys(modelEffortLevels)) delete modelEffortLevels[modelId];
    resolveCompatibleModelForProviderMock.mockResolvedValue('codex:gpt-5-codex');
    setModelMock.mockResolvedValue({
      ok: true,
      data: { success: true, modelId: 'codex:gpt-5-codex' },
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
    addMockSession(
      'ws-1',
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
    addMockSession(
      'ws-1',
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
    expect(modelPicker.getAttribute('data-show-reasoning')).toBe('true');
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
      expect(setModelMock).toHaveBeenCalledWith('agent-1', 'codex:gpt-5-codex', 'ws-1', 'codex');
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

    removeMockSession('ws-1', 'agent-1');
    addMockSession('ws-1', createSession({ reasoningEffort: 'xhigh' }));
    modelEffortLevels['codex:gpt-5-codex'] = ['low', 'high'];

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

    // The explicit target provider rides along as the 4th wire arg so the
    // daemon validates the model against it, not the session's provider.
    expect(setModelMock).toHaveBeenCalledWith('agent-1', 'codex:gpt-5-codex', 'ws-1', 'codex');
    expect(reconcileAgentReasoningEffortMock).toHaveBeenCalledWith('agent-1', 'ws-1', 'xhigh', [
      'low',
      'high',
    ]);
    expect(onmodelChange).toHaveBeenCalledWith('codex:gpt-5-codex');
  });

  it('treats default-provider aliases as the same provider during model selection', async () => {
    // Alias healing ('augment' → the effective default row) requires a
    // designated default — the unresolved '' state never adopts a row.
    mockReduxState.providerSettings.activeProviderId = 'auggie';
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
    addMockSession(
      'ws-1',
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
  const readyAttachment = () => ({
    id: 'attachment-1',
    type: 'file' as const,
    label: 'dump.har',
    attachmentId: 'att-uuid-1',
    attachmentMimeType: 'application/json',
    placementStatus: 'placed' as const,
  });

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
  // `data-icon="arrow-right"` for the Send button.
  function stopButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="stop"]');
    return (icon?.closest('button') as HTMLButtonElement | null) ?? null;
  }
  function sendButton(): HTMLButtonElement | null {
    const icons = document.body.querySelectorAll('[data-icon="arrow-right"]');
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

  it.each([
    { mode: 'text-only', value: 'follow up', contextItems: [] },
    { mode: 'attachment-only', value: '', contextItems: [readyAttachment()] },
    { mode: 'mixed', value: 'follow up', contextItems: [readyAttachment()] },
  ])(
    'submits $mode content through the accessible Send action',
    async ({ value, contextItems }) => {
      const onsubmit = vi.fn();
      render(SimpleRichInput, {
        props: { ...baseProps(), value, contextItems, onsubmit },
      });

      const send = screen.getByRole('button', { name: 'Send message' });
      expect((send as HTMLButtonElement).disabled).toBe(false);
      await fireEvent.click(send);
      expect(onsubmit).toHaveBeenCalledWith(value);
    },
  );

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

  it('uses the same muted treatment for prompt controls and Stop', () => {
    render(SimpleRichInput, { props: { ...baseProps(), isResponding: true } });

    expect(document.querySelector('[data-chat-input-action-bar]')?.className).toContain(
      'text-muted-foreground',
    );
    expect(screen.getByTestId('model-picker').className).toContain('text-muted-foreground');
    expect(stopButton()?.dataset.variant).toBe('ghost-light');
    expect(stopButton()?.className).toContain('text-muted-foreground');
    expect(screen.getByTestId('prompt-actions-trigger').dataset.variant).toBe('ghost-light');
  });

  it.each([
    { mode: 'text-only', value: 'follow up', contextItems: [] },
    { mode: 'attachment-only', value: '', contextItems: [readyAttachment()] },
    { mode: 'mixed', value: 'follow up', contextItems: [readyAttachment()] },
  ])(
    'renders accessible Queue and Interrupt actions while responding with $mode content',
    async ({ value, contextItems }) => {
      const onsubmit = vi.fn();
      const onforcesubmit = vi.fn();
      render(SimpleRichInput, {
        props: {
          ...baseProps(),
          value,
          contextItems,
          isResponding: true,
          onsubmit,
          onforcesubmit,
        },
      });

      const queue = screen.getByRole('button', { name: 'Queue message' });
      const send = screen.getByRole('button', { name: 'Interrupt and send' });
      expect(queue?.dataset.variant).toBe('ghost-light');
      expect(send?.dataset.variant).toBe('ghost-light');
      expect(queue?.parentElement?.className).not.toContain('bg-sidebar');

      await fireEvent.click(queue!);
      await fireEvent.click(send!);
      expect(onsubmit).toHaveBeenCalledWith(value);
      expect(onforcesubmit).toHaveBeenCalledWith(value);
    },
  );

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

  it('ignores Escape while responding and invokes onstop from the Stop button', async () => {
    const onstop = vi.fn();
    render(SimpleRichInput, { props: { ...baseProps(), isResponding: true, onstop } });

    await fireEvent.keyDown(screen.getByTestId('tiptap-editor'), { key: 'Escape' });
    expect(onstop).not.toHaveBeenCalled();

    const btn = stopButton();
    expect(btn).not.toBeNull();
    await fireEvent.click(btn!);

    expect(onstop).toHaveBeenCalledTimes(1);
  });
});

describe('SimpleRichInput automatic composer geometry', () => {
  const props = {
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
  };

  function renderInPanel(height: number, overrides: Record<string, unknown> = {}) {
    const panel = document.createElement('div');
    panel.className = 'group/panel';
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: height });
    document.body.append(panel);
    return render(SimpleRichInput, { target: panel, props: { ...props, ...overrides } });
  }

  // Mirrors the real ResizeObserver: an initial callback is delivered
  // asynchronously after observe() with the current size — the component
  // relies on it instead of a synchronous clientHeight read (forced reflow).
  class MockResizeObserver {
    static instances: MockResizeObserver[] = [];
    callback: ResizeObserverCallback;
    observed: Element[] = [];
    disconnected = false;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      MockResizeObserver.instances.push(this);
    }
    observe(target: Element) {
      this.observed.push(target);
      queueMicrotask(() => {
        if (!this.disconnected) this.fire(target, (target as HTMLElement).clientHeight);
      });
    }
    fire(target: Element, height: number) {
      this.callback(
        [{ target, contentRect: { height } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    MockResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    addMockSession('ws-1', createSession());
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps 56px on focus, expands to 65px for content, and collapses when cleared', async () => {
    renderInPanel(560);
    const editor = screen.getByTestId('tiptap-editor');
    const composer = screen.getByTestId('message-input');
    const editorWrapper = editor.closest('.editor-wrapper');

    await waitFor(() => {
      expect(composer.getAttribute('style')).toContain('min-height: 56px');
    });
    expect(editor.getAttribute('placeholder')).toBe('Ask anything');
    expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(true);
    expect(composer.className).toContain(
      'transition-[border-color,background-color,box-shadow,min-height]',
    );
    expect(composer.className).toContain('duration-(--motion-fast)');
    expect(composer.className).toContain('ease-(--ease-standard)');
    expect(composer.className).toContain('motion-reduce:transition-none');

    await fireEvent.focusIn(editor);
    expect(composer.getAttribute('style')).toContain('min-height: 56px');
    expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(false);

    await fireEvent.input(editor, { target: { value: 'draft' } });
    await waitFor(() => expect(composer.getAttribute('style')).toContain('min-height: 65px'));
    await fireEvent.input(editor, { target: { value: '' } });
    await waitFor(() => expect(composer.getAttribute('style')).toContain('min-height: 56px'));
  });

  it('keeps 80px on focus, expands to 100px for content, and collapses when cleared', async () => {
    renderInPanel(720);
    const editor = screen.getByTestId('tiptap-editor');
    const composer = screen.getByTestId('message-input');
    const editorWrapper = editor.closest('.editor-wrapper');

    await waitFor(() => {
      expect(composer.getAttribute('style')).toContain('min-height: 80px');
    });
    await fireEvent.focusIn(editor);
    expect(composer.getAttribute('style')).toContain('min-height: 80px');
    expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(false);

    await fireEvent.input(editor, { target: { value: 'draft' } });
    await waitFor(() => expect(composer.getAttribute('style')).toContain('min-height: 100px'));
    await fireEvent.input(editor, { target: { value: '' } });
    await waitFor(() => expect(composer.getAttribute('style')).toContain('min-height: 80px'));

    await fireEvent.focusOut(editor);
    expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(true);
  });

  it('settles rapid focus changes at the idle automatic height', async () => {
    renderInPanel(720);
    const editor = screen.getByTestId('tiptap-editor');
    const composer = screen.getByTestId('message-input');

    await waitFor(() => expect(composer.getAttribute('style')).toContain('min-height: 80px'));
    await fireEvent.focusIn(editor);
    await fireEvent.focusOut(editor);
    await fireEvent.focusIn(editor);

    await waitFor(() => expect(composer.getAttribute('style')).toContain('min-height: 80px'));
    expect(editor.closest('.editor-wrapper')?.classList.contains('placeholder-hidden')).toBe(false);
  });

  it.each([
    { mode: 'draft', overrides: { value: 'preserved draft' } },
    {
      mode: 'context',
      overrides: { contextItems: [{ id: 'note-1', type: 'note', label: 'Spec' }] },
    },
    {
      mode: 'attachment',
      overrides: {
        contextItems: [
          {
            id: 'attachment-1',
            type: 'file',
            label: 'trace.json',
            attachmentId: 'att-1',
            placementStatus: 'placed',
          },
        ],
      },
    },
  ])(
    'keeps active geometry without an empty-state placeholder for $mode content',
    async ({ overrides }) => {
      renderInPanel(720, overrides);

      await waitFor(() => {
        expect(screen.getByTestId('message-input').getAttribute('style')).toContain(
          'min-height: 100px',
        );
      });
      expect(screen.getByTestId('tiptap-editor').getAttribute('placeholder')).toBe('Ask anything');
    },
  );

  it('keeps a manual resize when focus changes', async () => {
    renderInPanel(720);
    const composer = screen.getByTestId('message-input');
    const editor = screen.getByTestId('tiptap-editor');
    const editorWrapper = composer.querySelector('.editor-wrapper');
    Object.defineProperty(composer, 'offsetHeight', { configurable: true, value: 80 });

    const resizeHandle = screen.getByRole('button', { name: /Resize input area/ });
    await fireEvent.mouseDown(resizeHandle, {
      clientY: 100,
    });
    await waitFor(() => expect(resizeHandle.getAttribute('data-resizing')).toBe('true'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 50 }));
    await waitFor(() => expect(composer.getAttribute('style')).toContain('height: 130px'));
    await fireEvent.mouseUp(document);

    await fireEvent.focusIn(editor);
    expect(composer.getAttribute('style')).toContain('height: 130px');
    expect(composer.getAttribute('style')).not.toContain('min-height');
    expect(composer.className).toContain('transition-[border-color,background-color,box-shadow]');
    expect(composer.className).not.toContain('box-shadow,min-height');
    expect(editorWrapper?.className).toContain('pt-1');
  });

  it('affirms idle and focused geometry in every required visual state', async () => {
    const observed = await exerciseVisualStates(async (configuration) => {
      const height = configuration.width < 500 ? 560 : 720;
      const view = renderInPanel(height);
      const composer = view.getByTestId('message-input');
      const editor = view.getByTestId('tiptap-editor');
      const editorWrapper = composer.querySelector('.editor-wrapper');
      const idleHeight = height > 640 ? 80 : 56;
      const activeHeight = height > 640 ? 100 : 65;

      await waitFor(() => {
        expect(composer.getAttribute('style')).toContain(`min-height: ${idleHeight}px`);
      });
      expect(editor.getAttribute('placeholder')).toBe('Ask anything');
      expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(true);
      expect(editorWrapper?.className).toContain('pt-1');

      return {
        ...view,
        target: editor,
        assertCapability: async () => {
          expect(composer.getAttribute('style')).toContain(`min-height: ${idleHeight}px`);
          expect(editorWrapper?.classList.contains('placeholder-hidden')).toBe(false);
          await fireEvent.input(editor, { target: { value: 'draft' } });
          await waitFor(() => {
            expect(composer.getAttribute('style')).toContain(`min-height: ${activeHeight}px`);
          });
          expect(editorWrapper?.className).toContain('pt-1');
          expect(composer.className).toContain('motion-reduce:transition-none');
        },
      };
    });

    expect(observed).toEqual(configuredVisualStates);
  });

  it('sets up one panel observer and resizes update geometry without recreating it', async () => {
    renderInPanel(560);
    const composer = screen.getByTestId('message-input');

    // The observer's initial callback (no synchronous clientHeight read)
    // seeds the panel height.
    await waitFor(() => {
      expect(composer.getAttribute('style')).toContain('min-height: 56px');
    });
    expect(MockResizeObserver.instances).toHaveLength(1);
    const observer = MockResizeObserver.instances[0];
    expect(observer.observed).toHaveLength(1);

    // A panel resize flows through the same observer — no teardown/recreate,
    // no re-observe — while parentPanelHeight-derived geometry updates.
    observer.fire(observer.observed[0], 720);
    await waitFor(() => {
      expect(composer.getAttribute('style')).toContain('min-height: 80px');
    });
    observer.fire(observer.observed[0], 560);
    await waitFor(() => {
      expect(composer.getAttribute('style')).toContain('min-height: 56px');
    });
    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(observer.observed).toHaveLength(1);
    expect(observer.disconnected).toBe(false);
  });
});

describe('SimpleRichInput prompt enhancement menu (§5.31)', () => {
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

  async function openPromptActions() {
    await fireEvent.click(screen.getByTestId('prompt-actions-trigger'));
    await screen.findByRole('menu');
  }

  function startEnhancement() {
    window.dispatchEvent(new CustomEvent('chat:enhance-prompt'));
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

  it('shows Enhance prompt in the kebab menu for auggie', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    render(SimpleRichInput, { props: baseProps() });

    await openPromptActions();
    expect(screen.getByRole('menuitem', { name: /Enhance prompt/i })).toBeTruthy();
    expect(screen.getByText('⌘/')).toBeTruthy();
  });

  it('hides enhancement when no active provider is set', async () => {
    // Mirrors the daemon: unset/undecidable settings resolve the gate
    // CLOSED — never a silent auggie default.
    mockReduxState.providerSettings.activeProviderId = '';
    render(SimpleRichInput, { props: baseProps() });

    await openPromptActions();
    expect(screen.queryByRole('menuitem', { name: /Enhance prompt/i })).toBeNull();
  });

  it('hides enhancement when the active provider is not auggie', async () => {
    mockReduxState.providerSettings.activeProviderId = 'codex';
    render(SimpleRichInput, { props: baseProps() });

    await openPromptActions();
    expect(screen.queryByRole('menuitem', { name: /Enhance prompt/i })).toBeNull();
  });

  it('disables enhancement until the prompt has at least three characters', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    const { rerender } = render(SimpleRichInput, { props: { ...baseProps(), value: 'ab' } });

    await openPromptActions();
    expect(
      screen.getByRole('menuitem', { name: /Enhance prompt/i }).hasAttribute('data-disabled'),
    ).toBe(true);

    await fireEvent.keyDown(document, { key: 'Escape' });
    await rerender({ ...baseProps(), value: 'abc' });
    await openPromptActions();
    expect(
      screen.getByRole('menuitem', { name: /Enhance prompt/i }).hasAttribute('data-disabled'),
    ).toBe(false);
  });

  it('runs enhancement from the menu', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    render(SimpleRichInput, { props: baseProps() });

    await openPromptActions();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Enhance prompt/i }));
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledOnce());
  });

  it('replaces Enhance with Stop enhancing while running', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    let resolveEnhancement: ((value: { enhanced: string }) => void) | undefined;
    enhancePromptMock.mockImplementationOnce(
      () =>
        new Promise<{ enhanced: string }>((resolve) => {
          resolveEnhancement = resolve;
        }),
    );
    render(SimpleRichInput, { props: baseProps() });

    startEnhancement();
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledOnce());
    await openPromptActions();
    const stopEnhancing = screen.getByRole('menuitem', { name: /Stop enhancing/i });
    await fireEvent.click(stopEnhancing);
    expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).disabled).toBe(false);

    resolveEnhancement?.({ enhanced: 'Enhanced prompt' });
  });

  it('cancels enhancement with Escape', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    let resolveEnhancement: ((value: { enhanced: string }) => void) | undefined;
    enhancePromptMock.mockImplementationOnce(
      () =>
        new Promise<{ enhanced: string }>((resolve) => {
          resolveEnhancement = resolve;
        }),
    );
    render(SimpleRichInput, { props: baseProps() });

    startEnhancement();
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledOnce());
    await fireEvent.keyDown(screen.getByTestId('tiptap-editor'), { key: 'Escape' });

    resolveEnhancement?.({ enhanced: 'Enhanced prompt' });
    await Promise.resolve();
    await Promise.resolve();
    expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe(
      'make this prompt better',
    );
  });

  it('keeps every canceled request stale when responses arrive out of order', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    let resolveFirst: ((value: { enhanced: string }) => void) | undefined;
    let resolveSecond: ((value: { enhanced: string }) => void) | undefined;
    enhancePromptMock
      .mockImplementationOnce(
        () =>
          new Promise<{ enhanced: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ enhanced: string }>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    render(SimpleRichInput, { props: baseProps() });

    startEnhancement();
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledTimes(1));
    await fireEvent.keyDown(screen.getByTestId('tiptap-editor'), { key: 'Escape' });

    startEnhancement();
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledTimes(2));
    await fireEvent.keyDown(screen.getByTestId('tiptap-editor'), { key: 'Escape' });

    resolveSecond?.({ enhanced: 'Second late response' });
    await Promise.resolve();
    await Promise.resolve();
    resolveFirst?.({ enhanced: 'First late response' });
    await Promise.resolve();
    await Promise.resolve();

    expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe(
      'make this prompt better',
    );
  });

  it('cancels enhancement when the prompt is deleted', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    let resolveEnhancement: ((value: { enhanced: string }) => void) | undefined;
    enhancePromptMock.mockImplementationOnce(
      () =>
        new Promise<{ enhanced: string }>((resolve) => {
          resolveEnhancement = resolve;
        }),
    );
    render(SimpleRichInput, { props: baseProps() });

    startEnhancement();
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledOnce());
    await fireEvent.input(screen.getByTestId('tiptap-editor'), { target: { value: '' } });

    resolveEnhancement?.({ enhanced: 'Late enhanced prompt' });
    await Promise.resolve();
    await Promise.resolve();
    expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows Undo enhance after success and restores the original prompt', async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    render(SimpleRichInput, { props: baseProps() });

    startEnhancement();
    await waitFor(() => {
      expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe(
        'enhanced prompt',
      );
    });

    await openPromptActions();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Undo enhance/i }));
    expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe(
      'make this prompt better',
    );
  });

  it("ignores a stale toast's Undo after a newer enhancement replaced it", async () => {
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    enhancePromptMock
      .mockResolvedValueOnce({ enhanced: 'first enhanced prompt' })
      .mockResolvedValueOnce({ enhanced: 'second enhanced prompt' });
    render(SimpleRichInput, { props: baseProps() });

    startEnhancement();
    await waitFor(() => {
      expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe(
        'first enhanced prompt',
      );
    });

    const { toast } = await import('svelte-sonner');
    const successMock = toast.success as ReturnType<typeof vi.fn>;
    expect(successMock).toHaveBeenCalledTimes(1);
    const firstToastUndo = successMock.mock.calls[0]![1].action.onClick as () => void;

    startEnhancement();
    await waitFor(() => {
      expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe(
        'second enhanced prompt',
      );
    });
    expect(successMock).toHaveBeenCalledTimes(2);

    // The first toast may still linger on screen: its Undo must no-op, not
    // revert the newer enhancement to the first toast's original prompt.
    firstToastUndo();
    expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe(
      'second enhanced prompt',
    );

    // The current toast's Undo still restores that enhancement's original.
    const secondToastUndo = successMock.mock.calls[1]![1].action.onClick as () => void;
    secondToastUndo();
    await waitFor(() => {
      expect((screen.getByTestId('tiptap-editor') as HTMLTextAreaElement).value).toBe(
        'first enhanced prompt',
      );
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

  function startEnhancement() {
    window.dispatchEvent(new CustomEvent('chat:enhance-prompt'));
  }

  async function stopEnhanceButton(): Promise<HTMLElement> {
    await fireEvent.click(screen.getByTestId('prompt-actions-trigger'));
    return await screen.findByRole('menuitem', { name: /Stop enhancing/i });
  }

  function sendButton(): HTMLButtonElement | null {
    const icon = document.body.querySelector('[data-icon="arrow-right"]');
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
      () =>
        new Promise((resolve) => {
          resolveEnhance = resolve;
        }),
    );
    render(SimpleRichInput, { props: baseProps() });

    expect(editorTextarea().disabled).toBe(false);
    expect(sendButton()!.disabled).toBe(false);

    startEnhancement();

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
      () =>
        new Promise((_resolve, reject) => {
          rejectEnhance = reject;
        }),
    );
    render(SimpleRichInput, { props: baseProps() });

    startEnhancement();
    await waitFor(() => expect(editorTextarea().disabled).toBe(true));

    rejectEnhance(new Error('enhance failed'));

    await waitFor(() => expect(editorTextarea().disabled).toBe(false));
    expect(sendButton()!.disabled).toBe(false);
  });

  it('keeps the cancel-enhance button clickable and restores editability on cancel', async () => {
    enhancePromptMock.mockImplementation(() => new Promise(() => {}));
    render(SimpleRichInput, { props: baseProps() });

    startEnhancement();
    await waitFor(() => expect(editorTextarea().disabled).toBe(true));

    const stopButton = await stopEnhanceButton();
    expect(stopButton).not.toBeNull();
    expect(stopButton.hasAttribute('data-disabled')).toBe(false);

    await fireEvent.click(stopButton);

    await waitFor(() => expect(editorTextarea().disabled).toBe(false));
    expect(sendButton()!.disabled).toBe(false);
  });

  it('blocks submission while enhancing even if the click handler fires', async () => {
    enhancePromptMock.mockImplementation(() => new Promise(() => {}));
    const onsubmit = vi.fn();
    render(SimpleRichInput, { props: { ...baseProps(), onsubmit } });

    startEnhancement();
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
    expect(button!.getAttribute('aria-label')).toBe(m.chat_richInput_micCancelTranscribing_label());
  });

  it('clicking the cancel control abandons the in-flight transcription session', async () => {
    const {
      beginTranscriptionSession,
      hasActiveTranscriptionSession,
      resetTranscriptionCancellation,
    } = await import('$features/hardware-console/voice/transcription-cancellation');
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

describe('SimpleRichInput mic-button focus retention', () => {
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

  function buttonByIcon(icon: string): HTMLButtonElement | null {
    const el = document.body.querySelector(`[data-icon="${icon}"]`);
    return (el?.closest('button') as HTMLButtonElement | null) ?? null;
  }

  // jsdom does not implement the browser's focus-on-mousedown default
  // action — emulate it: focus the button unless the handler prevented the
  // default, then deliver the click.
  async function clickLikeABrowser(button: HTMLButtonElement) {
    const notPrevented = await fireEvent.mouseDown(button);
    if (notPrevented) button.focus();
    await fireEvent.click(button);
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
    mockReduxState.hardwareConsole.pttRecording = false;
    mockReduxState.hardwareConsole.voiceTranscribing = false;
    isComposerMicRecordingMock.mockReturnValue(false);
    toggleComposerMicRecordingMock.mockReturnValue('started');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps editor focus when clicking the mic to start dictation', async () => {
    render(SimpleRichInput, { props: baseProps() });
    const editor = screen.getByTestId('tiptap-editor');
    editor.focus();

    await clickLikeABrowser(buttonByIcon('microphone')!);

    expect(document.activeElement).toBe(editor);
    expect(toggleComposerMicRecordingMock).toHaveBeenCalledTimes(1);
    expect(toggleComposerMicRecordingMock).toHaveBeenCalledWith(expect.any(Object), 'agent-1');
  });

  it('keeps editor focus when clicking the mic to stop a recording', async () => {
    mockReduxState.hardwareConsole.pttRecording = true;
    isComposerMicRecordingMock.mockReturnValue(true);
    toggleComposerMicRecordingMock.mockReturnValue('stopped');
    render(SimpleRichInput, { props: baseProps() });
    const editor = screen.getByTestId('tiptap-editor');
    editor.focus();

    await clickLikeABrowser(buttonByIcon('microphone')!);

    expect(document.activeElement).toBe(editor);
    expect(toggleComposerMicRecordingMock).toHaveBeenCalledTimes(1);
    expect(toggleComposerMicRecordingMock).toHaveBeenCalledWith(expect.any(Object), 'agent-1');
  });

  it('keeps editor focus when clicking cancel while transcribing', async () => {
    mockReduxState.hardwareConsole.voiceTranscribing = true;
    render(SimpleRichInput, { props: baseProps() });
    const editor = screen.getByTestId('tiptap-editor');
    editor.focus();

    await clickLikeABrowser(buttonByIcon('spinner')!);

    expect(document.activeElement).toBe(editor);
  });
});

describe('SimpleRichInput non-image attachment placement (unified flow)', () => {
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

  function makeFile(name: string, type: string, size: number): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  }

  async function dropFiles(files: File[]) {
    const dropZone = screen.getByTestId('message-input');
    await fireEvent.drop(dropZone, { dataTransfer: { files } });
  }

  function insertMentionCalls(): Array<Record<string, unknown>> {
    return ((window as any).__tiptapInsertMentionCalls ?? []) as Array<Record<string, unknown>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).__tiptapInsertMentionCalls = [];
    mockReduxState.daemonHealth = { hostLocality: null, transport: null };
    addMockSession('ws-1', createSession());
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    delete (window as any).__tiptapInsertMentionCalls;
    document.body.innerHTML = '';
  });

  it('places a non-image file via the sourcePath — attachmentId context item, no mention, no bytes on the wire', async () => {
    const getPathForFile = vi.fn(() => '/home/user/Downloads/dump.har');
    (window as any).electronAPI.getPathForFile = getPathForFile;
    placeAttachmentMock.mockResolvedValueOnce({
      ok: true,
      path: '.intent/attachments/dump.har',
      fileName: 'dump.har',
      size: 12_582_912,
      attachmentId: 'att-uuid-1',
      mimeType: 'application/json',
      uploadedAt: '2026-08-12T00:00:00Z',
    });

    const oncontextAdd = vi.fn();
    render(SimpleRichInput, { props: { ...baseProps(), oncontextAdd } });
    await dropFiles([makeFile('dump.har', 'application/json', 12 * 1024 * 1024)]);

    await waitFor(() => {
      expect(placeAttachmentMock).toHaveBeenCalledWith(
        'ws-1',
        'dump.har',
        {
          sourcePath: '/home/user/Downloads/dump.har',
          mimeType: 'application/json',
        },
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });
    // The placed file becomes a context item carrying the registry UUID +
    // metadata — never a mention chip, never an inline upload. oncontextAdd
    // fires only after placement succeeds.
    await waitFor(() => {
      expect(oncontextAdd).toHaveBeenCalledTimes(1);
    });
    const item = oncontextAdd.mock.calls[0][0];
    expect(item.attachmentId).toBe('att-uuid-1');
    expect(item.label).toBe('dump.har');
    expect(item.attachmentMimeType).toBe('application/json');
    expect(item.attachmentSize).toBe(12_582_912);
    expect(item.placementStatus).toBe('placed');
    expect(item.file).toBeUndefined();
    expect(insertMentionCalls()).toHaveLength(0);
    const { toast } = await import('svelte-sonner');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('never sends base64 bytes: a file with no resolvable sourcePath becomes a failed pill', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '');

    render(SimpleRichInput, { props: baseProps() });
    await dropFiles([makeFile('big.log', 'text/plain', 11 * 1024 * 1024)]);

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    // No wire call at all — base64 is not a fallback.
    expect(placeAttachmentMock).not.toHaveBeenCalled();
    const chip = document.querySelector('[data-placement-status="failed"]');
    expect(chip).not.toBeNull();
    expect(screen.getByTestId('attachment-retry')).toBeTruthy();
  });

  it('still rejects images over the 30 MiB reference cap with the too-large toast (monorepo#3338)', async () => {
    render(SimpleRichInput, { props: baseProps() });
    await dropFiles([makeFile('huge.png', 'image/png', 31 * 1024 * 1024)]);

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    expect(placeAttachmentMock).not.toHaveBeenCalled();
    expect(insertMentionCalls()).toHaveLength(0);
  });

  it('places small non-image files too — the byte-dropping inline path is gone', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/small.txt');
    placeAttachmentMock.mockResolvedValueOnce({
      ok: true,
      path: '.intent/attachments/small.txt',
      fileName: 'small.txt',
      size: 1024,
      attachmentId: 'att-uuid-3',
      mimeType: 'text/plain',
      uploadedAt: '2026-08-12T00:00:00Z',
    });

    const oncontextAdd = vi.fn();
    render(SimpleRichInput, { props: { ...baseProps(), oncontextAdd } });
    await dropFiles([makeFile('small.txt', 'text/plain', 1024)]);

    await waitFor(() => {
      expect(placeAttachmentMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(oncontextAdd).toHaveBeenCalledTimes(1);
    });
    expect(oncontextAdd.mock.calls[0][0].attachmentId).toBe('att-uuid-3');
  });

  it('placement failure renders a failed pill with retry, blocks send, and retry unblocks', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/big.log');
    placeAttachmentMock.mockRejectedValueOnce(new Error('daemon down'));

    const oncontextAdd = vi.fn();
    const onsubmit = vi.fn();
    render(SimpleRichInput, { props: { ...baseProps(), value: 'hello', oncontextAdd, onsubmit } });
    await dropFiles([makeFile('big.log', 'text/plain', 11 * 1024 * 1024)]);

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    // The item stays visible as a failed pill (not silently dropped)…
    const chip = document.querySelector('[data-placement-status="failed"]');
    expect(chip).not.toBeNull();
    // …oncontextAdd never fired for the failed item…
    expect(oncontextAdd).not.toHaveBeenCalled();
    // …and send is blocked while the failed pill is present.
    const sendButton = document.querySelector(
      'button[aria-label="Send message"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).not.toBeNull();
    expect(sendButton!.disabled).toBe(true);

    // Retry re-places from the captured sourcePath and unblocks send.
    placeAttachmentMock.mockResolvedValueOnce({
      ok: true,
      path: '.intent/attachments/big.log',
      fileName: 'big.log',
      size: 11 * 1024 * 1024,
      attachmentId: 'att-uuid-5',
      mimeType: 'text/plain',
      uploadedAt: '2026-08-12T00:00:00Z',
    });
    await fireEvent.click(screen.getByTestId('attachment-retry'));
    await waitFor(() => {
      expect(placeAttachmentMock).toHaveBeenCalledTimes(2);
    });
    expect(placeAttachmentMock).toHaveBeenLastCalledWith(
      'ws-1',
      'big.log',
      {
        sourcePath: '/home/user/big.log',
        mimeType: 'text/plain',
      },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(oncontextAdd).toHaveBeenCalledTimes(1);
    });
    expect(oncontextAdd.mock.calls[0][0].attachmentId).toBe('att-uuid-5');
    await waitFor(() => {
      expect(document.querySelector('[data-placement-status="failed"]')).toBeNull();
    });
    await waitFor(() => {
      expect(sendButton!.disabled).toBe(false);
    });
  });

  it('send stays blocked while a placement is in flight', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/slow.bin');
    let resolvePlacement!: (v: unknown) => void;
    placeAttachmentMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePlacement = resolve)),
    );

    render(SimpleRichInput, { props: { ...baseProps(), value: 'hello' } });
    await dropFiles([makeFile('slow.bin', 'application/octet-stream', 1024)]);

    await waitFor(() => {
      expect(document.querySelector('[data-placement-status="placing"]')).not.toBeNull();
    });
    const sendButton = document.querySelector(
      'button[aria-label="Send message"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).not.toBeNull();
    expect(sendButton!.disabled).toBe(true);

    resolvePlacement({
      ok: true,
      path: '.intent/attachments/slow.bin',
      fileName: 'slow.bin',
      size: 1024,
      attachmentId: 'att-uuid-6',
      mimeType: 'application/octet-stream',
      uploadedAt: '2026-08-12T00:00:00Z',
    });
    await waitFor(() => {
      expect(sendButton!.disabled).toBe(false);
    });
  });

  it('uploading pill shows percent progress as chunk acks arrive (chunked upload)', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/huge.bin');
    let reportProgress!: (fraction: number) => void;
    let resolvePlacement!: (v: unknown) => void;
    placeAttachmentMock.mockImplementationOnce(
      (_ws: string, _name: string, _source: unknown, onProgress: (fraction: number) => void) => {
        reportProgress = onProgress;
        return new Promise((resolve) => (resolvePlacement = resolve));
      },
    );

    render(SimpleRichInput, { props: baseProps() });
    await dropFiles([makeFile('huge.bin', 'application/octet-stream', 100 * 1024 * 1024)]);

    // Single-shot phase: indeterminate spinner, no percent label yet.
    await waitFor(() => {
      expect(document.querySelector('[data-placement-status="placing"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-testid="attachment-upload-progress"]')).toBeNull();

    // Chunk acks drive the percent label.
    reportProgress(0.25);
    await waitFor(() => {
      const label = document.querySelector('[data-testid="attachment-upload-progress"]');
      expect(label?.textContent).toBe('25%');
    });
    reportProgress(0.75);
    await waitFor(() => {
      const label = document.querySelector('[data-testid="attachment-upload-progress"]');
      expect(label?.textContent).toBe('75%');
    });

    resolvePlacement({
      ok: true,
      path: '.intent/attachments/huge.bin',
      fileName: 'huge.bin',
      size: 100 * 1024 * 1024,
      attachmentId: 'att-uuid-7',
      mimeType: 'application/octet-stream',
      uploadedAt: '2026-08-12T00:00:00Z',
    });
    await waitFor(() => {
      expect(document.querySelector('[data-placement-status="placing"]')).toBeNull();
    });
    expect(document.querySelector('[data-testid="attachment-upload-progress"]')).toBeNull();
  });

  it('places a non-image file arriving via clipboard paste (backed by a real file path)', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/trace.log');
    placeAttachmentMock.mockResolvedValueOnce({
      ok: true,
      path: '.intent/attachments/trace.log',
      fileName: 'trace.log',
      size: 11 * 1024 * 1024,
      attachmentId: 'att-uuid-4',
      mimeType: 'text/plain',
      uploadedAt: '2026-08-12T00:00:00Z',
    });

    const oncontextAdd = vi.fn();
    render(SimpleRichInput, { props: { ...baseProps(), oncontextAdd } });
    const file = makeFile('trace.log', 'text/plain', 11 * 1024 * 1024);
    const dropZone = screen.getByTestId('message-input');
    await fireEvent.paste(dropZone, {
      clipboardData: {
        items: [{ kind: 'file', type: 'text/plain', getAsFile: () => file }],
      },
    });

    await waitFor(() => {
      expect(placeAttachmentMock).toHaveBeenCalledTimes(1);
    });
    const [wsId, fileName] = placeAttachmentMock.mock.calls[0];
    expect(wsId).toBe('ws-1');
    expect(fileName).toBe('trace.log');
    await waitFor(() => {
      expect(oncontextAdd).toHaveBeenCalledTimes(1);
    });
    expect(oncontextAdd.mock.calls[0][0].attachmentId).toBe('att-uuid-4');
    expect(insertMentionCalls()).toHaveLength(0);
  });

  it('a draft-restored placing/failed item rehydrates as a blocking failed pill whose retry re-places', async () => {
    // Round-trip a mid-placement item through the draft serializer (what a
    // reload does): the restored item must render a failed pill that blocks
    // send, and retry must re-attempt placement from the persisted
    // sourcePath — never a silent drop.
    const { serializeDraftAttachments, deserializeDraftAttachments } =
      await import('../chat-draft-attachments');
    const restored = deserializeDraftAttachments(
      serializeDraftAttachments([
        {
          id: 'attachment-pending-1721650000000-crash.log',
          type: 'file',
          label: 'crash.log',
          path: 'crash.log',
          attachmentMimeType: 'text/plain',
          attachmentSize: 2048,
          sourcePath: '/home/user/crash.log',
          placementStatus: 'placing',
        },
      ]),
    );
    expect(restored[0].placementStatus).toBe('failed');

    const oncontextAdd = vi.fn();
    render(SimpleRichInput, {
      props: { ...baseProps(), value: 'hello', contextItems: restored, oncontextAdd },
    });

    // Restored as a visible failed pill (not a generic chip, not dropped)…
    const chip = document.querySelector('[data-placement-status="failed"]');
    expect(chip).not.toBeNull();
    // …which blocks send until retried or removed.
    const sendButton = document.querySelector(
      'button[aria-label="Send message"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).not.toBeNull();
    expect(sendButton!.disabled).toBe(true);

    // Retry re-places from the persisted sourcePath and unblocks send.
    placeAttachmentMock.mockResolvedValueOnce({
      ok: true,
      path: '.intent/attachments/crash.log',
      fileName: 'crash.log',
      size: 2048,
      attachmentId: 'att-uuid-7',
      mimeType: 'text/plain',
      uploadedAt: '2026-08-12T00:00:00Z',
    });
    await fireEvent.click(screen.getByTestId('attachment-retry'));
    await waitFor(() => {
      expect(placeAttachmentMock).toHaveBeenCalledWith(
        'ws-1',
        'crash.log',
        {
          sourcePath: '/home/user/crash.log',
          mimeType: 'text/plain',
        },
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });
    await waitFor(() => {
      expect(oncontextAdd).toHaveBeenCalledTimes(1);
    });
    expect(oncontextAdd.mock.calls[0][0].attachmentId).toBe('att-uuid-7');
    await waitFor(() => {
      expect(document.querySelector('[data-placement-status="failed"]')).toBeNull();
    });
    await waitFor(() => {
      expect(sendButton!.disabled).toBe(false);
    });
  });

  it('a draft-restored failed pill with a stale sourcePath fails again on retry and stays blocking', async () => {
    const { deserializeDraftAttachments } = await import('../chat-draft-attachments');
    const restored = deserializeDraftAttachments([
      {
        id: 'attachment-pending-1721650000000-gone.log',
        type: 'file',
        label: 'gone.log',
        sourcePath: '/home/user/gone.log',
        placementStatus: 'failed',
      },
    ]);

    render(SimpleRichInput, { props: { ...baseProps(), value: 'hello', contextItems: restored } });
    expect(document.querySelector('[data-placement-status="failed"]')).not.toBeNull();

    placeAttachmentMock.mockRejectedValueOnce(new Error('source file not found'));
    await fireEvent.click(screen.getByTestId('attachment-retry'));

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    // Still a failed pill, still blocking — the stale path surfaced visibly.
    expect(document.querySelector('[data-placement-status="failed"]')).not.toBeNull();
    const sendButton = document.querySelector(
      'button[aria-label="Send message"]',
    ) as HTMLButtonElement | null;
    expect(sendButton!.disabled).toBe(true);
  });
});

describe('SimpleRichInput folder drop (path references, local daemon only)', () => {
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

  function makeFile(name: string, type: string, size = 16): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  }

  /** Drop with a DataTransferItem list carrying folder-detection entries. */
  function makeItemsDropEvent(entries: Array<{ file: File; isDirectory: boolean }>) {
    return {
      dataTransfer: {
        types: ['Files'],
        files: entries.map((e) => e.file),
        items: entries.map((e) => ({
          kind: 'file',
          getAsFile: () => e.file,
          webkitGetAsEntry: () => ({ isDirectory: e.isDirectory }),
        })),
      },
    };
  }

  function insertMentionCalls(): Array<Record<string, unknown>> {
    return ((window as any).__tiptapInsertMentionCalls ?? []) as Array<Record<string, unknown>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).__tiptapInsertMentionCalls = [];
    mockReduxState.daemonHealth = { hostLocality: 'local', transport: null };
    addMockSession('ws-1', createSession());
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    delete (window as any).__tiptapInsertMentionCalls;
    document.body.innerHTML = '';
  });

  it('local folder drop inserts a folder mention chip with the absolute host path — no placement', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');

    render(SimpleRichInput, { props: baseProps() });
    const folder = makeFile('my-folder', '');
    await fireEvent.drop(
      screen.getByTestId('message-input'),
      makeItemsDropEvent([{ file: folder, isDirectory: true }]),
    );

    await waitFor(() => {
      expect(insertMentionCalls()).toHaveLength(1);
    });
    const mention = insertMentionCalls()[0];
    expect(mention.type).toBe('folder');
    expect(mention.label).toBe('my-folder');
    expect((mention.meta as any).fullPath).toBe('/home/user/projects/my-folder');
    // Folders are never placed as attachments.
    expect(placeAttachmentMock).not.toHaveBeenCalled();
    const { toast } = await import('svelte-sonner');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('remote drop containing a folder rejects the WHOLE drop with one error toast', async () => {
    mockReduxState.daemonHealth = { hostLocality: 'remote', transport: null };
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');

    render(SimpleRichInput, { props: baseProps() });
    const folder = makeFile('my-folder', '');
    const image = makeFile('photo.png', 'image/png');
    await fireEvent.drop(
      screen.getByTestId('message-input'),
      makeItemsDropEvent([
        { file: image, isDirectory: false },
        { file: folder, isDirectory: true },
      ]),
    );

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    // Nothing attaches — not even the file in the same drop.
    expect(insertMentionCalls()).toHaveLength(0);
    expect(placeAttachmentMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: 'photo.png' })).toBeNull();
  });

  it('mixed local drop: folder becomes a path reference, image attaches as today', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/projects/my-folder');

    render(SimpleRichInput, { props: baseProps() });
    const folder = makeFile('my-folder', '');
    const image = makeFile('photo.png', 'image/png');
    await fireEvent.drop(
      screen.getByTestId('message-input'),
      makeItemsDropEvent([
        { file: image, isDirectory: false },
        { file: folder, isDirectory: true },
      ]),
    );

    await waitFor(() => {
      expect(insertMentionCalls()).toHaveLength(1);
    });
    expect(insertMentionCalls()[0].type).toBe('folder');
    expect(await screen.findByRole('img', { name: 'photo.png' })).toBeTruthy();
    expect(placeAttachmentMock).not.toHaveBeenCalled();
  });

  it('file-only drops behave exactly as before when remote (no folder involved)', async () => {
    mockReduxState.daemonHealth = { hostLocality: 'remote', transport: null };

    render(SimpleRichInput, { props: baseProps() });
    const image = makeFile('photo.png', 'image/png');
    await fireEvent.drop(
      screen.getByTestId('message-input'),
      makeItemsDropEvent([{ file: image, isDirectory: false }]),
    );

    expect(await screen.findByRole('img', { name: 'photo.png' })).toBeTruthy();
    const { toast } = await import('svelte-sonner');
    expect(toast.error).not.toHaveBeenCalled();
    expect(insertMentionCalls()).toHaveLength(0);
  });

  it('handleDroppedFiles still accepts a plain File[] (legacy external callers)', async () => {
    const { component } = render(SimpleRichInput, { props: baseProps() });
    const image = new File(['image-bytes'], 'ext.png', { type: 'image/png' });

    await component.handleDroppedFiles([image]);

    expect(await screen.findByRole('img', { name: 'ext.png' })).toBeTruthy();
  });

  it('handleDroppedFiles accepts the DropSplit shape from external drop targets', async () => {
    (window as any).electronAPI.getPathForFile = vi.fn(() => '/home/user/ext-folder');
    const { component } = render(SimpleRichInput, { props: baseProps() });
    const folder = makeFile('ext-folder', '');

    await component.handleDroppedFiles({ files: [], folderFiles: [folder] });

    await waitFor(() => {
      expect(insertMentionCalls()).toHaveLength(1);
    });
    expect(insertMentionCalls()[0].label).toBe('ext-folder');
    expect((insertMentionCalls()[0].meta as any).path).toBe('/home/user/ext-folder');
  });

  it('skips the folder with an error toast when no absolute path is resolvable', async () => {
    // dev:web / missing bridge: a bare folder name must never ride as a
    // mention that looks like a workspace-relative path.
    (window as any).electronAPI.getPathForFile = vi.fn(() => '');

    render(SimpleRichInput, { props: baseProps() });
    const folder = makeFile('my-folder', '');
    await fireEvent.drop(
      screen.getByTestId('message-input'),
      makeItemsDropEvent([{ file: folder, isDirectory: true }]),
    );

    const { toast } = await import('svelte-sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
    expect(insertMentionCalls()).toHaveLength(0);
  });

  it('keys folder mention ids by resolved path so same-basename folders stay distinct', async () => {
    const folderA = makeFile('src', '');
    const folderB = makeFile('src', '');
    // Two distinct File objects share the basename; resolve by identity.
    (window as any).electronAPI.getPathForFile = vi.fn((f: File) =>
      f === folderA ? '/home/user/a/src' : '/home/user/b/src',
    );

    render(SimpleRichInput, { props: baseProps() });
    await fireEvent.drop(
      screen.getByTestId('message-input'),
      makeItemsDropEvent([
        { file: folderA, isDirectory: true },
        { file: folderB, isDirectory: true },
      ]),
    );

    await waitFor(() => {
      expect(insertMentionCalls()).toHaveLength(2);
    });
    const ids = insertMentionCalls().map((c) => c.id);
    expect(ids).toEqual(['folder-/home/user/a/src', 'folder-/home/user/b/src']);
    expect(new Set(ids).size).toBe(2);
  });
});

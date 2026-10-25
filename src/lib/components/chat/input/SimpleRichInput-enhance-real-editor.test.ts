/** @vitest-environment jsdom */
// Real TipTapEditor (no editor mock): the mocked editor hid that TipTap's
// setEditable emits a doc-less 'update' that cancelled every enhancement
// (intent-hq/intent#5758).
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Editor } from '@tiptap/core';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { derived, readable } from 'svelte/store';

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

vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: {
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
    workspace: { hasLoaded: boolean; workspaces: unknown };
    connections: { windowBackendId: string };
    guestSessions: {
      sessions: { idField: 'id'; map: Record<string, never>; ids: string[] };
      hasReceivedList: boolean;
      listUnavailable: boolean;
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
    // The mic gate also reads the caller's workspace role (multiplayer w3);
    // admitted owner fixtures explicitly hydrate their workspace rows.
    workspace: { hasLoaded: false, workspaces: null },
    // The role gate also rules out a guest window (multiplayer w4): this
    // window's backend is not a joined host, and the guest list has settled
    // (an unsettled identity reads as collaborator-only).
    connections: { windowBackendId: 'local' },
    guestSessions: {
      sessions: { idField: 'id', map: {}, ids: [] },
      hasReceivedList: true,
      listUnavailable: false,
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
  mockReduxState.providerCatalog = {
    ...providerCatalogReducer(initialState, providerCatalogLoaded(MOCK_PROVIDER_CATALOG)),
    get byWorkspaceId() {
      return {
        'ws-1': {
          catalog: MOCK_PROVIDER_CATALOG,
          settings: [
            {
              path: 'model.defaultProvider',
              value: mockReduxState.providerSettings.activeProviderId,
            },
          ],
          specialists: [],
          readiness: {},
        },
      };
    },
  };

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
  selectAgentProvider: (agentId$: import('svelte/store').Readable<string>) =>
    derived(agentId$, (id) => {
      for (const ws of Object.values(mockReduxState.workspaceAgents.byWorkspaceId) as any[]) {
        const agent = ws?.agents?.map?.[id];
        if (agent) return agent.provider || agent.metadata?.provider;
      }
      return undefined;
    }),
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
beforeEach(() => {
  mockReduxState.workspace = {
    hasLoaded: true,
    workspaces: createCollection(
      'id',
      ['ws-1', 'ws-2'].map((id) => ({ id, myRole: 'owner' })),
    ),
  };
  const admitted = withLegacyPrincipal(mockReduxState);
  Object.assign(mockReduxState, {
    principal: admitted.principal,
    connections: admitted.connections,
    daemonHealth: admitted.daemonHealth,
    workspaceEvents: admitted.workspaceEvents,
  });
});
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
warmImport(() => import('../__tests__/mocks/ModelPicker.svelte'));
warmImport(() => import('../__tests__/mocks/SlotOnly.svelte'));

import { notify } from '$lib/components/patterns/notify';

describe('SimpleRichInput Enhance prompt with the real editor (intent-hq/intent#5758)', () => {
  const ORIGINAL = 'make this prompt better';
  const baseProps = () => ({
    value: ORIGINAL,
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

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function renderComposer() {
    const view = render(SimpleRichInput, { props: baseProps() });
    const prose = await waitFor(() => {
      const element = view.container.querySelector('.ProseMirror') as
        (HTMLElement & { editor?: Editor }) | null;
      expect(element?.textContent).toBe(ORIGINAL);
      return element!;
    });
    return { view, prose };
  }

  async function startEnhancement() {
    window.dispatchEvent(new CustomEvent('chat:enhance-prompt'));
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledOnce());
    await settle();
  }

  async function settle() {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReduxState.providerSettings.activeProviderId = 'auggie';
    addMockSession('ws-1', createSession());
  });

  afterEach(() => {
    cleanup();
    removeMockSession('ws-1', 'agent-1');
    mockReduxState.providerSettings.activeProviderId = '';
    document.body.innerHTML = '';
  });

  it('shows exactly one error and keeps the draft when the daemon rejects', async () => {
    const request = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(request.promise);
    const { prose } = await renderComposer();

    await startEnhancement();
    // The in-flight request keeps the editor locked: toggling editability
    // must not cancel the request it is locking for.
    expect(prose.getAttribute('contenteditable')).toBe('false');
    request.reject(new Error('daemon exploded'));

    await waitFor(() => expect(notify.error).toHaveBeenCalledOnce());
    expect(vi.mocked(notify.error).mock.calls[0][0]).toContain('daemon exploded');
    expect(notify.success).not.toHaveBeenCalled();
    await waitFor(() => expect(prose.getAttribute('contenteditable')).toBe('true'));
    expect(prose.textContent).toBe(ORIGINAL);
  });

  it('applies the enhanced text and Undo restores the original', async () => {
    const request = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(request.promise);
    const { prose } = await renderComposer();

    await startEnhancement();
    request.resolve({ enhanced: 'An enhanced, clearer prompt' });

    await waitFor(() => expect(prose.textContent).toBe('An enhanced, clearer prompt'));
    expect(notify.success).toHaveBeenCalledOnce();
    expect(notify.error).not.toHaveBeenCalled();
    await waitFor(() => expect(prose.getAttribute('contenteditable')).toBe('true'));

    const toastOptions = vi.mocked(notify.success).mock.calls[0][1] as {
      action: { onClick: () => void };
    };
    toastOptions.action.onClick();
    await waitFor(() => expect(prose.textContent).toBe(ORIGINAL));
  });

  it('still discards a late result after Escape', async () => {
    const request = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(request.promise);
    const { prose } = await renderComposer();

    await startEnhancement();
    await fireEvent.keyDown(prose, { key: 'Escape' });
    await waitFor(() => expect(prose.getAttribute('contenteditable')).toBe('true'));

    request.resolve({ enhanced: 'Late enhanced prompt' });
    await settle();
    expect(prose.textContent).toBe(ORIGINAL);
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('cancels on Escape when the locked editor has lost focus to the body', async () => {
    const request = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(request.promise);
    const { prose } = await renderComposer();

    await startEnhancement();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(prose.getAttribute('contenteditable')).toBe('true'));

    request.resolve({ enhanced: 'Late enhanced prompt' });
    await settle();
    expect(prose.textContent).toBe(ORIGINAL);
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('ignores an Escape pressed outside the composer', async () => {
    const request = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(request.promise);
    const { prose } = await renderComposer();
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);

    await startEnhancement();
    await fireEvent.keyDown(elsewhere, { key: 'Escape' });
    await settle();
    expect(prose.getAttribute('contenteditable')).toBe('false');

    request.resolve({ enhanced: 'An enhanced, clearer prompt' });
    await waitFor(() => expect(prose.textContent).toBe('An enhanced, clearer prompt'));
  });

  it('routes Escape to the composer it was pressed in when two are enhancing', async () => {
    const first = deferred<{ enhanced: string }>();
    const second = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = await renderComposer();
    const b = await renderComposer();

    async function enhanceFromMenu(container: HTMLElement) {
      await fireEvent.click(within(container).getByTestId('prompt-actions-trigger'));
      await fireEvent.click(await screen.findByRole('menuitem', { name: /Enhance prompt/i }));
    }
    await enhanceFromMenu(a.view.container);
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledTimes(1));
    await enhanceFromMenu(b.view.container);
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledTimes(2));
    await settle();
    expect(a.prose.getAttribute('contenteditable')).toBe('false');
    expect(b.prose.getAttribute('contenteditable')).toBe('false');

    // Escape in the EARLIER composer (beneath the later one's layer) cancels only it.
    await fireEvent.keyDown(a.prose, { key: 'Escape' });
    await waitFor(() => expect(a.prose.getAttribute('contenteditable')).toBe('true'));
    expect(b.prose.getAttribute('contenteditable')).toBe('false');

    first.resolve({ enhanced: 'Late result for A' });
    second.resolve({ enhanced: 'Result for B' });
    await waitFor(() => expect(b.prose.textContent).toBe('Result for B'));
    await settle();
    expect(a.prose.textContent).toBe(ORIGINAL);
  });

  it('cancels only the later composer when Escape is pressed in it', async () => {
    const first = deferred<{ enhanced: string }>();
    const second = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = await renderComposer();
    const b = await renderComposer();

    for (const view of [a.view, b.view]) {
      await fireEvent.click(within(view.container).getByTestId('prompt-actions-trigger'));
      await fireEvent.click(await screen.findByRole('menuitem', { name: /Enhance prompt/i }));
    }
    await waitFor(() => expect(enhancePromptMock).toHaveBeenCalledTimes(2));
    await settle();

    await fireEvent.keyDown(b.prose, { key: 'Escape' });
    await waitFor(() => expect(b.prose.getAttribute('contenteditable')).toBe('true'));
    expect(a.prose.getAttribute('contenteditable')).toBe('false');

    second.resolve({ enhanced: 'Late result for B' });
    first.resolve({ enhanced: 'Result for A' });
    await waitFor(() => expect(a.prose.textContent).toBe('Result for A'));
    await settle();
    expect(b.prose.textContent).toBe(ORIGINAL);
  });

  it('still discards a late result after Stop enhancing', async () => {
    const request = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(request.promise);
    const { prose } = await renderComposer();

    await startEnhancement();
    await fireEvent.click(screen.getByTestId('prompt-actions-trigger'));
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Stop enhancing/i }));
    await waitFor(() => expect(prose.getAttribute('contenteditable')).toBe('true'));

    request.reject(new Error('cancelled late'));
    await settle();
    expect(prose.textContent).toBe(ORIGINAL);
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('still discards a late result after a real edit during the request', async () => {
    const request = deferred<{ enhanced: string }>();
    enhancePromptMock.mockReturnValueOnce(request.promise);
    const { prose } = await renderComposer();

    await startEnhancement();
    // A genuine document change (not the lock toggle) must still cancel.
    prose.editor!.chain().focus('end').insertContent(' now').run();
    await waitFor(() => expect(prose.textContent).toBe(`${ORIGINAL} now`));

    request.resolve({ enhanced: 'Late enhanced prompt' });
    await settle();
    expect(prose.textContent).toBe(`${ORIGINAL} now`);
    expect(notify.success).not.toHaveBeenCalled();
  });
});

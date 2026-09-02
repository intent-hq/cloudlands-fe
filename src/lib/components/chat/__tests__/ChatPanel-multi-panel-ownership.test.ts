/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe: (run: (value: T) => void) => (run(value), () => {}),
  });
  const createControllableReadable = <T>(value: T) => {
    const subscribers = new Set<(nextValue: T) => void>();
    let currentValue = value;
    return {
      emit: (nextValue: T) => {
        currentValue = nextValue;
        subscribers.forEach((run) => run(currentValue));
      },
      readable: {
        subscribe: (run: (nextValue: T) => void) => {
          run(currentValue);
          subscribers.add(run);
          return () => {
            subscribers.delete(run);
          };
        },
      },
    };
  };
  const panelTabs = createControllableReadable<unknown[]>([]);
  const panel = { title: 'app.ts' };
  const selector = <T>(value: T) =>
    Object.assign(
      vi.fn(() => readable(value)),
      { select: vi.fn(() => value) },
    );
  return {
    dispatch: vi.fn(),
    panelTabs,
    panel,
    selector,
    readable,
    panelManager: {
      getPanelIds: vi.fn(() => ['panel-1']),
      getPanel: vi.fn(() => ({
        id: 'panel-1',
        activeTabId: 'file-tab',
        tabs: [
          { id: 'agent-tab', type: 'agent', agentId: 'agent-1', title: 'Agent' },
          { id: 'file-tab', type: 'file', filePath: 'src/app.ts', title: panel.title },
        ],
      })),
    },
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: testState.dispatch });
});

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => testState.panelManager,
}));
vi.mock('$lib/client', () => ({
  appClient: {
    drafts: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue({ ok: true }),
      clear: vi.fn().mockResolvedValue({ ok: true }),
    },
    agents: { retry: vi.fn(), editQueued: vi.fn() },
  },
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({ success: true, data: [] }),
  listenSync: vi.fn(() => () => {}),
}));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/SlotOnly.svelte')).default }));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectAllTabs: vi.fn(() => testState.panelTabs.readable),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: testState.selector(null),
  selectAgentIsResponding: testState.selector(false),
  selectAgentIsRunning: testState.selector(false),
  selectAgentSessionIsStreaming: testState.selector(false),
  selectAgentSessionStreamingContent: testState.selector(''),
  selectAgentMessages: testState.selector([]),
  selectAgentHistoryMessages: testState.selector([]),
  selectHistorySegmentMeta: testState.selector({
    gapToTail: false,
    oldestReached: false,
    historyCount: 0,
    tailCount: 0,
  }),
  selectAgentTailCapPruned: testState.selector(false),
}));
vi.mock('$store/renderer/slices/chat-state/chat-state-selectors', () => ({
  selectAwaitingSwitchBackSnapshot: testState.selector(false),
  selectAwaitingUtilityFooter: testState.selector(false),
  selectChatError: testState.selector(null),
  selectChatFailureCorrelation: testState.selector(undefined),
  selectChatLastChunkTime: testState.selector(null),
  selectChatLiveStreamPhase: testState.selector(null),
  selectChatModelUnavailable: testState.selector(null),
  selectChatReceivedFirstChunk: testState.selector(false),
  selectChatStatusEvents: testState.selector([]),
  selectChatStreamingStartTime: testState.selector(null),
  selectFetchingGapFill: testState.selector(false),
  selectFetchingHistorySeek: testState.selector(false),
  selectFetchingOlderHistory: testState.selector(false),
  selectHistoryExhausted: testState.selector(false),
  selectHistorySeekUnsupported: testState.selector(false),
  selectPendingProposalRecovery: testState.selector(undefined),
  selectPendingQuestionRecovery: testState.selector(undefined),
  selectTranscriptHydration: testState.selector({ isHydrating: false }),
  selectTranscriptHydratedOnce: testState.selector(false),
  selectTranscriptSnapshotMeta: testState.selector(undefined),
}));
vi.mock('$store/renderer/slices/agent-queue/agent-queue-selectors', () => ({
  selectAgentQueueMessages: testState.selector([]),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: testState.selector(null),
}));
vi.mock('$store/renderer/slices/multi-panel-context/multi-panel-context-selectors', () => ({
  selectCheckedPanels: testState.selector([]),
  selectPanels: testState.selector([]),
  selectCheckedSelections: testState.selector([]),
}));
vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectWorkspaceSetupTerminal: testState.selector(null),
}));
vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-selectors', () => ({
  selectWorkspaceNavigationMainPanel: testState.selector({ type: 'empty' }),
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', () => ({
  selectChatDraft: { select: vi.fn(() => '') },
}));
vi.mock('$store/renderer/slices/task-agent-associations/task-agent-associations-selectors', () => ({
  selectTasksForAgent: testState.selector([]),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: testState.selector([]),
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectIsAgentMonospace: testState.selector(false),
}));
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: testState.selector([]),
  selectEffectiveBehaviorPrompt: testState.selector(''),
  selectEffectiveModel: testState.selector(''),
}));
vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', () => ({
  selectEffectiveDefaultProviderId: testState.selector(''),
  selectProviderCatalogLoaded: testState.selector(false),
  selectProviderAuthFailureGuidance: { select: () => null },
}));

vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../DateSeparator.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../EventWakeupBanner.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../StreamingStatus.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../LiveStreamPhaseIndicator.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../RegularAgentWelcome.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../SuggestedPrompts.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../questions/QuestionWizard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatFileChangesSummary.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AutoCommitStatus.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../QueuedMessageList.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/panel-find-bar', async () => ({
  PanelFindBar: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/skeleton', async () => ({
  Skeleton: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AttentionRequestBanner.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../LazyTurn.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../InlinePermissionRequest.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AuroraBackground.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ModelChangeNotice.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$features/onboarding/messages/WorkspaceSetupCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

const workspace = { id: 'ws-1', title: 'Workspace' };

async function renderChatPanel(isActive: boolean) {
  const ChatPanel = (await import('../ChatPanel.svelte')).default;
  render(ChatPanel, { props: { workspace, agentId: 'agent-1', isActive } });
  await Promise.resolve();
}

function dispatchedTypes() {
  return testState.dispatch.mock.calls.map(([action]) => action?.type);
}

function updatePanelActions() {
  return testState.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action?.type === 'multiPanelContext/updatePanels');
}

describe('ChatPanel multi-panel context ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.panel.title = 'app.ts';
    testState.panelTabs.emit([]);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not sync multi-panel context from inactive cached ChatPanel instances', async () => {
    await renderChatPanel(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dispatchedTypes()).not.toContain('multiPanelContext/setWorkspace');
    expect(dispatchedTypes()).not.toContain('multiPanelContext/updatePanels');
  });

  it('syncs multi-panel context from the active ChatPanel', async () => {
    await renderChatPanel(true);

    await waitFor(() => expect(dispatchedTypes()).toContain('multiPanelContext/setWorkspace'));
    expect(dispatchedTypes()).toContain('multiPanelContext/updatePanels');
  });

  it('does not produce a fresh availablePanelContexts reference for unchanged panel data', async () => {
    await renderChatPanel(true);

    await waitFor(() => expect(updatePanelActions()).toHaveLength(1));
    const firstPanels = updatePanelActions()[0].payload[0];

    testState.panelTabs.emit([]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updatePanelActions()).toHaveLength(1);
    expect(updatePanelActions()[0].payload[0]).toBe(firstPanels);
  });

  it('refreshes availablePanelContexts for real semantic panel changes', async () => {
    await renderChatPanel(true);

    await waitFor(() => expect(updatePanelActions()).toHaveLength(1));
    const firstPanels = updatePanelActions()[0].payload[0];
    testState.panel.title = 'renamed.ts';
    testState.panelTabs.emit([]);

    await waitFor(() => expect(updatePanelActions()).toHaveLength(2));
    const nextPanels = updatePanelActions()[1].payload[0];
    expect(nextPanels).not.toBe(firstPanels);
    expect(nextPanels[0].label).toBe('renamed.ts');
  });

  it('coalesces dense editor selection events and keeps the latest selection', async () => {
    await renderChatPanel(true);
    await waitFor(() => expect(dispatchedTypes()).toContain('multiPanelContext/setWorkspace'));
    testState.dispatch.mockClear();
    const pendingFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const emitSelection = (text: string) => {
      window.dispatchEvent(
        new CustomEvent('editor:selection-change', {
          detail: { text, file: 'src/app.ts', language: 'typescript', source: 'editor' },
        }),
      );
    };
    emitSelection('first');
    emitSelection('second');
    emitSelection('latest');

    expect(dispatchedTypes()).not.toContain('multiPanelContext/setSelection');
    pendingFrames.splice(0).forEach((callback) => callback(0));

    const selectionActions = testState.dispatch.mock.calls.filter(
      ([action]) => action?.type === 'multiPanelContext/setSelection',
    );
    expect(selectionActions).toHaveLength(1);
    expect(selectionActions[0][0].payload[0]).toMatchObject({
      panelId: 'src/app.ts',
      tabId: 'src/app.ts',
      text: 'latest',
    });
  });
});

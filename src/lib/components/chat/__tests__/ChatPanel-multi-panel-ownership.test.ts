/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatInterestLeaseCount,
  clearAllChatInterestLeases,
  hasChatInterestLease,
  onLastChatInterestLeaseReleased,
} from '$features/agent/utils/chat-interest-leases';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import ChatPanel from '../ChatPanel.svelte';

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
  const selectorFrom = <T>(get: () => T) =>
    Object.assign(
      vi.fn(() => ({
        subscribe: (run: (value: T) => void) => (run(get()), () => {}),
      })),
      { select: vi.fn(get) },
    );
  return {
    dispatch: vi.fn(),
    agentSessionIsStreaming: false,
    chatAuroraEnabled: true,
    panelTabs,
    panel,
    selector,
    selectorFrom,
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
  return createAppStoreMockModule({
    state: () => ({ browser: { byWorkspaceId: {} } }),
    dispatch: testState.dispatch,
  });
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
    agents: { retry: vi.fn(), editQueued: vi.fn(), getQueue: vi.fn().mockResolvedValue([]) },
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
  selectAgentSessionIsStreaming: testState.selectorFrom(() => testState.agentSessionIsStreaming),
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
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasks: testState.selector([]),
  selectWorkspaceTasksInitialized: testState.selector(false),
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
  selectChatAuroraEnabled: testState.selectorFrom(() => testState.chatAuroraEnabled),
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

async function renderChatPanel(isActive: boolean, targetWorkspace = workspace) {
  render(ChatPanel, { props: { workspace: targetWorkspace, agentId: 'agent-1', isActive } });
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
    clearAllChatInterestLeases();
    vi.clearAllMocks();
    testState.agentSessionIsStreaming = false;
    testState.chatAuroraEnabled = true;
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
    clearAllChatInterestLeases();
    vi.unstubAllGlobals();
  });

  it('leases the active agent before initialization and viewed-state sweep dispatches', () => {
    const leaseAtDispatch: Array<{ type: string; leased: boolean }> = [];
    testState.dispatch.mockImplementation((action) => {
      if (action?.type === 'chatState/initializeChatRequested') {
        leaseAtDispatch.push({ type: action.type, leased: hasChatInterestLease('agent-1') });
        // Model the init saga's synchronous viewed-state update and subscription
        // sweep before ChatPanel's first reactive lease-transfer effect can run.
        testState.dispatch({
          type: 'unreadTracking/markAgentAsViewed',
          payload: ['agent-1'],
        });
      } else if (
        action?.type === 'unreadTracking/markAgentAsViewed' &&
        leaseAtDispatch.length === 1
      ) {
        leaseAtDispatch.push({ type: action.type, leased: hasChatInterestLease('agent-1') });
      }
      return action;
    });

    const view = render(ChatPanel, {
      props: { workspace, agentId: 'agent-1', isActive: true },
    });

    expect(leaseAtDispatch).toEqual([
      { type: 'chatState/initializeChatRequested', leased: true },
      { type: 'unreadTracking/markAgentAsViewed', leased: true },
    ]);
    expect(chatInterestLeaseCount('agent-1')).toBe(1);

    view.unmount();
    expect(chatInterestLeaseCount('agent-1')).toBe(0);
  });

  it('reference-counts two panels and releases only after the final panel closes', () => {
    const first = render(ChatPanel, {
      props: { workspace, agentId: 'agent-1', isActive: true },
    });
    const second = render(ChatPanel, {
      props: { workspace, agentId: 'agent-1', isActive: true },
    });

    expect(chatInterestLeaseCount('agent-1')).toBe(2);
    first.unmount();
    expect(chatInterestLeaseCount('agent-1')).toBe(1);
    second.unmount();
    expect(chatInterestLeaseCount('agent-1')).toBe(0);
  });

  it('transfers later active-agent interest once and releases the current lease on destroy', async () => {
    const releasedAgents: string[] = [];
    const replacementLeaseAtRelease: boolean[] = [];
    const stopListening = onLastChatInterestLeaseReleased((releasedAgentId) => {
      releasedAgents.push(releasedAgentId);
      if (releasedAgentId === 'agent-1') {
        replacementLeaseAtRelease.push(hasChatInterestLease('agent-2'));
      }
    });
    try {
      const view = render(ChatPanel, {
        props: { workspace, agentId: 'agent-1', isActive: true },
      });

      await view.rerender({ workspace, agentId: 'agent-2', isActive: true });
      await waitFor(() => expect(chatInterestLeaseCount('agent-2')).toBe(1));
      expect(chatInterestLeaseCount('agent-1')).toBe(0);
      expect(releasedAgents).toEqual(['agent-1']);
      expect(replacementLeaseAtRelease).toEqual([true]);

      await view.rerender({ workspace, agentId: 'agent-2', isActive: true });
      expect(chatInterestLeaseCount('agent-2')).toBe(1);
      expect(releasedAgents).toEqual(['agent-1']);

      view.unmount();
      expect(chatInterestLeaseCount('agent-2')).toBe(0);
      expect(releasedAgents).toEqual(['agent-1', 'agent-2']);
    } finally {
      stopListening();
    }
  });

  it('does not release a lease when an inactive panel is destroyed before acquisition', () => {
    const releasedAgents: string[] = [];
    const stopListening = onLastChatInterestLeaseReleased((releasedAgentId) => {
      releasedAgents.push(releasedAgentId);
    });
    try {
      const view = render(ChatPanel, {
        props: { workspace, agentId: 'agent-1', isActive: false },
      });

      expect(chatInterestLeaseCount('agent-1')).toBe(0);
      view.unmount();
      expect(releasedAgents).toEqual([]);
    } finally {
      stopListening();
    }
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

  it.each([
    ['regular', workspace],
    ['Chief', { ...workspace, id: CHIEF_WORKSPACE_ID }],
  ])(
    'does not mount the %s Aurora host while streaming when the preference is disabled',
    async (_kind, targetWorkspace) => {
      testState.agentSessionIsStreaming = true;
      testState.chatAuroraEnabled = false;

      await renderChatPanel(true, targetWorkspace);

      expect(screen.queryByTestId('composer-aurora-host')).toBeNull();
    },
  );

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

/**
 * @vitest-environment jsdom
 *
 * Render-level regression coverage for the transcript-skeleton branch of
 * ChatPanel: while the first hydration is in flight for the initial workspace
 * agent (onboarding context present), the panel must render ONLY the skeleton
 * rows — no WorkspaceSetupCard. The pure-predicate tests in
 * chat-panel-visibility.test.ts cannot catch the card being reintroduced
 * inside the skeleton branch, so this suite renders ChatPanel itself.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectNativeExecutionPlan } from '../workspace-task-fallback';
// Load the component during collection, not inside a test's timeout budget.
// A timed-out dynamic import can otherwise mount after that test's cleanup.
import ChatPanel from '../ChatPanel.svelte';

const testState = vi.hoisted(() => {
  const subscribers = new Set<() => void>();
  const readable = <T>(value: T) => ({
    subscribe: (run: (value: T) => void) => (run(value), () => {}),
  });
  // Match reference-based selector emissions for updates after mounting.
  const selectorFrom = <T>(get: () => T) =>
    Object.assign(
      vi.fn(() => ({
        subscribe: (run: (value: T) => void) => {
          let current = get();
          run(current);
          const update = () => {
            const next = get();
            if (Object.is(current, next)) return;
            current = next;
            run(current);
          };
          subscribers.add(update);
          return () => subscribers.delete(update);
        },
      })),
      { select: vi.fn(get) },
    );
  const selector = <T>(value: T) => selectorFrom(() => value);
  const state = {
    dispatch: vi.fn(),
    readable,
    selector,
    selectorFrom,
    notify: () => subscribers.forEach((update) => update()),
    transcriptHydration: 'loading' as string,
    transcriptHydratedOnce: false,
    agentSession: null as Record<string, unknown> | null,
    agentMessages: [] as unknown[],
    agentHistoryMessages: [] as unknown[],
    workspaceTasks: [] as Array<{
      id: string;
      title: string;
      status: string;
      specLinked?: boolean;
    }>,
    workspaceTasksInitialized: false,
    panelManager: {
      getPanelIds: vi.fn(() => [] as string[]),
      getPanel: vi.fn(() => null),
    },
  };
  return state;
});

vi.mock('../workspace-task-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workspace-task-fallback')>();
  return { ...actual, selectNativeExecutionPlan: vi.fn(actual.selectNativeExecutionPlan) };
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
  selectAllTabs: vi.fn(() => testState.readable([] as unknown[])),
  selectPanels: testState.selector({}),
  selectHiddenTabs: testState.selector([] as unknown[]),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: testState.selectorFrom(() => testState.agentSession),
  selectAgentIsResponding: testState.selector(false),
  selectAgentIsRunning: testState.selector(false),
  selectAgentSessionIsStreaming: testState.selector(false),
  selectAgentSessionStreamingContent: testState.selector(''),
  selectAgentMessages: testState.selectorFrom(() => testState.agentMessages),
  selectAgentHistoryMessages: testState.selectorFrom(() => testState.agentHistoryMessages),
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
  selectTranscriptHydration: testState.selectorFrom(() => testState.transcriptHydration),
  selectTranscriptHydratedOnce: testState.selectorFrom(() => testState.transcriptHydratedOnce),
  selectTranscriptSnapshotMeta: testState.selector(undefined),
}));
vi.mock('$store/renderer/slices/agent-queue/agent-queue-selectors', () => ({
  selectAgentQueueMessages: testState.selector([]),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: testState.selector(null),
}));
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasks: testState.selectorFrom(() => testState.workspaceTasks),
  selectWorkspaceTasksInitialized: testState.selectorFrom(
    () => testState.workspaceTasksInitialized,
  ),
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
  selectChatAuroraEnabled: testState.selector(true),
  selectIsAgentMonospace: testState.selector(false),
}));
vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-selectors', () => ({
  selectDividerSession: testState.selector(null),
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
// Marker mock: the real card's presence/absence is what this suite asserts.
vi.mock('$features/onboarding/messages/WorkspaceSetupCard.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceSetupCard.svelte')).default,
}));

// Workspace with a repository name so ChatPanel reconstructs onboardingContext
// on mount (no initial prompt is persisted — the reopened-workspace shape).
const workspace = {
  id: 'ws-1',
  title: 'Workspace',
  repositoryName: 'my-repo',
  repositoryPath: '/repo/my-repo',
  branch: 'feature/setup',
};

async function renderInitialWorkspaceChatPanel(onTaskProgressChange?: (tasks: unknown[]) => void) {
  render(ChatPanel, {
    props: {
      workspace,
      agentId: 'agent-1',
      isActive: true,
      isInitialWorkspaceAgent: true,
      onTaskProgressChange,
    },
  });
  await Promise.resolve();
}

describe('ChatPanel skeleton branch vs WorkspaceSetupCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.agentSession = null;
    testState.agentMessages = [];
    testState.agentHistoryMessages = [];
    testState.workspaceTasks = [];
    testState.workspaceTasksInitialized = false;
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

  it('renders skeleton rows WITHOUT the setup card while the first hydration is in flight', async () => {
    testState.transcriptHydration = 'loading';
    testState.transcriptHydratedOnce = false;

    await renderInitialWorkspaceChatPanel();

    await waitFor(() => expect(screen.getByTestId('chat-transcript-skeleton')).toBeTruthy());
    expect(screen.queryByTestId('mock-workspace-setup-card')).toBeNull();
  });

  it('renders the setup card (no skeleton) once hydration settles on an empty transcript', async () => {
    // Positive control: proves the marker mock wiring detects the card, so the
    // absence assertion above genuinely guards the skeleton branch.
    testState.transcriptHydration = 'settled';
    testState.transcriptHydratedOnce = true;

    await renderInitialWorkspaceChatPanel();

    await waitFor(() => expect(screen.getByTestId('mock-workspace-setup-card')).toBeTruthy());
    expect(screen.queryByTestId('chat-transcript-skeleton')).toBeNull();
  });

  it('routes hydrated fallback progress to the header and gives a native plan precedence', async () => {
    testState.transcriptHydration = 'settled';
    testState.transcriptHydratedOnce = true;
    testState.workspaceTasksInitialized = true;
    testState.workspaceTasks = [
      { id: 'task-1', title: 'Canonical workspace task', status: 'in_progress', specLinked: true },
    ];

    const onTaskProgressChange = vi.fn();
    await renderInitialWorkspaceChatPanel(onTaskProgressChange);
    await waitFor(() =>
      expect(onTaskProgressChange).toHaveBeenLastCalledWith([
        {
          id: 'workspace:task-1',
          title: 'Canonical workspace task',
          status: 'running',
        },
      ]),
    );
    expect(screen.queryByTestId('workspace-task-fallback-card')).toBeNull();

    cleanup();
    testState.agentMessages = [
      {
        id: 'assistant-plan',
        role: 'assistant',
        contentBlocks: [
          {
            type: 'plan',
            entries: [{ content: 'Native plan', priority: 'high', status: 'in_progress' }],
          },
        ],
      },
    ];
    await renderInitialWorkspaceChatPanel(onTaskProgressChange);
    await waitFor(() => expect(screen.queryByTestId('chat-transcript-skeleton')).toBeNull());
    expect(screen.queryByTestId('workspace-task-fallback-card')).toBeNull();
    await waitFor(() =>
      expect(onTaskProgressChange).toHaveBeenLastCalledWith([
        { id: 'plan:assistant-plan:0:0', title: 'Native plan', status: 'running' },
      ]),
    );
  });

  it.each([false, true])(
    'does not rescan unchanged history on live-only updates (history plan: %s)',
    async (hasHistoryPlan) => {
      const planMessage = (id: string, title: string) => ({
        id,
        role: 'assistant',
        contentBlocks: [
          {
            id: `${id}:plan`,
            type: 'plan',
            entries: [{ content: title, priority: 'high', status: 'in_progress' }],
          },
        ],
      });
      testState.transcriptHydration = 'settled';
      testState.transcriptHydratedOnce = true;
      testState.workspaceTasksInitialized = true;
      testState.workspaceTasks = [
        { id: 'task-1', title: 'Workspace task', status: 'in_progress', specLinked: true },
      ];
      const history = Array.from({ length: 8 }, (_, index) => ({
        id: `history-${index}`,
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'History' }],
      }));
      testState.agentHistoryMessages = hasHistoryPlan
        ? [planMessage('history-plan', 'History task'), ...history]
        : history;
      const historyMessages = testState.agentHistoryMessages;
      const historyScanCount = () =>
        vi
          .mocked(selectNativeExecutionPlan)
          .mock.calls.filter(([sources]) => sources.some((source) => source === historyMessages))
          .length;
      const expectedInitial = hasHistoryPlan
        ? [{ id: 'plan:history-plan:plan:0', title: 'History task', status: 'running' }]
        : [{ id: 'workspace:task-1', title: 'Workspace task', status: 'running' }];
      const onTaskProgressChange = vi.fn();
      await renderInitialWorkspaceChatPanel(onTaskProgressChange);
      await waitFor(() => expect(onTaskProgressChange).toHaveBeenLastCalledWith(expectedInitial));
      expect(historyScanCount()).toBe(1);

      for (let index = 0; index < 3; index += 1) {
        testState.agentMessages = [
          {
            id: 'live-text',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: `${index}` }],
          },
        ];
        flushSync(() => testState.notify());
        expect(onTaskProgressChange).toHaveBeenLastCalledWith(expectedInitial);
        expect(historyScanCount()).toBe(1);
      }

      testState.agentMessages = [planMessage('live-plan', 'Live task')];
      flushSync(() => testState.notify());
      expect(onTaskProgressChange).toHaveBeenLastCalledWith([
        { id: 'plan:live-plan:plan:0', title: 'Live task', status: 'running' },
      ]);
      testState.agentMessages = [
        { id: 'empty-plan', role: 'assistant', contentBlocks: [{ type: 'plan', entries: [] }] },
      ];
      flushSync(() => testState.notify());
      expect(onTaskProgressChange).toHaveBeenLastCalledWith([]);

      testState.agentMessages = [];
      flushSync(() => testState.notify());
      expect(onTaskProgressChange).toHaveBeenLastCalledWith(expectedInitial);
      expect(historyScanCount()).toBe(1);

      testState.agentHistoryMessages = [planMessage('reloaded-plan', 'Reloaded task')];
      flushSync(() => testState.notify());
      expect(onTaskProgressChange).toHaveBeenLastCalledWith([
        { id: 'plan:reloaded-plan:plan:0', title: 'Reloaded task', status: 'running' },
      ]);
      testState.agentHistoryMessages = [];
      flushSync(() => testState.notify());
      expect(onTaskProgressChange).toHaveBeenLastCalledWith([
        { id: 'workspace:task-1', title: 'Workspace task', status: 'running' },
      ]);
    },
  );
});

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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe: (run: (value: T) => void) => (run(value), () => {}),
  });
  // Selector mock that re-reads its value at subscribe time, so each test can
  // set the hydration phase before rendering.
  const selectorFrom = <T>(get: () => T) =>
    Object.assign(
      vi.fn(() => ({
        subscribe: (run: (value: T) => void) => (run(get()), () => {}),
      })),
      { select: vi.fn(get) },
    );
  const selector = <T>(value: T) => selectorFrom(() => value);
  const state = {
    dispatch: vi.fn(),
    readable,
    selector,
    selectorFrom,
    transcriptHydration: 'loading' as string,
    transcriptHydratedOnce: false,
    panelManager: {
      getPanelIds: vi.fn(() => [] as string[]),
      getPanel: vi.fn(() => null),
    },
  };
  return state;
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      agentSubscriptionUI: { entries: {} },
      browser: { byWorkspaceId: {} },
    }),
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
  selectAgentSession: testState.selector(null),
  selectAgentSessionsById: testState.selector({}),
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

async function renderInitialWorkspaceChatPanel() {
  const ChatPanel = (await import('../ChatPanel.svelte')).default;
  render(ChatPanel, {
    props: { workspace, agentId: 'agent-1', isActive: true, isInitialWorkspaceAgent: true },
  });
  await Promise.resolve();
}

describe('ChatPanel skeleton branch vs WorkspaceSetupCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

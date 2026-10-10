/** @vitest-environment jsdom */
// Mount the real panel, recovery card and queue; mock unrelated panel services.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetScaffold } from './mocks/chat-panel-render-scaffold';
import type { QueuedMessage } from '$shared/types';
import { AgentStatus } from '$shared/types/agent.types';
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
    queue: [] as QueuedMessage[],
    principalId: 'self',
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

vi.mock('$store/renderer/store', async () => {
  const [{ createAppStoreMockModule }, { initialState: chatDrafts }, { initialState: questionUi }] =
    await Promise.all([
      import('$store/renderer/utils/test-helpers/store-mock'),
      import('$store/renderer/slices/chat-drafts/chat-drafts-slice'),
      import('$store/renderer/slices/question-ui/question-ui-slice'),
    ]);
  return createAppStoreMockModule({
    state: () => ({
      agentSubscriptionUI: { entries: {} },
      browser: { byWorkspaceId: {} },
      chatDrafts,
      chatPanelUi: { byWorkspaceId: {} },
      questionUi,
    }),
    dispatch: testState.dispatch,
  });
});

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => testState.panelManager,
}));
// Workspace detail hydration is unrelated to queue recovery.
vi.mock('$features/workspace/workspace-detail-hydration', () => ({
  ensureWorkspaceDetail: vi.fn().mockResolvedValue(undefined),
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
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/SlotOnly.svelte')).default }));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectAllTabs: vi.fn(() => testState.readable([] as unknown[])),
  selectPanels: testState.selector({}),
  selectHiddenTabs: testState.selector([] as unknown[]),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', async () => ({
  ...(await import('./mocks/chat-panel-render-scaffold')).agentSessionSelectors(),
  selectAgentSession: testState.selectorFrom(() => testState.agentSession),
  selectAgentSessionsById: testState.selector({}),
  selectAgentMessages: testState.selectorFrom(() => testState.agentMessages),
  selectAgentHistoryMessages: testState.selectorFrom(() => testState.agentHistoryMessages),
}));
vi.mock('$store/renderer/slices/chat-state/chat-state-selectors', async () => ({
  ...(await import('./mocks/chat-panel-render-scaffold')).chatStateSelectors(),
  selectTranscriptHydration: testState.selectorFrom(() => testState.transcriptHydration),
  selectTranscriptHydratedOnce: testState.selectorFrom(() => testState.transcriptHydratedOnce),
}));
vi.mock('$store/renderer/slices/agent-queue/agent-queue-selectors', async () => ({
  ...(await import('./mocks/chat-panel-render-scaffold')).agentQueueSelectors(),
  selectAgentQueueMessages: testState.selectorFrom(() => testState.queue),
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
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalSnapshot: testState.selectorFrom(() => ({
    principal: { id: testState.principalId },
    capabilities: { submissionCorrelation: 1 },
  })),
  selectCanAdministerHost: testState.selector(false),
}));
vi.mock('$store/renderer/slices/presence/presence-selectors', () => ({
  selectAgentTypingPeople: testState.selector([]),
  selectPresenceOwnPrincipalId: testState.selector(null),
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
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).transientUiSelectors(),
);
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
vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).unreadTrackingSelectors(),
);
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: testState.selector([]),
  selectEffectiveBehaviorPrompt: testState.selector(''),
  selectEffectiveModel: testState.selector(''),
}));
vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', async () =>
  (await import('./mocks/chat-panel-render-scaffold')).providerCatalogSelectors(),
);

vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../EventWakeupBanner.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentCard.svelte', async () => ({
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
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
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
  default: (await import('./mocks/MockWorkspaceSetupCard.svelte')).default,
}));

const workspace = { id: 'ws-1', title: 'Workspace' };
const error = 'Failed to load workspace requirements';
function restoredQueue(type: string): QueuedMessage {
  return {
    id: `queue-${type}`,
    turnId: `turn-${type}`,
    content: `Automatic ${type}`,
    queuedAt: '2026-10-07T06:00:00Z',
    position: 0,
    requeuedAfterFailure: true,
    messageMetadata: { type, source: 'system' },
  };
}
function mountPanel() {
  return render(ChatPanel, { props: { workspace, agentId: 'agent-1', isActive: true } });
}

beforeEach(() => {
  resetScaffold();
  vi.clearAllMocks();
  testState.queue = [];
  testState.principalId = 'self';
  testState.transcriptHydration = 'settled';
  testState.transcriptHydratedOnce = true;
  testState.agentSession = {
    id: 'agent-1',
    workspaceId: 'ws-1',
    status: AgentStatus.Error,
    messages: [],
    backendSessionId: 'restored-session',
    stopReason: error,
  };
  testState.agentMessages = [
    {
      id: 'restored-failure',
      role: 'system',
      timestamp: '2026-10-07T06:00:00Z',
      contentBlocks: [{ type: 'text', text: error, meta: { kind: 'turn-failure' } }],
    },
  ];
  testState.agentHistoryMessages = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatPanel recovery for the rendered queue', () => {
  it.each(['hook_wake', 'event_notification', 'script_monitor_wake'])(
    'keeps recovery actionable with only a restored %s entry',
    async (type) => {
      const entry = restoredQueue(type);
      testState.queue = [entry];
      const { container } = mountPanel();
      expect(screen.queryByTestId('queued-message-content')).toBeNull();
      expect(container.textContent).not.toContain('Use its controls below');
      expect(screen.getByText('Needs attention')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
      expect(testState.dispatch).toHaveBeenCalledWith({
        type: 'chatPanelUi/retryAgentRequested',
        payload: ['ws-1', expect.any(String), expect.any(String), 'agent-1'],
      });
      expect(testState.queue).toEqual([entry]);
      expect(testState.queue[0]).toBe(entry);
    },
  );

  it.each(['self', 'other'])(
    'preserves visible authored content, attachments and controls for viewer %s',
    async (principalId) => {
      testState.principalId = principalId;
      const entry: QueuedMessage = {
        id: 'user-queue',
        turnId: 'user-turn',
        content: 'Please review my original message.',
        queuedAt: '2026-10-07T06:00:00Z',
        position: 1,
        requeuedAfterFailure: true,
        messageMetadata: { fromPrincipalId: 'self' },
        imageBlocks: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
        fileBlocks: [
          {
            type: 'file',
            attachmentId: 'original-file',
            mimeType: 'text/plain',
            fileName: 'original.txt',
          },
        ],
      };
      testState.queue = [restoredQueue('hook_wake'), entry];
      const snapshot = structuredClone(testState.queue);
      const { container } = mountPanel();
      await waitFor(() =>
        expect(screen.getByTestId('queued-message-text').textContent).toBe(entry.content),
      );
      expect(container.textContent).toContain(
        'A message is queued. Use its controls below to manage it.',
      );
      expect(container.textContent).not.toContain('Automatic hook_wake');
      expect(screen.getByRole('img', { name: /attached image/i }).getAttribute('src')).toBe(
        'data:image/png;base64,AAAA',
      );
      expect(screen.getByText('original.txt')).toBeTruthy();
      const control = (tooltip: string) => container.querySelector(`button[tooltip="${tooltip}"]`);
      expect(Boolean(screen.queryByRole('button', { name: 'Send immediately', exact: true }))).toBe(
        principalId === 'self',
      );
      expect(Boolean(control('Remove'))).toBe(principalId === 'self');
      await fireEvent.doubleClick(screen.getByTestId('queued-message-content'));
      expect(Boolean(screen.queryByTestId('queued-message-edit-mode'))).toBe(
        principalId === 'self',
      );
      const edits = testState.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'agentQueue/mutationRequested');
      expect(edits).toHaveLength(principalId === 'self' ? 1 : 0);
      if (principalId === 'self') {
        expect(edits[0].payload[0]).toMatchObject({
          workspaceId: 'ws-1',
          agentId: 'agent-1',
          messageId: 'user-queue',
          operation: { kind: 'edit', content: entry.content, editing: true },
        });
      }
      expect(testState.queue).toEqual(snapshot);
    },
  );
});

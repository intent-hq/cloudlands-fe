/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import {
  animateScrollTo as animateScrollToUtil,
  followToBottom as scrollToBottomUtil,
} from '$lib/utils/smartScroll';

const mocks = vi.hoisted(() => {
  const mutableReadable = <T>(initial: T) => {
    let value = initial;
    const subscribers = new Set<(current: T) => void>();
    return {
      subscribe(run: (current: T) => void) {
        subscribers.add(run);
        run(value);
        return () => subscribers.delete(run);
      },
      set(next: T) {
        value = next;
        for (const subscriber of subscribers) subscriber(value);
      },
    };
  };
  const readable = <T>(value: T) => ({
    subscribe(run: (current: T) => void) {
      run(value);
      return () => {};
    },
  });
  const selector = <T>(value: T) => Object.assign(() => readable(value), { select: () => value });
  return {
    dispatch: vi.fn(),
    draftGet: vi.fn(),
    draftSet: vi.fn(),
    draftClear: vi.fn(),
    listUserMessages: vi.fn(),
    invoke: vi.fn().mockResolvedValue(null),
    listenSync: vi.fn(),
    ipcListenerCleanups: [] as Array<ReturnType<typeof vi.fn>>,
    chatDrafts: {} as Record<string, string>,
    resizeObserve: vi.fn(),
    resizeDisconnect: vi.fn(),
    resizeConstructor: vi.fn(),
    agentMessages: mutableReadable<unknown[]>([]),
    agentSession: mutableReadable<unknown>(null),
    agentSessionIsStreaming: mutableReadable(false),
    chatError: mutableReadable<string | null>(null),
    failureCorrelation: mutableReadable<
      { turnCorrelation?: string; turnIdCorrelation?: string } | undefined
    >(undefined),
    reportStreamLifecycle: vi.fn(),
    animateScrollTo: vi.fn(),
    awaitingSwitchBackSnapshot: mutableReadable(false),
    awaitingUtilityFooter: mutableReadable(false),
    transcriptHydration: mutableReadable('settled'),
    transcriptHydratedOnce: mutableReadable(true),
    transcriptSnapshotMeta: mutableReadable<
      { seq: number; truncated: boolean; totalMessages: number; resumed?: boolean } | undefined
    >(undefined),
    fetchingOlderHistory: mutableReadable(false),
    fetchingHistorySeek: mutableReadable(false),
    pendingBrowserCaptures: mutableReadable<unknown[]>([]),
    focusedActiveTab: { type: 'agent', agentId: 'agent-a' } as
      { type: string; agentId?: string } | undefined,
    animateMessageSend: vi.fn(),
    createMessageSendLaunchBubble: vi.fn(),
    pendingQuestions: null as { messageId: string; questions: unknown[] } | null,
    // Latched divider viewing session (Redux, mutated by tests): non-null
    // while the session is live; null after a stop-looking boundary's
    // endDividerSession.
    dividerSessionValue: { anchorId: null } as { anchorId: string | null } | null,
    prefersReducedMotion: false,
    followBottomOptions: null as {
      enabled?: boolean;
      follow: boolean;
      onFollowChange?: (follow: boolean) => void;
    } | null,
    pinnedPromptOptions: null as {
      enabled: boolean;
      onChange: (prompt: { id: string; message: unknown } | null) => void;
    } | null,
    selector,
  };
});

vi.mock('$lib/utils/stream-lifecycle-telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/stream-lifecycle-telemetry')>()),
  reportStreamLifecycle: mocks.reportStreamLifecycle,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {}, dispatch: mocks.dispatch });
});
vi.mock('$lib/client', () => ({
  appClient: {
    drafts: { get: mocks.draftGet, set: mocks.draftSet, clear: mocks.draftClear },
    agents: { retry: vi.fn(), listUserMessages: mocks.listUserMessages },
  },
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentAttentionRequest: mocks.selector(null),
  selectAgentSession: Object.assign(() => mocks.agentSession, { select: () => null }),
  selectAgentSessionIsStreaming: Object.assign(() => mocks.agentSessionIsStreaming, {
    select: () => false,
  }),
  selectAgentMessages: Object.assign(() => mocks.agentMessages, { select: () => [] }),
  selectAgentHistoryMessages: mocks.selector([]),
  selectHistorySegmentMeta: mocks.selector({
    gapToTail: false,
    oldestReached: false,
    historyCount: 0,
    tailCount: 0,
  }),
  selectAgentTailCapPruned: mocks.selector(false),
  selectAgentSessionStreamingContent: mocks.selector(''),
  selectAgentIsResponding: mocks.selector(false),
  selectAgentIsRunning: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/agent-queue/agent-queue-selectors', () => ({
  selectAgentQueueMessages: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/task-agent-associations/task-agent-associations-selectors', () => ({
  selectTasksForAgent: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/chat-state/chat-state-selectors', () => ({
  selectAwaitingSwitchBackSnapshot: Object.assign(() => mocks.awaitingSwitchBackSnapshot, {
    select: () => false,
  }),
  selectAwaitingUtilityFooter: Object.assign(() => mocks.awaitingUtilityFooter, {
    select: () => false,
  }),
  selectChatError: Object.assign(() => mocks.chatError, { select: () => null }),
  selectChatFailureCorrelation: Object.assign(() => mocks.failureCorrelation, {
    select: () => undefined,
  }),
  selectChatIsStalled: mocks.selector(false),
  selectChatLastChunkTime: mocks.selector(null),
  selectChatLiveStreamPhase: mocks.selector(null),
  selectChatModelUnavailable: mocks.selector(null),
  selectChatReceivedFirstChunk: mocks.selector(false),
  selectChatStatusEvents: mocks.selector([]),
  selectChatStreamingStartTime: mocks.selector(null),
  selectFetchingGapFill: mocks.selector(false),
  selectFetchingHistorySeek: Object.assign(() => mocks.fetchingHistorySeek, {
    select: () => false,
  }),
  selectFetchingOlderHistory: Object.assign(() => mocks.fetchingOlderHistory, {
    select: () => false,
  }),
  selectHistoryExhausted: mocks.selector(false),
  selectHistorySeekUnsupported: mocks.selector(false),
  selectPendingProposalRecovery: mocks.selector(undefined),
  selectPendingQuestionRecovery: mocks.selector(undefined),
  selectTranscriptHydration: Object.assign(() => mocks.transcriptHydration, {
    select: () => 'settled',
  }),
  selectTranscriptHydratedOnce: Object.assign(() => mocks.transcriptHydratedOnce, {
    select: () => true,
  }),
  selectTranscriptSnapshotMeta: Object.assign(() => mocks.transcriptSnapshotMeta, {
    select: () => undefined,
  }),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-selectors', () => ({
  selectDividerSession: Object.assign(
    () => ({
      subscribe(run: (value: unknown) => void) {
        run(mocks.dividerSessionValue);
        return () => {};
      },
    }),
    { select: () => mocks.dividerSessionValue },
  ),
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectIsAgentMonospace: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectActiveTab: { select: () => mocks.focusedActiveTab },
  selectAllTabs: mocks.selector([]),
  selectPanels: mocks.selector({}),
  selectHiddenTabs: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/browser/browser-selectors', () => ({
  selectPendingBrowserElementCaptures: () => mocks.pendingBrowserCaptures,
}));
vi.mock('$store/renderer/slices/multi-panel-context/multi-panel-context-selectors', () => ({
  selectCheckedPanels: mocks.selector([]),
  selectPanels: mocks.selector([]),
  selectCheckedSelections: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-selectors', () => ({
  selectWorkspaceNavigationMainPanel: mocks.selector({ type: 'empty' }),
}));
vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', () => ({
  selectChatDraft: {
    select: (_state: unknown, workspaceId: string, agentId: string) =>
      mocks.chatDrafts[`${workspaceId}::${agentId}`] ?? '',
  },
}));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ getPanelIds: () => [], getPanel: () => null }),
}));
vi.mock('$lib/utils/smartScroll', () => ({
  animateScrollTo: mocks.animateScrollTo,
  followToBottom: vi.fn(),
  followBottom: (
    node: HTMLElement,
    initial: {
      follow: boolean;
      threshold?: number;
      onFollowChange?: (follow: boolean) => void;
      onScrollStateChange?: (state: {
        distanceFromBottom: number;
        isAtBottom: boolean;
        isFollowing: boolean;
      }) => void;
    },
  ) => {
    let options = initial;
    mocks.followBottomOptions = options;
    const report = () => {
      const distance = Math.max(0, node.scrollHeight - node.clientHeight - node.scrollTop);
      options.onScrollStateChange?.({
        distanceFromBottom: distance,
        isAtBottom: distance <= (options.threshold ?? 100),
        isFollowing: options.follow,
      });
    };
    let listening = false;
    const sync = () => {
      if (options.enabled === false && listening) {
        node.removeEventListener('scroll', report);
        listening = false;
      } else if (options.enabled !== false && !listening) {
        node.addEventListener('scroll', report);
        listening = true;
        report();
      }
    };
    sync();
    return {
      update: (next: typeof initial) => {
        options = next;
        mocks.followBottomOptions = next;
        sync();
        if (listening) report();
      },
      destroy: () => node.removeEventListener('scroll', report),
    };
  },
  scrollToBottom: vi.fn(),
}));
// Pass-through wrapper around the real tracker that additionally captures the
// options so tests can drive `onChange` (set a pinned prompt) directly.
vi.mock('../pinned-prompt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pinned-prompt')>();
  return {
    ...actual,
    trackPinnedPrompt: (
      container: HTMLElement,
      options: NonNullable<typeof mocks.pinnedPromptOptions>,
    ) => {
      mocks.pinnedPromptOptions = options;
      const real = actual.trackPinnedPrompt(container, options);
      return {
        update: (next: NonNullable<typeof mocks.pinnedPromptOptions>) => {
          mocks.pinnedPromptOptions = next;
          real.update(next);
        },
        destroy: real.destroy,
      };
    },
  };
});
vi.mock('../message-send-transition', () => ({
  captureMessageSendOrigin: () => ({ left: 0, top: 600, width: 320, borderRadius: '8px' }),
  createMessageSendLaunchBubble: mocks.createMessageSendLaunchBubble,
  animateMessageSend: mocks.animateMessageSend,
  dismissMessageSendLaunchBubble: (bubble: HTMLElement | null) => {
    bubble?.remove();
    return Promise.resolve();
  },
  MESSAGE_SEND_MATCH_TIMEOUT_MS: 3000,
  MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS: 600,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
  listenSync: mocks.listenSync,
}));
vi.mock('$features/agent/services/consolidated-backend.service', () => ({
  unifiedOrchestrator: { editQueuedMessage: vi.fn() },
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToTask: vi.fn() }));
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/MockSimpleRichInput.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AttentionRequestBanner.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../questions/QuestionWizard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/MockChatMessage.svelte')).default,
}));
vi.mock('../questions/wizard-gate', () => ({
  deriveMarkedQuestionRecoveryState: () => null,
  deriveWizardPendingQuestions: () => mocks.pendingQuestions,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatPanel from '../ChatPanel.svelte';
import { clearDraftCacheForTests } from '../chat-draft-cache';
import {
  clearCachedChatScroll,
  clearChatScrollCacheForTests,
  getCachedChatScroll,
  setCachedChatScroll,
} from '../chat-scroll-cache';
import { SCROLL_BUTTON_SHOW_SETTLE_MS } from '../scroll-bottom-button-visibility';

type Frame = { id: number; callback: FrameRequestCallback };
let frames: Frame[];
let nextFrameId: number;

class MockChatIntersectionObserver {
  static instances: MockChatIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed = new Set<Element>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockChatIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
  }

  fire(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

function workspace(id: string): Workspace {
  return {
    id: id as Workspace['id'],
    title: id,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Workspace;
}

function latestSentAppMessageId(): string {
  const action = mocks.dispatch.mock.calls
    .map(([candidate]) => candidate)
    .findLast((candidate) => candidate?.type === 'chatState/sendMessage');
  return action.payload.payload.userAppMessageId as string;
}

function dispatchedTypes(): string[] {
  return mocks.dispatch.mock.calls.map(([action]) => action?.type);
}

function optimisticUserMessage(appMessageId: string, text: string) {
  return {
    id: `optimistic-${appMessageId}`,
    appMessageId,
    role: 'user',
    timestamp: '2026-01-01T00:00:00.000Z',
    contentBlocks: [{ type: 'text', text }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function flushFrame() {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame.callback(performance.now());
}

beforeEach(() => {
  frames = [];
  nextFrameId = 1;
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.push({ id, callback });
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      frames = frames.filter((frame) => frame.id !== id);
    }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        mocks.resizeConstructor(callback);
      }
      observe = mocks.resizeObserve;
      disconnect = mocks.resizeDisconnect;
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && mocks.prefersReducedMotion,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.clearAllMocks();
  mocks.ipcListenerCleanups = [];
  mocks.listenSync.mockImplementation(() => {
    const cleanupListener = vi.fn();
    mocks.ipcListenerCleanups.push(cleanupListener);
    return cleanupListener;
  });
  clearDraftCacheForTests();
  clearChatScrollCacheForTests();
  mocks.draftSet.mockResolvedValue({ ok: true, updatedAt: '2026-01-01T00:00:00.000Z' });
  mocks.listUserMessages.mockResolvedValue({ ok: true, items: [], total: 0 });
  for (const key of Object.keys(mocks.chatDrafts)) delete mocks.chatDrafts[key];
  mocks.dispatch.mockImplementation((action) => {
    if (action?.type !== 'transientUi/setChatDraft') return action;
    const [workspaceId, agentId, draft] = action.payload as [string, string, string];
    const key = `${workspaceId}::${agentId}`;
    if (draft) mocks.chatDrafts[key] = draft;
    else delete mocks.chatDrafts[key];
    return action;
  });
  mocks.agentMessages.set([]);
  mocks.agentSession.set(null);
  mocks.agentSessionIsStreaming.set(false);
  mocks.chatError.set(null);
  mocks.failureCorrelation.set(undefined);
  mocks.awaitingSwitchBackSnapshot.set(false);
  mocks.awaitingUtilityFooter.set(false);
  mocks.transcriptHydration.set('settled');
  mocks.transcriptHydratedOnce.set(true);
  mocks.transcriptSnapshotMeta.set(undefined);
  mocks.fetchingOlderHistory.set(false);
  mocks.fetchingHistorySeek.set(false);
  mocks.pendingBrowserCaptures.set([]);
  mocks.focusedActiveTab = { type: 'agent', agentId: 'agent-a' };
  mocks.dividerSessionValue = { anchorId: null };
  mocks.animateMessageSend.mockResolvedValue(undefined);
  mocks.createMessageSendLaunchBubble.mockImplementation(() => {
    const bubble = document.createElement('div');
    bubble.dataset.messageSendTransition = 'true';
    document.body.append(bubble);
    return bubble;
  });
  mocks.pendingQuestions = null;
  mocks.prefersReducedMotion = false;
  mocks.followBottomOptions = null;
  mocks.pinnedPromptOptions = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatPanel mounted lifecycle', () => {
  it('consumes a targeted browser capture and includes its image and context in the next send', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.pendingBrowserCaptures.set([
      {
        id: 'capture-1',
        tabId: 'browser-1',
        ownerAgentId: 'agent-owner',
        targetAgentId: 'agent-a',
        pageUrl: 'https://example.com/account',
        title: 'Account',
        image: { data: 'base64-png', mimeType: 'image/png' },
        viewport: { width: 1440, height: 900 },
        element: {
          selector: 'button#save',
          domPath: 'html > body > main > button#save',
          tagName: 'BUTTON',
          id: 'save',
          className: 'primary',
          textSnippet: 'Save changes',
          rect: { x: 80, y: 120, width: 140, height: 36 },
          pageUrl: 'https://example.com/account',
          sourceRef: 'src/routes/account.svelte:42:3',
        },
      },
    ]);

    render(ChatPanel, {
      props: {
        workspace: workspace('workspace-a'),
        agentId: 'agent-a',
        isActive: true,
        isPanelFocused: true,
      },
    });
    await tick();
    await Promise.resolve();
    await tick();

    expect(screen.getByTestId('mock-context-capture-1-image')).toBeTruthy();
    expect(screen.getByTestId('mock-context-capture-1-context')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('mock-rich-input-editor'));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'browser/clearElementCapture',
      payload: ['workspace-a', 'capture-1'],
    });

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'Fix this element' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));

    const sendAction = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .findLast((action) => action?.type === 'chatState/sendMessage');
    expect(sendAction.payload.payload).toMatchObject({
      wsId: 'workspace-a',
      text: 'Fix this element',
      imageBlocks: [{ type: 'image', data: 'base64-png', mimeType: 'image/png' }],
    });
    expect(sendAction.payload.payload.workspaceContextStr).toContain(
      'DOM path: html > body > main > button#save',
    );
    expect(sendAction.payload.payload.workspaceContextStr).toContain(
      'Source ref: src/routes/account.svelte:42:3',
    );
    expect(sendAction.payload.payload.workspaceContextStr).toContain('Viewport: 1440×900');
  });

  it.each([
    ['image', 'capture-1-image'],
    ['context', 'capture-1-context'],
  ])('excludes a removed browser capture %s pill from the next send', async (kind, itemId) => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.pendingBrowserCaptures.set([
      {
        id: 'capture-1',
        tabId: 'browser-1',
        ownerAgentId: 'agent-a',
        targetAgentId: 'agent-a',
        pageUrl: 'https://example.com/account',
        title: 'Account',
        image: { data: 'base64-png', mimeType: 'image/png' },
        element: {
          selector: 'button#save',
          domPath: 'html > body > main > button#save',
          tagName: 'BUTTON',
          id: 'save',
          className: 'primary',
          textSnippet: 'Save changes',
          rect: { x: 80, y: 120, width: 140, height: 36 },
          pageUrl: 'https://example.com/account',
        },
      },
    ]);
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a', isActive: true },
    });
    await tick();
    await Promise.resolve();
    await tick();

    await fireEvent.click(screen.getByTestId(`mock-context-${itemId}`));
    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'Fix this element' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));

    const payload = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .findLast((action) => action?.type === 'chatState/sendMessage').payload.payload;
    if (kind === 'image') {
      expect(payload).not.toHaveProperty('imageBlocks');
      expect(payload.workspaceContextStr).toContain('DOM path: html > body > main > button#save');
    } else {
      expect(payload.imageBlocks).toEqual([
        { type: 'image', data: 'base64-png', mimeType: 'image/png' },
      ]);
      expect(payload.workspaceContextStr).toBe('');
    }
  });

  it('keeps an active response running on Escape and stops it from the visible control', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentSessionIsStreaming.set(true);
    render(ChatPanel, {
      props: {
        workspace: workspace('workspace-a'),
        agentId: 'agent-a',
        isActive: true,
        isPanelFocused: true,
      },
    });
    await tick();
    mocks.dispatch.mockClear();

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(false);
    expect(dispatchedTypes()).not.toContain('agentSessions/stopChatRequested');

    await fireEvent.click(screen.getByTestId('mock-input-stop'));
    expect(dispatchedTypes()).toContain('agentSessions/stopChatRequested');
  });

  it('retains user rows and newer hydrated assistant messages after the frontier passes them', async () => {
    MockChatIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockChatIntersectionObserver);
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(240);
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set(
      Array.from({ length: 24 }, (_, index) => [
        {
          id: `user-${index}`,
          role: 'user',
          content: `question ${index}`,
          timestamp: `2026-01-01T00:${String(index).padStart(2, '0')}:00.000Z`,
        },
        {
          id: `assistant-${index}`,
          role: 'assistant',
          content: `answer ${index}`,
          timestamp: `2026-01-01T00:${String(index).padStart(2, '0')}:30.000Z`,
        },
      ]).flat(),
    );
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    let unmounted = false;

    try {
      await tick();
      await tick();

      expect(view.container.querySelectorAll('[data-message-role="user"]')).toHaveLength(24);
      expect(
        view.container
          .querySelector('[data-lazy-turn-key="assistant-2"]')
          ?.getAttribute('data-lazy-visible'),
      ).toBe('false');
      expect(
        view.container
          .querySelector('[data-lazy-turn-key="assistant-22"]')
          ?.getAttribute('data-lazy-visible'),
      ).toBe('false');
      expect(MockChatIntersectionObserver.instances).toHaveLength(1);

      flushFrame();
      await vi.advanceTimersByTimeAsync(1);
      const observer = MockChatIntersectionObserver.instances[0];
      const older = view.container.querySelector('[data-lazy-turn-key="assistant-5"]')!;
      const frontier = view.container.querySelector('[data-lazy-turn-key="assistant-10"]')!;
      const newer = view.container.querySelector('[data-lazy-turn-key="assistant-18"]')!;

      observer.fire([{ target: older, isIntersecting: true }]);
      await tick();
      // The frontier is a retention barrier, never a hydration trigger: only
      // the intersecting row hydrates; unseen newer rows stay placeholders.
      expect(older.getAttribute('data-lazy-visible')).toBe('true');
      expect(newer.getAttribute('data-lazy-visible')).toBe('false');

      observer.fire([{ target: newer, isIntersecting: true }]);
      await tick();
      expect(newer.getAttribute('data-lazy-visible')).toBe('true');

      observer.fire([
        { target: frontier, isIntersecting: true },
        { target: older, isIntersecting: false },
        { target: newer, isIntersecting: false },
      ]);
      await vi.advanceTimersByTimeAsync(260);
      await tick();

      expect(older.getAttribute('data-lazy-visible')).toBe('false');
      expect(newer.getAttribute('data-lazy-visible')).toBe('true');
      expect(view.container.querySelector('[data-message-id="user-5"]')).not.toBeNull();
      expect(view.container.querySelector('[data-message-id="assistant-18"]')).not.toBeNull();
      view.unmount();
      unmounted = true;
      expect(observer.observed.size).toBe(0);
    } finally {
      if (!unmounted) view.unmount();
      offsetHeight.mockRestore();
      offsetWidth.mockRestore();
    }
  });

  it('virtualizes assistant-heavy Chief transcripts within one recent turn', async () => {
    MockChatIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockChatIntersectionObserver);
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      {
        id: 'user-heavy',
        role: 'user',
        content: 'coordinate a long run',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `assistant-heavy-${index}`,
        role: 'assistant',
        content: `assistant update ${index}`,
        timestamp: `2026-01-01T00:00:${String(index + 1).padStart(2, '0')}.000Z`,
      })),
    ]);

    const view = render(ChatPanel, {
      props: { workspace: workspace('__chief__'), agentId: 'agent-a' },
    });
    await tick();
    await tick();

    expect(view.container.querySelector('[data-message-id="user-heavy"]')).not.toBeNull();
    expect(
      view.container
        .querySelector('[data-lazy-turn-key="assistant-heavy-0"]')
        ?.getAttribute('data-lazy-visible'),
    ).toBe('false');
    expect(
      view.container
        .querySelector('[data-lazy-turn-key="assistant-heavy-11"]')
        ?.getAttribute('data-lazy-visible'),
    ).toBe('false');
  });

  it('does not attach a new pre-output terminal error to the previous assistant row', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      {
        id: 'assistant-dom-1',
        role: 'assistant',
        content: 'visible answer',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });

    expect(mocks.reportStreamLifecycle).not.toHaveBeenCalled();
    await tick();
    await tick();

    const assistantRow = view.container.querySelector(
      '[data-message-role="assistant"][data-message-id="assistant-dom-1"]',
    );
    expect(assistantRow).not.toBeNull();
    expect(mocks.reportStreamLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'render',
        event: 'assistant-message-committed',
        correlationBasis: 'assistant-message',
        blockCount: assistantRow!.querySelectorAll('[data-message-content-block]').length,
        storeStreamState: 'idle',
        callbackResult: 'delivered',
      }),
    );

    mocks.reportStreamLifecycle.mockClear();
    mocks.failureCorrelation.set({ turnIdCorrelation: '12c09885d6571b4e' });
    mocks.chatError.set('terminal failure');
    await tick();
    await tick();

    expect(view.container.querySelector('[data-stream-terminal-error="true"]')).not.toBeNull();
    const errorDiagnostic = mocks.reportStreamLifecycle.mock.calls
      .map(([diagnostic]) => diagnostic)
      .find((diagnostic) => diagnostic.event === 'terminal-error-committed');
    expect(errorDiagnostic).toEqual(
      expect.objectContaining({
        stage: 'render',
        turnIdCorrelation: '12c09885d6571b4e',
        correlationBasis: 'turn',
        terminalErrorVisible: true,
        storeStreamState: 'error',
        callbackResult: 'delivered',
      }),
    );
    expect(errorDiagnostic).not.toHaveProperty('turnCorrelation');
    expect(mocks.reportStreamLifecycle).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'assistant-message-committed' }),
    );
  });

  it('labels a DOM-observed terminal error unjoinable when no safe correlation exists', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      {
        id: 'assistant-old-unjoinable',
        role: 'assistant',
        content: 'old answer',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });

    await tick();
    await tick();
    mocks.reportStreamLifecycle.mockClear();
    mocks.chatError.set('terminal failure');
    await tick();
    await tick();

    expect(view.container.querySelector('[data-stream-terminal-error="true"]')).not.toBeNull();
    expect(mocks.reportStreamLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'terminal-error-committed',
        correlationBasis: 'unjoinable',
        terminalErrorVisible: true,
      }),
    );
    expect(mocks.reportStreamLifecycle).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'terminal-error-committed',
        turnCorrelation: expect.any(String),
      }),
    );
  });

  it('does not claim an assistant row is committed while first hydration hides it', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.transcriptHydratedOnce.set(false);
    mocks.transcriptHydration.set('loading');
    mocks.agentMessages.set([
      {
        id: 'assistant-hidden-1',
        role: 'assistant',
        content: 'not yet visible',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });

    await tick();
    await tick();

    expect(
      view.container.querySelector(
        '[data-message-role="assistant"][data-message-id="assistant-hidden-1"]',
      ),
    ).toBeNull();
    expect(mocks.reportStreamLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'render',
        event: 'assistant-message-not-committed',
        correlationBasis: 'assistant-message',
        blockCount: 0,
        callbackResult: 'ignored',
      }),
    );
  });

  it('restores active typing synchronously when the whole chat panel is recreated', async () => {
    // Stateful mock daemon: the flush-at-unmount save is issued before the
    // remount's get on the same ordered connection, so the daemon answers
    // the revalidation with the saved draft, not a stale null.
    let daemonDraft: { text: string } | null = null;
    mocks.draftGet.mockImplementation(() => Promise.resolve(daemonDraft));
    mocks.draftSet.mockImplementation((_ws: string, _agent: string, text: string) => {
      daemonDraft = text ? { text } : null;
      return Promise.resolve({ ok: true as const, updatedAt: '2026-01-01T00:00:00.000Z' });
    });
    const firstView = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'survive a sibling update' },
    });

    expect(mocks.chatDrafts['workspace-a::agent-a']).toBeUndefined();
    fireEvent.focusOut(screen.getByTestId('chat-composer-controls-inner'));
    expect(mocks.chatDrafts['workspace-a::agent-a']).toBe('survive a sibling update');
    firstView.unmount();
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe(
      'survive a sibling update',
    );
  });

  it('coalesces a burst of draft changes and commits the latest value', async () => {
    mocks.draftGet.mockResolvedValue(null);
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    mocks.dispatch.mockClear();

    const editor = screen.getByTestId('mock-rich-input-editor');
    await fireEvent.input(editor, { target: { value: 'a' } });
    await fireEvent.input(editor, { target: { value: 'ab' } });
    await fireEvent.input(editor, { target: { value: 'abc' } });

    expect(mocks.dispatch.mock.calls).toHaveLength(0);
    fireEvent.focusOut(screen.getByTestId('chat-composer-controls-inner'));

    const draftActions = mocks.dispatch.mock.calls.filter(
      ([action]) => action?.type === 'transientUi/setChatDraft',
    );
    expect(draftActions).toHaveLength(1);
    expect(draftActions[0][0].payload).toEqual(['workspace-a', 'agent-a', 'abc']);
  });

  it('keeps the composer mounted (wizard auto-collapsed) when questions arrive mid-typing', async () => {
    mocks.draftGet.mockResolvedValue(null);
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await Promise.resolve();
    await tick();

    const editorBefore = screen.getByTestId('mock-rich-input-editor');
    await fireEvent.input(editorBefore, {
      target: { value: 'keep this draft' },
    });
    mocks.pendingQuestions = { messageId: 'question-1', questions: [] };
    mocks.agentMessages.set([{ id: 'question-1' }]);
    await tick();
    // Auto-collapse resolves synchronously with the pendingQuestions change:
    // the wizard's first render is already the collapsed banner and the
    // composer's input element is NEVER destroyed — the exact same DOM node
    // survives (a transient expanded render would recreate it, dropping
    // editor focus/selection and in-progress IME composition even though the
    // text rebinds).
    expect(screen.getByTestId('question-wizard-slot')).not.toBeNull();
    expect(screen.getByTestId('mock-rich-input-editor')).toBe(editorBefore);
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe(
      'keep this draft',
    );

    mocks.pendingQuestions = null;
    mocks.agentMessages.set([]);
    await tick();
    await tick();

    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe(
      'keep this draft',
    );
    expect(mocks.draftGet).toHaveBeenCalledOnce();
  });

  it('replaces the composer with the wizard when questions arrive on an empty composer', async () => {
    mocks.draftGet.mockResolvedValue(null);
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await Promise.resolve();
    await tick();

    mocks.pendingQuestions = { messageId: 'question-1', questions: [] };
    mocks.agentMessages.set([{ id: 'question-1' }]);
    await tick();
    expect(screen.getByTestId('question-wizard-slot')).not.toBeNull();
    expect(screen.queryByTestId('mock-rich-input')).toBeNull();
  });

  it('does not overwrite typing that races delayed draft hydration', async () => {
    const draft = deferred<{ text: string }>();
    mocks.draftGet.mockReturnValue(draft.promise);
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    draft.resolve({ text: 'restored draft' });
    await Promise.resolve();
    await tick();
    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'restored draft plus new typing' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe(
      'restored draft plus new typing',
    );
  });

  it('ignores a pending draft restore while inactive and restores again on reactivation', async () => {
    const inactiveRestore = deferred<{ text: string }>();
    mocks.draftGet
      .mockImplementationOnce(() => inactiveRestore.promise)
      .mockResolvedValueOnce({ text: 'restored when active' });
    const currentWorkspace = workspace('workspace-a');
    const view = render(ChatPanel, {
      props: { workspace: currentWorkspace, agentId: 'agent-a', isActive: true },
    });
    await tick();

    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: false });
    inactiveRestore.resolve({ text: 'must stay inactive' });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('');

    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: true });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe(
      'restored when active',
    );
  });

  it('keeps the composer clear when a pending draft restore resolves after send', async () => {
    const draft = deferred<{ text: string }>();
    mocks.draftGet.mockReturnValue(draft.promise);
    mocks.draftClear.mockResolvedValue({ ok: true });
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'send this once' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    await tick();

    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('');
    expect(mocks.draftClear).toHaveBeenCalledWith('workspace-a', 'agent-a');

    draft.resolve({ text: 'send this once' });
    await Promise.resolve();
    await tick();
    await vi.advanceTimersByTimeAsync(60);

    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('');
  });

  it('expires an unclaimed send launch bubble at the bounded transition deadline', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.draftClear.mockResolvedValue({ ok: true });
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'send without an optimistic transcript row' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    const bubble = mocks.createMessageSendLaunchBubble.mock.results.at(-1)?.value as HTMLElement;
    expect(bubble.isConnected).toBe(true);

    await vi.advanceTimersByTimeAsync(2999);
    expect(bubble.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(bubble.isConnected).toBe(false);
    expect(mocks.animateMessageSend).not.toHaveBeenCalled();
  });

  it('removes a pending send launch bubble when the panel is destroyed', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.draftClear.mockResolvedValue({ ok: true });
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'pending handoff' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    const bubble = mocks.createMessageSendLaunchBubble.mock.results.at(-1)?.value as HTMLElement;
    expect(bubble.isConnected).toBe(true);

    view.unmount();
    expect(bubble.isConnected).toBe(false);
  });

  it('matches a delayed optimistic row once and restores the focused composer after finish', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.draftClear.mockResolvedValue({ ok: true });
    const finish = deferred<void>();
    mocks.animateMessageSend.mockImplementation(
      async ({ launchBubble }: { launchBubble?: HTMLElement | null }) => {
        await finish.promise;
        launchBubble?.remove();
      },
    );
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const editor = screen.getByTestId('mock-rich-input-editor');
    editor.focus();
    await fireEvent.input(editor, { target: { value: 'delayed optimistic row' } });
    (screen.getByTestId('mock-input-submit') as HTMLButtonElement).click();

    await vi.advanceTimersByTimeAsync(2500);
    const appMessageId = latestSentAppMessageId();
    mocks.agentMessages.set([optimisticUserMessage(appMessageId, 'delayed optimistic row')]);
    await tick();
    await Promise.resolve();
    await tick();

    expect(mocks.animateMessageSend).toHaveBeenCalledOnce();
    expect(
      view.container.querySelectorAll(`[data-send-app-message-id="${appMessageId}"]`),
    ).toHaveLength(1);
    expect(document.activeElement).toBe(editor);
    finish.resolve();
    await Promise.resolve();
    await tick();

    const row = view.container.querySelector<HTMLElement>(
      `[data-send-app-message-id="${appMessageId}"]`,
    );
    expect(row?.classList.contains('invisible')).toBe(false);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
    expect(document.activeElement).toBe(editor);
  });

  it('aborts an active handoff on destroy and removes its launch bubble', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.draftClear.mockResolvedValue({ ok: true });
    let signal: AbortSignal | undefined;
    mocks.animateMessageSend.mockImplementation(
      ({
        signal: nextSignal,
        launchBubble,
      }: {
        signal?: AbortSignal;
        launchBubble?: HTMLElement | null;
      }) =>
        new Promise<void>((resolve) => {
          signal = nextSignal;
          nextSignal?.addEventListener(
            'abort',
            () => {
              launchBubble?.remove();
              resolve();
            },
            { once: true },
          );
        }),
    );
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'active handoff' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    const appMessageId = latestSentAppMessageId();
    mocks.agentMessages.set([optimisticUserMessage(appMessageId, 'active handoff')]);
    await tick();
    await Promise.resolve();
    await tick();
    expect(signal?.aborted).toBe(false);

    view.unmount();

    expect(signal?.aborted).toBe(true);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('aborts an active handoff when the mounted panel changes agent', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.draftClear.mockResolvedValue({ ok: true });
    let signal: AbortSignal | undefined;
    mocks.animateMessageSend.mockImplementation(
      ({ signal: nextSignal }: { signal?: AbortSignal }) =>
        new Promise<void>((resolve) => {
          signal = nextSignal;
          nextSignal?.addEventListener('abort', () => resolve(), { once: true });
        }),
    );
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'handoff before agent rebind' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    const appMessageId = latestSentAppMessageId();
    mocks.agentMessages.set([optimisticUserMessage(appMessageId, 'handoff before agent rebind')]);
    await tick();
    await Promise.resolve();
    await tick();
    expect(signal?.aborted).toBe(false);

    await view.rerender({ workspace: workspace('workspace-a'), agentId: 'agent-b' });
    await tick();

    expect(signal?.aborted).toBe(true);
  });

  it('keeps rapid ordinary sends unique and expires the only unmatched launch bubble', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.draftClear.mockResolvedValue({ ok: true });
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    for (const text of ['first rapid send', 'second rapid send']) {
      await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
        target: { value: text },
      });
      await fireEvent.click(screen.getByTestId('mock-input-submit'));
    }
    const sendActions = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === 'chatState/sendMessage');
    const identities = sendActions.map((action) => action.payload.payload.userAppMessageId);

    expect(new Set(identities).size).toBe(2);
    expect(mocks.createMessageSendLaunchBubble).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[data-message-send-transition]')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('re-engages follow and scrolls to the bottom on send even when scrolled up', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;

    // Simulate the user scrolling up mid-conversation: auto-follow disengages.
    mocks.followBottomOptions?.onFollowChange?.(false);
    await tick();
    vi.mocked(scrollToBottomUtil).mockClear();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'sent from a scrolled-up transcript' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    await tick();
    await Promise.resolve();
    await tick();

    expect(vi.mocked(scrollToBottomUtil)).toHaveBeenCalledWith(scrollContainer);

    // Follow was re-engaged: the unmount-time cache records follow=true.
    view.unmount();
    expect(getCachedChatScroll('workspace-a', 'agent-a')).toMatchObject({
      shouldFollowBottom: true,
    });
  });

  it('re-engages follow and scrolls to the bottom on send even when drafts.clear never settles', async () => {
    // Regression: the followBottom branch of performLocalSendCleanup used to
    // run after `await appClient.drafts.clear(...)`, so a stalled (or
    // rejecting) clear delayed or skipped the scroll + follow re-lock. It must
    // run synchronously, before the drafts round-trip.
    mocks.draftGet.mockResolvedValue(null);
    mocks.draftClear.mockReturnValue(new Promise(() => {}));
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;

    // Simulate the user scrolling up mid-conversation: auto-follow disengages.
    mocks.followBottomOptions?.onFollowChange?.(false);
    await tick();
    vi.mocked(scrollToBottomUtil).mockClear();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'sent while drafts.clear hangs' },
    });
    await fireEvent.click(screen.getByTestId('mock-input-submit'));
    await tick();

    // The clear is still pending, yet the scroll + re-lock already happened.
    expect(mocks.draftClear).toHaveBeenCalledWith('workspace-a', 'agent-a');
    expect(vi.mocked(scrollToBottomUtil)).toHaveBeenCalledWith(scrollContainer);

    // Follow was re-engaged: the unmount-time cache records follow=true.
    view.unmount();
    expect(getCachedChatScroll('workspace-a', 'agent-a')).toMatchObject({
      shouldFollowBottom: true,
    });
  });

  it('re-engages follow and scrolls to the bottom on edit-and-regenerate when scrolled up', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'u1', role: 'user', content: 'original prompt', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;

    // Simulate the user scrolling up mid-conversation: auto-follow disengages.
    mocks.followBottomOptions?.onFollowChange?.(false);
    await tick();
    vi.mocked(scrollToBottomUtil).mockClear();

    // Confirm an edit-and-regenerate on the user message.
    await fireEvent.click(screen.getByTestId('mock-edit-submit'));
    await tick();
    await Promise.resolve();
    await tick();

    expect(vi.mocked(scrollToBottomUtil)).toHaveBeenCalledWith(scrollContainer);

    // Follow was re-engaged: the unmount-time cache records follow=true.
    view.unmount();
    expect(getCachedChatScroll('workspace-a', 'agent-a')).toMatchObject({
      shouldFollowBottom: true,
    });
  });

  it('keeps draft restore and save ownership with the rebound workspace and agent', async () => {
    const draftA = deferred<{ text: string }>();
    const draftB = deferred<{ text: string }>();
    mocks.draftGet.mockImplementation((workspaceId: string) =>
      workspaceId === 'workspace-a' ? draftA.promise : draftB.promise,
    );
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    await view.rerender({ workspace: workspace('workspace-b'), agentId: 'agent-b' });
    await tick();
    draftA.resolve({ text: 'draft from A' });
    await Promise.resolve();
    await tick();
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('');

    draftB.resolve({ text: 'draft from B' });
    await Promise.resolve();
    await tick();
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('draft from B');

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'draft from B plus typing' },
    });
    await vi.advanceTimersByTimeAsync(550);
    expect(mocks.draftSet).toHaveBeenCalledWith(
      'workspace-b',
      'agent-b',
      'draft from B plus typing',
      undefined,
    );
    expect(mocks.draftSet).not.toHaveBeenCalledWith('workspace-b', 'agent-b', 'draft from A');
    expect(mocks.draftSet).not.toHaveBeenCalledWith('workspace-a', 'agent-a', expect.anything());
  });

  it('flushes the pending debounced draft save on unmount instead of dropping it', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await Promise.resolve();
    await tick();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'final keystrokes' },
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.draftSet).not.toHaveBeenCalled();

    view.unmount();

    expect(mocks.draftSet).toHaveBeenCalledWith(
      'workspace-a',
      'agent-a',
      'final keystrokes',
      undefined,
    );
  });

  it('flushes the pending debounced draft save when rebinding to another agent', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await Promise.resolve();
    await tick();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'typed just before switching' },
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.draftSet).not.toHaveBeenCalled();

    await view.rerender({ workspace: workspace('workspace-b'), agentId: 'agent-b' });
    await tick();

    expect(mocks.draftSet).toHaveBeenCalledWith(
      'workspace-a',
      'agent-a',
      'typed just before switching',
      undefined,
    );
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('');
  });

  it('gates the composer during a slow first restore and shows the indicator after 500ms', async () => {
    const draft = deferred<{ text: string } | null>();
    mocks.draftGet.mockReturnValue(draft.promise);
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    expect(screen.getByTestId('mock-rich-input').getAttribute('data-input-locked')).toBe('true');
    expect(screen.queryByTestId('chat-draft-loading-gate')).toBeNull();

    await vi.advanceTimersByTimeAsync(500);
    expect(screen.getByTestId('chat-draft-loading-gate')).not.toBeNull();

    draft.resolve({ text: 'restored draft' });
    await Promise.resolve();
    await tick();

    expect(screen.queryByTestId('chat-draft-loading-gate')).toBeNull();
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-input-locked')).toBe('false');
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('restored draft');
  });

  it('releases the composer gate after 5s if the draft restore hangs', async () => {
    mocks.draftGet.mockReturnValue(new Promise(() => {}));
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    await vi.advanceTimersByTimeAsync(500);
    expect(screen.getByTestId('chat-draft-loading-gate')).not.toBeNull();
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-input-locked')).toBe('true');

    await vi.advanceTimersByTimeAsync(4500);
    expect(screen.queryByTestId('chat-draft-loading-gate')).toBeNull();
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-input-locked')).toBe('false');
  });

  it('settles only a current-owner restore error and saves after the user edits', async () => {
    const draftA = deferred<never>();
    const draftB = deferred<never>();
    mocks.draftGet.mockImplementation((workspaceId: string) =>
      workspaceId === 'workspace-a' ? draftA.promise : draftB.promise,
    );
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    await view.rerender({ workspace: workspace('workspace-b'), agentId: 'agent-b' });
    draftA.reject(new Error('stale restore failed'));
    await Promise.resolve();
    await tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.draftSet).not.toHaveBeenCalled();

    draftB.reject(new Error('current restore failed'));
    await Promise.resolve();
    await tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.draftSet).not.toHaveBeenCalled();
    expect(mocks.draftClear).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'local edit after restore failure' },
    });
    await tick();
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.draftSet).toHaveBeenCalledOnce();
    expect(mocks.draftSet).toHaveBeenCalledWith(
      'workspace-b',
      'agent-b',
      'local edit after restore failure',
      undefined,
    );
  });

  it('tears down container-owned prompt tracking when destroyed immediately', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    expect(frames.length).toBeGreaterThan(0);

    view.unmount();
    flushFrame();

    expect(mocks.resizeConstructor).not.toHaveBeenCalled();
    expect(mocks.resizeDisconnect).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  it('detaches IPC, observer, and scroll-action lifecycles while inactive and restores them', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const currentWorkspace = workspace('workspace-a');
    const view = render(ChatPanel, {
      props: { workspace: currentWorkspace, agentId: 'agent-a', isActive: true },
    });
    await tick();

    expect(mocks.listenSync).toHaveBeenCalledTimes(3);
    expect(mocks.followBottomOptions?.enabled).toBe(true);

    flushFrame();
    const transcript = screen.getByTestId('chat-transcript-scroll-viewport');
    const sizeObserverCallback = mocks.resizeConstructor.mock.calls[0]?.[0] as
      ResizeObserverCallback | undefined;
    sizeObserverCallback?.(
      [{ target: transcript, contentRect: { height: 600 } }] as unknown as ResizeObserverEntry[],
      {} as ResizeObserver,
    );
    await tick();
    expect(mocks.pinnedPromptOptions?.enabled).toBe(true);

    const disconnectsBeforeDeactivate = mocks.resizeDisconnect.mock.calls.length;
    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: false });
    await tick();

    expect(mocks.ipcListenerCleanups).toHaveLength(3);
    expect(
      mocks.ipcListenerCleanups.every((cleanupListener) => cleanupListener.mock.calls.length === 1),
    ).toBe(true);
    expect(mocks.followBottomOptions?.enabled).toBe(false);
    expect(mocks.pinnedPromptOptions?.enabled).toBe(false);
    expect(mocks.resizeDisconnect.mock.calls.length).toBeGreaterThan(disconnectsBeforeDeactivate);

    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: true });
    await tick();
    expect(mocks.listenSync).toHaveBeenCalledTimes(6);
    expect(mocks.followBottomOptions?.enabled).toBe(true);
  });

  it('cancels pending spacer work on deactivation and permits a fresh active schedule', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const currentWorkspace = workspace('workspace-a');
    const view = render(ChatPanel, {
      props: { workspace: currentWorkspace, agentId: 'agent-a', isActive: true },
    });
    await tick();
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'first', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    await tick();

    const spacerCallIndex = setTimeoutSpy.mock.calls.findLastIndex(([, delay]) => delay === 400);
    expect(spacerCallIndex).toBeGreaterThanOrEqual(0);
    const spacerTimer = setTimeoutSpy.mock.results[spacerCallIndex]?.value;
    const staleSpacerCallback = setTimeoutSpy.mock.calls[spacerCallIndex]?.[0] as () => void;

    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: false });
    expect(clearTimeoutSpy).toHaveBeenCalledWith(spacerTimer);
    const dispatchCount = mocks.dispatch.mock.calls.length;
    staleSpacerCallback();
    expect(mocks.dispatch).toHaveBeenCalledTimes(dispatchCount);

    const schedulesBeforeReactivate = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 400,
    ).length;
    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: true });
    mocks.agentMessages.set([
      { id: 'm2', role: 'assistant', content: 'second', timestamp: '2026-01-01T00:00:01.000Z' },
    ]);
    await tick();
    expect(setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 400).length).toBeGreaterThan(
      schedulesBeforeReactivate,
    );
  });

  it('cancels pending turn highlights and open-message frames while inactive', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      {
        id: 'message-a',
        role: 'assistant',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: [{ type: 'tool_use', id: 'subscription-a' }],
      },
    ]);
    const currentWorkspace = workspace('workspace-a');
    const view = render(ChatPanel, {
      props: { workspace: currentWorkspace, agentId: 'agent-a', isActive: true },
    });
    await tick();
    const transcript = screen.getByTestId('chat-transcript-scroll-viewport');
    const target = document.createElement('div');
    target.dataset.turnNumber = '7';
    target.dataset.messageId = 'message-a';
    transcript.appendChild(target);

    window.dispatchEvent(
      new CustomEvent('agent:scroll-to-turn', {
        detail: { agentId: 'agent-a', turnNumber: 7 },
      }),
    );
    expect(target.classList.contains('highlight-flash')).toBe(true);
    window.dispatchEvent(
      new CustomEvent('agent:scroll-to-subscription', {
        detail: { agentId: 'agent-a', subscriptionId: 'subscription-a' },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('chat:open-message', {
        detail: {
          agentId: 'agent-a',
          messageId: 'message-a',
          query: 'needle',
          requestId: 'request-a',
        },
      }),
    );
    await tick();

    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: false });
    await vi.advanceTimersByTimeAsync(1600);
    while (frames.length > 0) flushFrame();
    expect(target.classList.contains('highlight-flash')).toBe(true);
    expect(target.classList.contains('message-highlight-flash')).toBe(false);

    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: true });
    window.dispatchEvent(
      new CustomEvent('agent:scroll-to-turn', {
        detail: { agentId: 'agent-a', turnNumber: 7 },
      }),
    );
    await vi.advanceTimersByTimeAsync(1600);
    expect(target.classList.contains('highlight-flash')).toBe(false);
  });

  it('cancels active highlight timers and open-message frames on unmount', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const cancelAnimationFrameSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a', isActive: true },
    });
    await tick();
    while (frames.length > 0) flushFrame();

    const transcript = screen.getByTestId('chat-transcript-scroll-viewport');
    const target = document.createElement('div');
    target.dataset.turnNumber = '7';
    target.dataset.messageId = 'message-a';
    transcript.appendChild(target);

    window.dispatchEvent(
      new CustomEvent('agent:scroll-to-turn', {
        detail: { agentId: 'agent-a', turnNumber: 7 },
      }),
    );
    const highlightTimerCall = setTimeoutSpy.mock.calls.findLastIndex(
      ([, delay]) => delay === 1500,
    );
    expect(highlightTimerCall).toBeGreaterThanOrEqual(0);
    const highlightTimer = setTimeoutSpy.mock.results[highlightTimerCall]?.value;

    const frameIdsBeforeOpen = new Set(frames.map((frame) => frame.id));
    window.dispatchEvent(
      new CustomEvent('chat:open-message', {
        detail: {
          agentId: 'agent-a',
          messageId: 'message-a',
          requestId: 'request-a',
        },
      }),
    );
    await tick();
    await tick();
    const openFrame = frames.find((frame) => !frameIdsBeforeOpen.has(frame.id));
    expect(openFrame).toBeDefined();

    view.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(highlightTimer);
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(openFrame?.id);

    openFrame?.callback(performance.now());
    const staleHighlightCallback = setTimeoutSpy.mock.calls[highlightTimerCall]?.[0] as () => void;
    staleHighlightCallback();
    expect(target.classList.contains('message-highlight-flash')).toBe(false);
    expect(target.classList.contains('highlight-flash')).toBe(true);
  });

  it('cancels draftPrompt apply and focus while inactive and restores on reactivation', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentSession.set({
      id: 'agent-a',
      status: 'idle',
      messages: [],
      backendSessionId: 'backend-session-a',
    });
    const currentWorkspace = workspace('workspace-a');
    const view = render(ChatPanel, {
      props: {
        workspace: currentWorkspace,
        agentId: 'agent-a',
        isActive: true,
        draftPrompt: 'review this change',
      },
    });
    await tick();

    await view.rerender({
      workspace: currentWorkspace,
      agentId: 'agent-a',
      isActive: false,
      draftPrompt: 'review this change',
    });
    await vi.advanceTimersByTimeAsync(700);
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe('');

    await view.rerender({
      workspace: currentWorkspace,
      agentId: 'agent-a',
      isActive: true,
      draftPrompt: 'review this change',
    });
    await tick();
    await vi.advanceTimersByTimeAsync(100);
    await tick();
    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe(
      'review this change',
    );
  });

  it('does not render the moved bottom control inside the transcript', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([{ id: 'message-1' }]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-lane"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="chat-scroll-lock-button"]')).toBeNull();
  });

  it('reports true-bottom state to the stable header control', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      {
        id: 'message-1',
        role: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: [{ type: 'text', text: 'User prompt' }],
      },
    ]);
    const onNavigationStateChange = vi.fn();
    const view = render(ChatPanel, {
      props: {
        workspace: workspace('workspace-a'),
        agentId: 'agent-a',
        onNavigationStateChange,
      },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    flushFrame(); // bind the distance-from-bottom scroll tracker

    // Scrolling up still updates header navigation state, but the former
    // floating bottom-right arrow stays removed.
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 });
    scrollContainer.scrollTop = 100; // 500px from the bottom
    await fireEvent.scroll(scrollContainer);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(SCROLL_BUTTON_SHOW_SETTLE_MS);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]')).toBeNull();
    expect(onNavigationStateChange).toHaveBeenLastCalledWith({
      isAtBottom: false,
      userMessages: [{ id: 'message-1', text: 'User prompt' }],
      isLoadingUserMessageIndex: false,
    });

    scrollContainer.scrollTop = 600;
    await fireEvent.scroll(scrollContainer);
    await tick();
    expect(onNavigationStateChange).toHaveBeenLastCalledWith({
      isAtBottom: true,
      userMessages: [{ id: 'message-1', text: 'User prompt' }],
      isLoadingUserMessageIndex: false,
    });
    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]')).toBeNull();
  });

  it('reports a loading index only while the first index fetch is in flight', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      {
        id: 'message-1',
        role: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: [{ type: 'text', text: 'User prompt' }],
      },
    ]);
    const pending = deferred<{ ok: true; items: unknown[]; total: number }>();
    mocks.listUserMessages.mockReturnValue(pending.promise);
    const onNavigationStateChange = vi.fn();
    const view = render(ChatPanel, {
      props: {
        workspace: workspace('workspace-a'),
        agentId: 'agent-a',
        onNavigationStateChange,
      },
    });
    await tick();

    view.component.refreshUserMessageIndex();
    await tick();
    expect(mocks.listUserMessages).toHaveBeenCalledWith('agent-a');
    expect(onNavigationStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isLoadingUserMessageIndex: true }),
    );

    pending.resolve({
      ok: true,
      items: [
        { id: 'older-1', preview: 'Older prompt', createdAt: '2025-12-31T00:00:00.000Z' },
        { id: 'message-1', preview: 'User prompt', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      total: 2,
    });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(onNavigationStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isLoadingUserMessageIndex: false,
        userMessages: [
          { id: 'older-1', text: 'Older prompt' },
          { id: 'message-1', text: 'User prompt' },
        ],
      }),
    );

    // Reopen with a cached index: single-flight refresh must not re-report loading.
    onNavigationStateChange.mockClear();
    mocks.listUserMessages.mockClear();
    mocks.listUserMessages.mockReturnValue(new Promise(() => {}));
    view.component.refreshUserMessageIndex();
    await tick();
    expect(
      onNavigationStateChange.mock.calls.some(([state]) => state.isLoadingUserMessageIndex),
    ).toBe(false);
  });

  it('smoothly scrolls the header action before re-locking at the live bottom', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([{ id: 'message-1' }]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    flushFrame();
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
    });
    scrollContainer.scrollTop = 100;
    mocks.followBottomOptions?.onFollowChange?.(false);
    await tick();
    vi.mocked(scrollToBottomUtil).mockClear();
    mocks.animateScrollTo.mockClear();

    view.component.scrollToBottom();

    expect(animateScrollToUtil).toHaveBeenCalledOnce();
    const [getContainer, target, duration, onComplete] = mocks.animateScrollTo.mock.calls[0];
    expect(getContainer()).toBe(scrollContainer);
    expect(target).toBe(600);
    expect(duration).toBe(150);
    expect(scrollToBottomUtil).not.toHaveBeenCalled();

    onComplete(scrollContainer);
    await tick();
    expect(scrollToBottomUtil).toHaveBeenCalledOnce();
    expect(scrollToBottomUtil).toHaveBeenCalledWith(scrollContainer);
    expect(mocks.followBottomOptions?.follow).toBe(true);
  });

  it('scrolls the header action immediately when reduced motion is preferred', async () => {
    mocks.prefersReducedMotion = true;
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([{ id: 'message-1' }]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    flushFrame();
    mocks.followBottomOptions?.onFollowChange?.(false);
    await tick();
    vi.mocked(scrollToBottomUtil).mockClear();
    mocks.animateScrollTo.mockClear();

    view.component.scrollToBottom();
    await tick();

    expect(animateScrollToUtil).not.toHaveBeenCalled();
    expect(scrollToBottomUtil).toHaveBeenCalledOnce();
    expect(scrollToBottomUtil).toHaveBeenCalledWith(scrollContainer);
    expect(mocks.followBottomOptions?.follow).toBe(true);
  });

  it('flashes a decorative lock confirmation when scrolling back to the bottom re-locks', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([{ id: 'message-1' }]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    flushFrame(); // bind the distance-from-bottom scroll tracker

    // No confirmation while merely sitting at the bottom.
    const selector = '[data-testid="chat-scroll-lock-confirmation"]';
    expect(view.container.querySelector(selector)).toBeNull();

    // Scroll up past the threshold (and let the show settle so the button
    // commits), then back to the bottom → re-lock flash.
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 });
    scrollContainer.scrollTop = 100; // 500px from the bottom
    await fireEvent.scroll(scrollContainer);
    await vi.advanceTimersByTimeAsync(SCROLL_BUTTON_SHOW_SETTLE_MS);
    await tick();
    expect(view.container.querySelector(selector)).toBeNull();

    scrollContainer.scrollTop = 600; // back at the bottom
    await fireEvent.scroll(scrollContainer);
    await tick();
    const confirmation = view.container.querySelector(selector);
    expect(confirmation).not.toBeNull();
    // Purely decorative: hidden from the accessibility tree, not hit-testable,
    // and not a focusable control (regression guard for monorepo#2508).
    expect(confirmation!.getAttribute('aria-hidden')).toBe('true');
    expect(confirmation!.classList.contains('pointer-events-none')).toBe(true);
    expect(confirmation!.tagName).toBe('DIV');

    // The flash unmounts after its display window.
    await vi.advanceTimersByTimeAsync(1500);
    await tick();
    expect(view.container.querySelector(selector)).toBeNull();
  });

  it('keeps the button and lock confirmation stable while the distance jitters across the threshold', async () => {
    // Regression: transient scrollHeight changes (lazy-turn placeholder swaps,
    // image loads) bounce distance-from-bottom across the 30px threshold every
    // frame. The button must not strobe in and the decorative lock
    // confirmation must not re-trigger from the same jitter.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([{ id: 'message-1' }]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    flushFrame(); // bind the distance-from-bottom scroll tracker

    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 });
    scrollContainer.scrollTop = 600;
    // Oscillate scrollHeight so the distance alternates 0px ↔ 300px per frame,
    // crossing the at-bottom threshold in both directions every ~16ms.
    for (let frame = 0; frame < 60; frame++) {
      Object.defineProperty(scrollContainer, 'scrollHeight', {
        configurable: true,
        value: frame % 2 === 0 ? 1300 : 1000,
      });
      await fireEvent.scroll(scrollContainer);
      await vi.advanceTimersByTimeAsync(16);
    }
    await tick();
    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]')).toBeNull();
    expect(
      view.container.querySelector('[data-testid="chat-scroll-lock-confirmation"]'),
    ).toBeNull();
  });

  it('tears down the single scroll authority and resize observation normally', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    const removeListener = vi.spyOn(scrollContainer, 'removeEventListener');

    flushFrame();
    expect(mocks.resizeObserve).toHaveBeenCalledWith(scrollContainer);

    scrollContainer.dispatchEvent(new Event('scroll'));
    view.unmount();

    // Scroll authority + read-only pinned-prompt tracker + older-history
    // scrollback trigger.
    expect(removeListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(3);
    expect(mocks.resizeDisconnect).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
  });

  it('caches the scroll position on unmount when the user scrolled away from the bottom', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });

    // Simulate the user scrolling up: followBottom reports follow=false and
    // the container sits at a mid-transcript offset.
    mocks.followBottomOptions?.onFollowChange?.(false);
    await tick();
    scrollContainer.scrollTop = 1234;

    view.unmount();

    expect(getCachedChatScroll('workspace-a', 'agent-a')).toEqual({
      scrollTop: 1234,
      shouldFollowBottom: false,
    });
  });

  it('caches the active reading position before a panel-column remount destroys it', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const firstView = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const firstScroll = firstView.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(firstScroll, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    mocks.followBottomOptions?.onFollowChange?.(false);
    await tick();
    firstScroll.scrollTop = 432;
    await fireEvent.scroll(firstScroll);

    expect(getCachedChatScroll('workspace-a', 'agent-a')).toEqual({
      scrollTop: 432,
      shouldFollowBottom: false,
    });

    // A root panel becoming a split can mount the replacement before Svelte
    // destroys the original branch. The replacement must still see the cache.
    const replacement = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    const replacementScroll = replacement.container.querySelector(
      '.overflow-y-auto',
    ) as HTMLDivElement;
    Object.defineProperties(replacementScroll, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    await tick();
    await Promise.resolve();
    await tick();
    flushFrame();
    expect(replacementScroll.scrollTop).toBe(432);
  });

  it('does not cache scroll state for an empty transcript', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    view.unmount();

    expect(getCachedChatScroll('workspace-a', 'agent-a')).toBeUndefined();
  });

  it('restores the cached reading position on remount instead of scrolling to bottom', async () => {
    mocks.draftGet.mockResolvedValue(null);
    setCachedChatScroll('workspace-a', 'agent-a', {
      scrollTop: 987,
      shouldFollowBottom: false,
    });
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    await tick();
    // Let the first-hydration restore (tick continuation) and the mount-time
    // rAF entry scroll both run.
    await Promise.resolve();
    await tick();
    flushFrame();

    expect(scrollContainer.scrollTop).toBe(987);
    expect(scrollToBottomUtil).not.toHaveBeenCalled();
  });

  it('defers the cached restore until the transcript can hold it instead of clamping to the top', async () => {
    // Regression (top-landing on workspace re-entry): the cached position
    // used to be applied and consumed against the still-short (skeleton)
    // container, where the browser clamps the write to ~0 — the panel then
    // stayed at the top once the real transcript rendered.
    mocks.draftGet.mockResolvedValue(null);
    setCachedChatScroll('workspace-a', 'agent-a', {
      scrollTop: 987,
      shouldFollowBottom: false,
    });
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    // Real browsers clamp scrollTop writes to the scrollable range; jsdom
    // stores them verbatim, so emulate the clamp.
    let scrollTopValue = 0;
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set(value: number) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        scrollTopValue = Math.max(0, Math.min(value, max));
      },
    });

    // First paint: the container is still collapsed (scrollHeight 0), so any
    // restore attempt here would clamp to the top.
    await tick();
    await Promise.resolve();
    await tick();
    flushFrame();
    expect(scrollContainer.scrollTop).toBe(0);

    // The transcript finishes rendering: the container becomes tall enough
    // to hold the cached position, and the deferred restore applies it.
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    flushFrame();
    expect(scrollContainer.scrollTop).toBe(987);
  });

  it('cancels a cached-scroll retry while inactive and restores it after reactivation', async () => {
    mocks.draftGet.mockResolvedValue(null);
    setCachedChatScroll('workspace-a', 'agent-a', {
      scrollTop: 987,
      shouldFollowBottom: false,
    });
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const currentWorkspace = workspace('workspace-a');
    const view = render(ChatPanel, {
      props: { workspace: currentWorkspace, agentId: 'agent-a', isActive: true },
    });
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    let scrollTopValue = 0;
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set(value: number) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        scrollTopValue = Math.max(0, Math.min(value, max));
      },
    });
    await tick();
    await Promise.resolve();
    await tick();
    flushFrame();

    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: false });
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    flushFrame();
    expect(scrollContainer.scrollTop).toBe(0);

    await view.rerender({ workspace: currentWorkspace, agentId: 'agent-a', isActive: true });
    await tick();
    while (frames.length > 0) flushFrame();
    expect(scrollContainer.scrollTop).toBe(987);
  });

  it('does not overwrite a useful cached position when unmounted while collapsed', async () => {
    // Regression (top-landing on workspace re-entry): a panel unmounted
    // before its container ever rendered (collapsed, scrollTop 0) used to
    // record { scrollTop: 0 } over the previous instance's real reading
    // position, so the next mount landed at the top.
    mocks.draftGet.mockResolvedValue(null);
    setCachedChatScroll('workspace-a', 'agent-a', {
      scrollTop: 987,
      shouldFollowBottom: false,
    });
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    // The container never rendered any scrollable content before destroy.
    view.unmount();

    expect(getCachedChatScroll('workspace-a', 'agent-a')).toEqual({
      scrollTop: 987,
      shouldFollowBottom: false,
    });
  });

  it('applies the clamped position once the rendered container exhausts the retry budget', async () => {
    // Exhausted-budget branch: the container has rendered (non-zero client
    // height) but the transcript is genuinely shorter than the cached
    // position (e.g. pruned scrollback rows). After the bounded retry
    // budget, the restore applies clamped — the nearest valid position.
    mocks.draftGet.mockResolvedValue(null);
    setCachedChatScroll('workspace-a', 'agent-a', {
      scrollTop: 987,
      shouldFollowBottom: false,
    });
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    let scrollTopValue = 0;
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set(value: number) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        scrollTopValue = Math.max(0, Math.min(value, max));
      },
    });
    // Rendered but held too short for the cached position for the whole run.
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 500 },
    });
    await tick();
    await Promise.resolve();
    await tick();
    expect(scrollContainer.scrollTop).toBe(0);

    // Drain the bounded retry budget (60 rendered-frame attempts, plus the
    // mount-time entry-scroll frame): the loop must terminate on its own —
    // never an unbounded rAF retry — and the final attempt applies clamped
    // to the nearest valid position (max scrollTop 300).
    for (let frame = 0; frame < 100 && frames.length > 0; frame++) flushFrame();
    expect(frames).toHaveLength(0);
    expect(scrollContainer.scrollTop).toBe(300);
  });

  it('cancels the pending deferred restore on the first user-initiated scroll', async () => {
    // A late deferred apply must never yank the viewport after the user has
    // started scrolling: the first wheel/touch input while the restore is
    // still pending cancels it for good.
    mocks.draftGet.mockResolvedValue(null);
    setCachedChatScroll('workspace-a', 'agent-a', {
      scrollTop: 987,
      shouldFollowBottom: false,
    });
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    let scrollTopValue = 0;
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set(value: number) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        scrollTopValue = Math.max(0, Math.min(value, max));
      },
    });
    // Container still collapsed: the restore stays pending on the rAF loop.
    await tick();
    await Promise.resolve();
    await tick();
    flushFrame();
    expect(scrollContainer.scrollTop).toBe(0);

    // The user starts scrolling before the transcript grows tall enough.
    scrollContainer.dispatchEvent(new Event('wheel'));

    // The container then becomes tall enough — the cancelled restore must
    // NOT fire, even across further frames.
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    flushFrame();
    flushFrame();
    expect(scrollContainer.scrollTop).toBe(0);
  });

  it('does not record a destroy-time cache write after the divider session ended (boundary)', async () => {
    // Stop-looking boundary ordering: the boundary saga clears the cache and
    // dispatches endDividerSession in the same tick, BEFORE Svelte's
    // teardown flush runs this panel's onDestroy. The destroy-time write
    // must observe the ended session and refuse to repopulate the cleared
    // entry, or re-entry would restore the stale position instead of
    // following the entry policy (bottom / divider).
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    mocks.followBottomOptions?.onFollowChange?.(false);
    await tick();
    scrollContainer.scrollTop = 1234;

    // The boundary: cache cleared, divider session ended — both before the
    // teardown flush destroys this panel.
    clearCachedChatScroll(['agent-a']);
    mocks.dividerSessionValue = null;
    view.unmount();

    expect(getCachedChatScroll('workspace-a', 'agent-a')).toBeUndefined();
  });

  it('re-enters at the bottom on remount when the previous instance was following the bottom', async () => {
    mocks.draftGet.mockResolvedValue(null);
    setCachedChatScroll('workspace-a', 'agent-a', {
      scrollTop: 500,
      shouldFollowBottom: true,
    });
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await Promise.resolve();
    await tick();
    flushFrame();

    expect(scrollToBottomUtil).toHaveBeenCalled();
  });

  it('holds the indeterminate skeleton on switch-back until the resubscribe snapshot applies', async () => {
    // Switch-back reveal gate: the retained transcript may be stale while the
    // re-opened standing subscription's seq-0 snapshot is in flight — the
    // skeleton must cover it, then the transcript reveals in one paint.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      {
        id: 'm1',
        role: 'assistant',
        content: 'stale hello',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.awaitingSwitchBackSnapshot.set(true);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    // Gate armed: skeleton up, retained message list suppressed.
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).not.toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).toBeNull();

    // Snapshot applied (slice clears the flag) → transcript reveals.
    mocks.awaitingSwitchBackSnapshot.set(false);
    await tick();

    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).not.toBeNull();
  });

  it('reveals the retained transcript when the bounded fallback clears the gate', async () => {
    // The saga-owned fallback (no snapshot within the wait window) clears the
    // same flag — the retained messages must come back rather than a
    // permanently stuck skeleton.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'retained', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.awaitingSwitchBackSnapshot.set(true);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).not.toBeNull();

    // Fallback timeout fires in the saga → flag cleared, retained list shown.
    mocks.awaitingSwitchBackSnapshot.set(false);
    await tick();

    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).not.toBeNull();
  });

  it('hides the pinned-prompt overlay while the switch-back reveal is deferred', async () => {
    // The overlay renders from retained `pinnedPrompt` state that
    // trackPinnedPrompt only clears on a later animation frame after the
    // turns unmount — it must not paint stale message content above the
    // skeleton while the gate holds.
    mocks.draftGet.mockResolvedValue(null);
    const message = {
      id: 'm1',
      role: 'user',
      content: 'stale pinned prompt',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    mocks.agentMessages.set([message]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    // The user is scrolled into a pinned user prompt.
    mocks.pinnedPromptOptions?.onChange({ id: 'm1', message });
    await tick();
    expect(
      view.container.querySelector('[data-testid="pinned-prompt-overlay-lane"]'),
    ).not.toBeNull();

    // Gate arms (switch-back): the skeleton and the overlay swap in the same
    // paint — no stale pinned content above the skeleton.
    mocks.awaitingSwitchBackSnapshot.set(true);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="pinned-prompt-overlay-lane"]')).toBeNull();

    // Snapshot applies (slice clears the flag) → transcript and overlay return.
    mocks.awaitingSwitchBackSnapshot.set(false);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(
      view.container.querySelector('[data-testid="pinned-prompt-overlay-lane"]'),
    ).not.toBeNull();
  });

  it('does not defer the reveal when the gate is not armed', async () => {
    // Baseline: a normal mount with retained messages and no switch-back gate
    // renders the transcript immediately (no skeleton).
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).not.toBeNull();
  });

  it('reveals transcript and utility footer in the same flip on switch-back', async () => {
    // Same-paint reveal: while EITHER gate holds (here the footer gate after
    // the snapshot gate cleared), the skeleton stays up and the utility card
    // stays unmounted; clearing the last gate flips both in one paint.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.awaitingSwitchBackSnapshot.set(true);
    mocks.awaitingUtilityFooter.set(true);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="event-subscriptions-card"]')).toBeNull();

    // The fresh snapshot applies but the footer sources are still settling:
    // still one deferred surface — no partial reveal.
    mocks.awaitingSwitchBackSnapshot.set(false);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="event-subscriptions-card"]')).toBeNull();

    // Footer ready: transcript and utility card mount in the SAME flip.
    mocks.awaitingUtilityFooter.set(false);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="event-subscriptions-card"]')).not.toBeNull();
  });

  it('reveals transcript and utility footer in the same flip on first open', async () => {
    // First open: hydration settles (latch true) with the footer gate armed —
    // the skeleton keeps covering until the footer sources settle, then both
    // reveal together.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'first', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.awaitingUtilityFooter.set(true);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).not.toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).toBeNull();
    expect(view.container.querySelector('[data-testid="event-subscriptions-card"]')).toBeNull();

    mocks.awaitingUtilityFooter.set(false);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="event-subscriptions-card"]')).not.toBeNull();
  });

  it('reveals without the footer when the bounded fallback clears the gates', async () => {
    // Fallback (footer sources never settled in the window): the saga clears
    // both flags — the transcript reveals and the (empty-data) card mounts
    // hidden; late footer data pops in afterwards (out of scope here).
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'retained', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.awaitingSwitchBackSnapshot.set(true);
    mocks.awaitingUtilityFooter.set(true);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).not.toBeNull();

    // chatSwitchBackRevealTimedOut clears BOTH gates in the reducer.
    mocks.awaitingSwitchBackSnapshot.set(false);
    mocks.awaitingUtilityFooter.set(false);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).not.toBeNull();
  });

  it('renders no visible utility footer when all footer data is empty', async () => {
    // Empty data renders nothing: the card wrapper mounts with the reveal but
    // stays hidden (no visible footprint) while no subscriptions/hooks/PRs
    // exist.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    const area = view.container.querySelector('[data-testid="subscription-utility-area"]');
    expect(area).not.toBeNull();
    expect(area!.getAttribute('data-has-subscriptions')).toBe('false');
    expect(area!.classList.contains('hidden')).toBe(true);
    const composer = view.container.querySelector('[data-testid="composer-prompt-layer"]');
    expect(composer?.getAttribute('data-has-transcript-utility')).toBe('false');
    expect(composer?.classList.contains('pb-3')).toBe(false);
    expect(view.container.querySelector('[data-testid="chat-composer-lane"]')).not.toBeNull();
  });

  it('resets the viewport on a resumed:false discard across the restart sequence (snapshot cleared first)', async () => {
    // Full §7.1 daemon-restart sequence: an established snapshot, then
    // phase→null CLEARS it (subscription teardown resets seq), then the new
    // subscription's seq-0 resumed:false snapshot lands. The discard reset
    // must fire on the fresh snapshot — a seq-keyed guard rebaselined by the
    // intermediate clear would miss it.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.transcriptSnapshotMeta.set({ seq: 1, truncated: true, totalMessages: 50 });
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    flushFrame();
    vi.mocked(scrollToBottomUtil).mockClear();

    // Subscription teardown: the snapshot clears (phase→null in the reducer).
    mocks.transcriptSnapshotMeta.set(undefined);
    await tick();
    await tick();
    expect(scrollToBottomUtil).not.toHaveBeenCalled();

    // Fresh subscription's first snapshot: resumed:false — transcript
    // discarded. The panel must zero its walk geometry and re-anchor.
    mocks.transcriptSnapshotMeta.set({
      seq: 1,
      truncated: false,
      totalMessages: 3,
      resumed: false,
    });
    await tick();
    await tick();
    expect(scrollToBottomUtil).toHaveBeenCalledWith(scrollContainer);
  });

  it('fires the discard reset only for NEW resumed:false snapshots after the baseline', async () => {
    // Mount over an already-discarded snapshot only records the baseline
    // (nothing to undo — panel-local geometry starts zeroed). Afterwards a
    // fresh resumed:true snapshot must NOT reset, and a fresh resumed:false
    // snapshot must.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.transcriptSnapshotMeta.set({
      seq: 1,
      truncated: false,
      totalMessages: 3,
      resumed: false,
    });
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    flushFrame();
    await tick();
    vi.mocked(scrollToBottomUtil).mockClear();

    // Fresh (new object identity) resumed:true snapshot: no discard, no reset.
    mocks.transcriptSnapshotMeta.set({ seq: 2, truncated: false, totalMessages: 4, resumed: true });
    await tick();
    await tick();
    expect(scrollToBottomUtil).not.toHaveBeenCalled();

    // Fresh resumed:false snapshot: a new discard — reset fires.
    mocks.transcriptSnapshotMeta.set({
      seq: 3,
      truncated: false,
      totalMessages: 2,
      resumed: false,
    });
    await tick();
    await tick();
    expect(scrollToBottomUtil).toHaveBeenCalledWith(scrollContainer);
  });

  it('suppresses the failed-seek fallback when a discard clears the in-flight seek', async () => {
    // The same dispatch that applies a resumed:false snapshot also clears
    // fetchingHistorySeek (the atomic reducer reset). The seek-settle
    // effect (created earlier, flushed earlier) observes that as a settle
    // and schedules its landing handler one microtask BEFORE the discard
    // effect's followToBottom — with pendingSeekTargetOrdinal already
    // nulled it would take the failed-seek fallback and dispatch a
    // spurious older-history page against the clamped scrollTop. The
    // discard's re-anchor-pending flag must make it stand down.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.transcriptSnapshotMeta.set({ seq: 1, truncated: true, totalMessages: 50 });
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    // Overflowing viewport at the top: exactly the geometry where the
    // fallback's maybeRequestOlderHistory() would dispatch a page.
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
    });
    scrollContainer.scrollTop = 0;
    flushFrame();

    // A far-flick seek is in flight at discard time.
    mocks.fetchingHistorySeek.set(true);
    await tick();
    mocks.dispatch.mockClear();
    vi.mocked(scrollToBottomUtil).mockClear();

    // The discard dispatch: clears the fetching flag and applies the
    // resumed:false snapshot atomically (one reducer write → one flush).
    mocks.fetchingHistorySeek.set(false);
    mocks.transcriptSnapshotMeta.set({
      seq: 1,
      truncated: true,
      totalMessages: 50,
      resumed: false,
    });
    await tick();
    await tick();

    // The fallback stood down; the discard's re-anchor still ran.
    const olderHistoryDispatches = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === 'chatState/olderHistoryPageRequested');
    expect(olderHistoryDispatches).toHaveLength(0);
    expect(scrollToBottomUtil).toHaveBeenCalledWith(scrollContainer);
  });

  it('drops the older-history indicator instantly when switching agents mid-walk', async () => {
    // The indicator state (visible flag, hide timer, pending evaluation)
    // is panel-local: switching agents mid-walk must not carry the visible
    // indicator over to the new agent for the quiet window — the switch
    // flips $fetchingOlderHistory$ to the new agent's false, which used to
    // read as a spurious settle (evaluation → arm-hide → ~300ms later).
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([
      { id: 'm1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    mocks.transcriptSnapshotMeta.set({ seq: 1, truncated: true, totalMessages: 50 });
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    // Mid-walk: a fetch is in flight, the indicator shows.
    mocks.fetchingOlderHistory.set(true);
    await tick();
    expect(
      view.container.querySelector('[data-testid="chat-older-history-loading"]'),
    ).not.toBeNull();

    // Switch agents; the new agent's fetching flag is false.
    await view.rerender({ workspace: workspace('workspace-a'), agentId: 'agent-b' });
    mocks.fetchingOlderHistory.set(false);
    await tick();

    // Hidden IMMEDIATELY — no quiet-window timer needed.
    expect(view.container.querySelector('[data-testid="chat-older-history-loading"]')).toBeNull();
  });
});

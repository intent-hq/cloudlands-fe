/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';

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
    chatDrafts: {} as Record<string, string>,
    resizeObserve: vi.fn(),
    resizeDisconnect: vi.fn(),
    resizeConstructor: vi.fn(),
    agentMessages: mutableReadable<unknown[]>([]),
    animateMessageSend: vi.fn(),
    createMessageSendLaunchBubble: vi.fn(),
    pendingQuestions: null as { messageId: string; questions: unknown[] } | null,
    selector,
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {}, dispatch: mocks.dispatch });
});
vi.mock('$lib/client', () => ({
  appClient: {
    drafts: { get: mocks.draftGet, set: mocks.draftSet, clear: mocks.draftClear },
    agents: { retry: vi.fn() },
  },
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentAttentionRequest: mocks.selector(null),
  selectAgentSession: mocks.selector(null),
  selectAgentSessionIsStreaming: mocks.selector(false),
  selectAgentMessages: Object.assign(() => mocks.agentMessages, { select: () => [] }),
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
  selectChatError: mocks.selector(null),
  selectChatIsStalled: mocks.selector(false),
  selectChatLastChunkTime: mocks.selector(null),
  selectChatLiveStreamPhase: mocks.selector(null),
  selectChatModelUnavailable: mocks.selector(null),
  selectChatReceivedFirstChunk: mocks.selector(false),
  selectChatStatusEvents: mocks.selector([]),
  selectChatStreamingStartTime: mocks.selector(null),
  selectTranscriptHydration: mocks.selector('settled'),
  selectTranscriptHydratedOnce: mocks.selector(true),
  selectTranscriptSnapshotMeta: mocks.selector(undefined),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-selectors', () => ({
  selectDividerSession: mocks.selector(null),
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectIsAgentMonospace: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectAllTabs: mocks.selector([]),
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
  followToBottom: vi.fn(),
  followBottom: () => ({ update: () => {}, destroy: () => {} }),
  scrollToBottom: vi.fn(),
}));
vi.mock('../message-send-transition', () => ({
  captureMessageSendOrigin: () => ({ left: 0, top: 600, width: 320, borderRadius: '8px' }),
  createMessageSendLaunchBubble: mocks.createMessageSendLaunchBubble,
  animateMessageSend: mocks.animateMessageSend,
  MESSAGE_SEND_MATCH_TIMEOUT_MS: 3000,
  MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS: 600,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  listenSync: vi.fn(() => () => {}),
}));
vi.mock('$features/agent/services/consolidated-backend.service', () => ({
  unifiedOrchestrator: { editQueuedMessage: vi.fn() },
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToTask: vi.fn() }));
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/MockSimpleRichInput.svelte')).default,
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
vi.mock('../questions/wizard-gate', () => ({
  deriveWizardPendingQuestions: () => mocks.pendingQuestions,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatPanel from '../ChatPanel.svelte';
import { clearDraftCacheForTests } from '../chat-draft-cache';

type Frame = { id: number; callback: FrameRequestCallback };
let frames: Frame[];
let nextFrameId: number;

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
  vi.clearAllMocks();
  clearDraftCacheForTests();
  mocks.draftSet.mockResolvedValue({ ok: true, updatedAt: '2026-01-01T00:00:00.000Z' });
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
  mocks.animateMessageSend.mockResolvedValue(undefined);
  mocks.createMessageSendLaunchBubble.mockImplementation(() => {
    const bubble = document.createElement('div');
    bubble.dataset.messageSendTransition = 'true';
    document.body.append(bubble);
    return bubble;
  });
  mocks.pendingQuestions = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatPanel mounted lifecycle', () => {
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

  it('preserves typed text when the composer remounts', async () => {
    mocks.draftGet.mockResolvedValue(null);
    render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    await Promise.resolve();
    await tick();

    await fireEvent.input(screen.getByTestId('mock-rich-input-editor'), {
      target: { value: 'keep this draft' },
    });
    mocks.pendingQuestions = { messageId: 'question-1', questions: [] };
    mocks.agentMessages.set([{ id: 'question-1' }]);
    await tick();
    expect(screen.queryByTestId('mock-rich-input')).toBeNull();

    mocks.pendingQuestions = null;
    mocks.agentMessages.set([]);
    await tick();
    await tick();

    expect(screen.getByTestId('mock-rich-input').getAttribute('data-value')).toBe(
      'keep this draft',
    );
    expect(mocks.draftGet).toHaveBeenCalledOnce();
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

    expect(mocks.resizeConstructor).toHaveBeenCalledOnce();
    expect(mocks.resizeDisconnect).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
  });

  it('renders no scroll button at the bottom so nothing invisible is hit-testable or focusable', async () => {
    // Regression (PR #1263 → monorepo#2508): the old scroll-lock button was
    // fully transparent while locked at the bottom but stayed hit-testable,
    // overlapping the last assistant message's bottom-right actions bar and
    // flickering it on hover; even with pointer-events-none it remained
    // keyboard-focusable. The dead lock/unlock states are gone: at the bottom
    // the button is not rendered at all, so nothing invisible can intercept
    // hover hit-tests or land in the tab order.
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([{ id: 'message-1' }]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();

    // distanceFromBottom starts at 0 → at bottom → no button in the DOM.
    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="chat-scroll-lock-button"]')).toBeNull();
  });

  it('shows the scroll-to-bottom arrow only while scrolled up and scrolls down on click', async () => {
    mocks.draftGet.mockResolvedValue(null);
    mocks.agentMessages.set([{ id: 'message-1' }]);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    flushFrame(); // bind the distance-from-bottom scroll tracker

    // Any hidden tail beyond the one-pixel geometry tolerance keeps the arrow visible.
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 });
    scrollContainer.scrollTop = 100; // 500px from the bottom
    await fireEvent.scroll(scrollContainer);
    await tick();
    const arrowButton = view.container.querySelector(
      '[data-testid="chat-scroll-to-bottom-button"]',
    );
    expect(arrowButton).not.toBeNull();
    expect(arrowButton!.classList.contains('pointer-events-none')).toBe(false);
    expect(arrowButton!.classList.contains('border-0')).toBe(true);
    expect(arrowButton!.classList.contains('bg-transparent')).toBe(true);
    expect(arrowButton!.classList.contains('z-[45]')).toBe(true);
    expect(arrowButton!.getAttribute('aria-label')).toBeTruthy();

    // Click scrolls to the bottom and re-enables auto-follow.
    await fireEvent.click(arrowButton!);
    const { followToBottom } = await import('$lib/utils/smartScroll');
    expect(vi.mocked(followToBottom)).toHaveBeenCalledWith(scrollContainer);

    scrollContainer.scrollTop = 598; // two pixels remain hidden
    await fireEvent.scroll(scrollContainer);
    await tick();
    expect(
      view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]'),
    ).not.toBeNull();

    // Within one device pixel of the real bottom → the button unmounts again.
    scrollContainer.scrollTop = 600;
    await fireEvent.scroll(scrollContainer);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]')).toBeNull();
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

    // Scroll up past the threshold, then back to the bottom → re-lock flash.
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 400 });
    scrollContainer.scrollTop = 100; // 500px from the bottom
    await fireEvent.scroll(scrollContainer);
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

  it('sets up and tears down sticky scroll tracking and resize observation normally', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    const addListener = vi.spyOn(scrollContainer, 'addEventListener');
    const removeListener = vi.spyOn(scrollContainer, 'removeEventListener');

    flushFrame();
    expect(addListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1);
    expect(mocks.resizeObserve).toHaveBeenCalledWith(scrollContainer);

    scrollContainer.dispatchEvent(new Event('scroll'));
    expect(frames.length).toBeGreaterThan(0);
    view.unmount();

    expect(removeListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(2);
    expect(mocks.resizeDisconnect).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(0);
  });
});

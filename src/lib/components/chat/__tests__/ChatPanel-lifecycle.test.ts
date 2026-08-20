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
    chatDrafts: {} as Record<string, string>,
    resizeObserve: vi.fn(),
    resizeDisconnect: vi.fn(),
    resizeConstructor: vi.fn(),
    agentMessages: mutableReadable<unknown[]>([]),
    animateScrollTo: vi.fn(),
    awaitingSwitchBackSnapshot: mutableReadable(false),
    awaitingUtilityFooter: mutableReadable(false),
    transcriptHydration: mutableReadable('settled'),
    transcriptHydratedOnce: mutableReadable(true),
    animateMessageSend: vi.fn(),
    createMessageSendLaunchBubble: vi.fn(),
    pendingQuestions: null as { messageId: string; questions: unknown[] } | null,
    prefersReducedMotion: false,
    followBottomOptions: null as {
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
  selectAgentHistoryMessages: mocks.selector([]),
  selectHistorySegmentMeta: mocks.selector({
    gapToTail: false,
    oldestReached: false,
    historyCount: 0,
    tailCount: 0,
  }),
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
  selectChatError: mocks.selector(null),
  selectChatIsStalled: mocks.selector(false),
  selectChatLastChunkTime: mocks.selector(null),
  selectChatLiveStreamPhase: mocks.selector(null),
  selectChatModelUnavailable: mocks.selector(null),
  selectChatReceivedFirstChunk: mocks.selector(false),
  selectChatStatusEvents: mocks.selector([]),
  selectChatStreamingStartTime: mocks.selector(null),
  selectFetchingGapFill: mocks.selector(false),
  selectFetchingHistorySeek: mocks.selector(false),
  selectFetchingOlderHistory: mocks.selector(false),
  selectHistoryExhausted: mocks.selector(false),
  selectHistorySeekUnsupported: mocks.selector(false),
  selectPendingQuestionRecovery: mocks.selector(undefined),
  selectTranscriptHydration: Object.assign(() => mocks.transcriptHydration, {
    select: () => 'settled',
  }),
  selectTranscriptHydratedOnce: Object.assign(() => mocks.transcriptHydratedOnce, {
    select: () => true,
  }),
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
    node.addEventListener('scroll', report);
    report();
    return {
      update: (next: typeof initial) => {
        options = next;
        mocks.followBottomOptions = next;
        report();
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
  clearChatScrollCacheForTests,
  getCachedChatScroll,
  setCachedChatScroll,
} from '../chat-scroll-cache';
import { SCROLL_BUTTON_SHOW_SETTLE_MS } from '../scroll-bottom-button-visibility';

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

function latestSentAppMessageId(): string {
  const action = mocks.dispatch.mock.calls
    .map(([candidate]) => candidate)
    .findLast((candidate) => candidate?.type === 'chatState/sendMessage');
  return action.payload.payload.userAppMessageId as string;
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
  clearDraftCacheForTests();
  clearChatScrollCacheForTests();
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
  mocks.awaitingSwitchBackSnapshot.set(false);
  mocks.awaitingUtilityFooter.set(false);
  mocks.transcriptHydration.set('settled');
  mocks.transcriptHydratedOnce.set(true);
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

    expect(mocks.resizeConstructor).toHaveBeenCalledOnce();
    expect(mocks.resizeDisconnect).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
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
    });

    scrollContainer.scrollTop = 600;
    await fireEvent.scroll(scrollContainer);
    await tick();
    expect(onNavigationStateChange).toHaveBeenLastCalledWith({
      isAtBottom: true,
      userMessages: [{ id: 'message-1', text: 'User prompt' }],
    });
    expect(view.container.querySelector('[data-testid="chat-scroll-to-bottom-button"]')).toBeNull();
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
    expect(mocks.resizeDisconnect).toHaveBeenCalledTimes(2);
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
    await tick();
    await Promise.resolve();
    await tick();
    flushFrame();
    const replacementScroll = replacement.container.querySelector(
      '.overflow-y-auto',
    ) as HTMLDivElement;
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
    await tick();
    // Let the first-hydration restore (tick continuation) and the mount-time
    // rAF entry scroll both run.
    await Promise.resolve();
    await tick();
    flushFrame();

    const scrollContainer = view.container.querySelector('.overflow-y-auto') as HTMLDivElement;
    expect(scrollContainer.scrollTop).toBe(987);
    expect(scrollToBottomUtil).not.toHaveBeenCalled();
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

    expect(
      view.container.querySelector('[data-testid="chat-transcript-skeleton"]'),
    ).not.toBeNull();
    expect(view.container.querySelector('[data-testid="event-subscriptions-card"]')).toBeNull();

    // The fresh snapshot applies but the footer sources are still settling:
    // still one deferred surface — no partial reveal.
    mocks.awaitingSwitchBackSnapshot.set(false);
    await tick();
    expect(
      view.container.querySelector('[data-testid="chat-transcript-skeleton"]'),
    ).not.toBeNull();
    expect(view.container.querySelector('[data-testid="event-subscriptions-card"]')).toBeNull();

    // Footer ready: transcript and utility card mount in the SAME flip.
    mocks.awaitingUtilityFooter.set(false);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).not.toBeNull();
    expect(
      view.container.querySelector('[data-testid="event-subscriptions-card"]'),
    ).not.toBeNull();
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

    expect(
      view.container.querySelector('[data-testid="chat-transcript-skeleton"]'),
    ).not.toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).toBeNull();
    expect(view.container.querySelector('[data-testid="event-subscriptions-card"]')).toBeNull();

    mocks.awaitingUtilityFooter.set(false);
    await tick();
    expect(view.container.querySelector('[data-testid="chat-transcript-skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-conversation-turn]')).not.toBeNull();
    expect(
      view.container.querySelector('[data-testid="event-subscriptions-card"]'),
    ).not.toBeNull();
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
    expect(
      view.container.querySelector('[data-testid="chat-transcript-skeleton"]'),
    ).not.toBeNull();

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
    expect(composer?.classList.contains('pb-3')).toBe(true);
  });
});

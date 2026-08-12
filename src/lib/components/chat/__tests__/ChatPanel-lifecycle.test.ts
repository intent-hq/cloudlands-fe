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
  followBottom: () => ({ update: () => {}, destroy: () => {} }),
  scrollToBottom: vi.fn(),
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

import ChatPanel from '../ChatPanel.svelte';

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
  mocks.pendingQuestions = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ChatPanel mounted lifecycle', () => {
  it('restores active typing synchronously when the whole chat panel is recreated', async () => {
    mocks.draftGet.mockResolvedValue(null);
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

    await vi.advanceTimersByTimeAsync(550);
    expect(mocks.draftSet).toHaveBeenCalledWith(
      'workspace-b',
      'agent-b',
      'draft from B',
      undefined,
    );
    expect(mocks.draftSet).not.toHaveBeenCalledWith('workspace-b', 'agent-b', 'draft from A');
    expect(mocks.draftSet).not.toHaveBeenCalledWith('workspace-a', 'agent-a', expect.anything());
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

  it('cancels deferred setup when destroyed before container resources bind', async () => {
    mocks.draftGet.mockResolvedValue(null);
    const view = render(ChatPanel, {
      props: { workspace: workspace('workspace-a'), agentId: 'agent-a' },
    });
    await tick();
    expect(frames.length).toBeGreaterThan(0);

    view.unmount();
    flushFrame();

    expect(mocks.resizeConstructor).not.toHaveBeenCalled();
    expect(mocks.resizeObserve).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
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
    expect(addListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(2);
    expect(mocks.resizeObserve).toHaveBeenCalledWith(scrollContainer);

    scrollContainer.dispatchEvent(new Event('scroll'));
    expect(frames.length).toBeGreaterThan(0);
    view.unmount();

    expect(removeListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(2);
    expect(mocks.resizeDisconnect).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
  });
});

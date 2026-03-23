/**
 * End-to-End Streaming Integration Test
 *
 * Tests the REAL code path: AgentService dispatchStreamEvent →
 * DOM CustomEvent → ChatService handleStreamEvent → Svelte store update.
 *
 * Only the IPC layer (window.electronAPI) and persistence are mocked.
 * Everything else — AgentService dispatch logic, DOM events, ChatService
 * accumulation, Svelte stores — is real code.
 *
 * This test would have caught the original bug where messages didn't show
 * until page refresh because DOM events weren't reaching ChatService.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

// ═══════════════════════════════════════════════════════════════════════════
// Dependency mocks — same pattern as agent-service-streaming.test.ts
// ═══════════════════════════════════════════════════════════════════════════

const mockOn = vi.fn(() => 'listener-id');
const mockOff = vi.fn();

vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));
vi.mock('$shared/types/branded-ids', () => ({
  createMessageId: (id: string) => id,
  WorkspaceId: (id: string) => id,
}));

const mockSessionStore = new Proxy(
  {
    getStore: () => ({ subscribe: vi.fn(), set: vi.fn(), update: vi.fn() }),
    getSessionForWorkspace: vi.fn(),
    addSessionForWorkspace: vi.fn(),
    setActiveSessionForWorkspace: vi.fn(),
    updateMessagesForWorkspace: vi.fn(),
    addMessageForWorkspace: vi.fn(),
    setStreamingForWorkspace: vi.fn(),
    getAllSessionsForWorkspace: vi.fn(() => []),
    getAllSessionsAcrossWorkspaces: vi.fn(() => []),
  },
  {
    get(target: any, prop: string) {
      if (prop in target) return target[prop];
      target[prop] = vi.fn();
      return target[prop];
    },
  },
);

vi.mock('../services/unified-state-store', () => ({
  unifiedStateStore: {
    getSession: vi.fn(), getAllSessionsAcrossWorkspaces: vi.fn(() => []),
    addSession: vi.fn(), setStreaming: vi.fn(), updateMessage: vi.fn(),
    updateMessageForWorkspace: vi.fn(), currentWorkspace: null,
    getWorkspace: vi.fn(), getAllWorkspaces: vi.fn(() => []),
    setAgent: vi.fn(), getAgent: vi.fn(),
  },
}));
vi.mock('../services/performance-optimizer', () => ({
  performanceOptimizer: { scheduleUpdate: vi.fn((fn: () => void) => fn()), flush: vi.fn() },
}));
vi.mock('../services/agent-factory', () => ({ agentFactory: { createAgent: vi.fn() } }));
vi.mock('../browser', () => ({
  agentIpcProxy: { invoke: vi.fn() },
  configCache: { get: vi.fn(), set: vi.fn() },
  errorBoundary: { wrap: vi.fn((fn: any) => fn) },
  persistenceService: { saveSession: vi.fn(), loadSessions: vi.fn(() => []) },
  sessionStore: mockSessionStore,
  unifiedStateStore: {
    currentWorkspace: null, getWorkspace: vi.fn(),
    getAllWorkspaces: vi.fn(() => []), setAgent: vi.fn(), getAgent: vi.fn(),
  },
  notifyAgentSubscribers: vi.fn(),
}));
vi.mock('../browser/services/error-recovery.service', () => ({
  errorRecovery: { wrap: vi.fn((fn: any) => fn), execute: vi.fn() },
  DEFAULT_STRATEGIES: {},
}));
vi.mock('$shared/ipc/channels', () => ({
  AGENT_BACKEND_CHANNELS: {
    STREAM: 'agent:stream', CREATE: 'agent:create',
    SEND_MESSAGE: 'agent:send-message', GET_ACTIVE_STREAMS: 'agent:get-active-streams',
  },
}));
vi.mock('$shared/constants/agent-streaming', () => ({
  AGENT_STREAMING_CONFIG: {
    STREAM_TIMEOUT_MS: 120_000, KEEP_ALIVE_INTERVAL_MS: 30_000,
    BACKEND_STREAM_TIMEOUT_MS: 120_000,
  },
}));
vi.mock('$shared/types', () => ({
  AgentStatus: { IDLE: 'idle', STREAMING: 'streaming' },
  normalizeContentBlocks: vi.fn((b: any) => b),
}));
vi.mock('$shared/types/agent-session', () => ({
  AgentActivationState: { IDLE: 'idle' },
  getAgentProvider: vi.fn(() => 'anthropic'),
}));
vi.mock('$shared/constants/agent-services', () => ({ DEFAULT_AGENT_MODEL: 'test-model' }));
vi.mock('../browser/services/request-deduplicator.service', () => ({
  requestDeduplicator: { deduplicate: vi.fn((_key: string, fn: () => any) => fn()) },
  generateMessageKey: vi.fn(() => 'key'),
}));
vi.mock('../services/unread-tracking.service', () => ({
  unreadTrackingService: {
    markAsRead: vi.fn(), markAsUnread: vi.fn(),
    getUnreadCount: vi.fn(() => 0), setAgentExistsCallback: vi.fn(),
  },
}));
vi.mock('$lib/services/analytics', () => ({ track: vi.fn() }));
vi.mock('$features/agent/services/error-handler', () => ({
  errorHandler: { handle: vi.fn(), wrap: vi.fn((fn: any) => fn) },
  AgentError: class extends Error {}, ErrorCode: {}, ErrorCategory: {}, ErrorSeverity: {},
}));
vi.mock('../../observability/event-collector-client', () => ({
  eventCollector: { emit: vi.fn(), track: vi.fn() }, AgentEventType: {},
}));
vi.mock('../../workspace/workspace-metrics', () => ({ workspaceMetrics: { record: vi.fn() } }));
vi.mock('../agent-file-tracker', () => ({ agentFileTracker: { track: vi.fn() } }));
vi.mock('$lib/utils/browser-event-emitter', () => {
  class EventEmitter {
    private _h = new Map<string, Set<Function>>();
    on(ev: string, fn: Function) { if (!this._h.has(ev)) this._h.set(ev, new Set()); this._h.get(ev)!.add(fn); }
    off(ev: string, fn: Function) { this._h.get(ev)?.delete(fn); }
    emit(ev: string, ...args: any[]) { this._h.get(ev)?.forEach((h) => h(...args)); }
  }
  return { EventEmitter };
});
vi.mock('uuid', () => ({ v4: () => `test-uuid-${Math.random().toString(36).slice(2)}` }));
// Mock memory-manager to use real addEventListener/removeEventListener
vi.mock('../services/memory-manager', () => ({
  memoryManager: {
    registerTimer: vi.fn((cb: Function, delay?: number, _type?: string, _owner?: object) => {
      const id = setTimeout(cb as any, delay ?? 120000);
      // Return a cleanup function (not an object) — matches real registerTimer signature
      return () => clearTimeout(id);
    }),
    registerListener: vi.fn((target: EventTarget, event: string, handler: EventListener) => {
      target.addEventListener(event, handler);
      return () => target.removeEventListener(event, handler);
    }),
    addResourceToOwner: vi.fn(),
  },
}));
vi.mock('$shared/errors/messages', () => ({ cleanErrorMessage: (msg: string) => msg }));
vi.mock('$lib/stores/active-provider.store.svelte', () => ({
  activeProviderStore: { get: vi.fn(() => 'anthropic') },
}));
vi.mock('$shared/config/provider-config', () => ({ getProviderConfig: vi.fn(() => ({})) }));

// ═══════════════════════════════════════════════════════════════════════════
// End-to-End Streaming Integration Tests
//
// Strategy: Use real AgentService (dispatchStreamEvent, registerDomHandler,
// replayPendingEvents) and real ChatService (handleStreamEvent, store).
// The bridge between them is the DOM — AgentService dispatches CustomEvents,
// ChatService listens via addEventListener. Both are real.
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E Streaming: AgentService → DOM → ChatService → Store', () => {
  let agentService: any;
  let ChatService: any;
  let rafCallback: (() => void) | null = null;
  let originalRaf: typeof requestAnimationFrame;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up real window with real DOM event support + mocked electronAPI
    (globalThis as any).window = globalThis.window ?? {};
    Object.assign(globalThis.window, {
      electronAPI: {
        on: mockOn, off: mockOff,
        removeAllListeners: vi.fn(), invoke: vi.fn(), send: vi.fn(),
      },
      CustomEvent: CustomEvent,
    });

    // Mock requestAnimationFrame to capture the callback for controlled flushing
    originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallback = () => cb(performance.now());
      return 1;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();

    // Dynamically import to get fresh modules with mocks applied
    const agentMod = await import('../agent.service');
    agentService = agentMod.agentService;

    const chatMod = await import('../services/chat.service');
    ChatService = chatMod.ChatService;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    rafCallback = null;
    vi.restoreAllMocks();
  });

  /**
   * Helper: Create a ChatService instance and wire it up for streaming.
   * This simulates what happens when ChatPanel mounts and calls setupStreaming.
   */
  function setupChatService(sessionId: string): any {
    const chatService = new ChatService(sessionId);
    // Initialize session state
    chatService.getStore().update((s: any) => ({
      ...s,
      session: {
        id: sessionId, backendSessionId: sessionId,
        workspaceId: 'test-workspace', name: 'Test',
        status: 'active', messages: [], model: 'test',
        systemPrompt: '', createdAt: new Date(), updatedAt: new Date(),
        isStreaming: false,
      },
      messages: [],
    }));
    // Register stream handler (simulates setupStreaming)
    const handler = (event: Event) => {
      (chatService as any).handleStreamEvent(sessionId, event);
    };
    (chatService as any).streamHandlers.set(sessionId, handler);
    window.addEventListener(`agent:stream:${sessionId}`, handler);
    agentService.registerDomHandler(sessionId);
    return chatService;
  }

  // ── Scenario 1: IPC chunk → ChatService state update ──────────────────
  it('1. IPC chunk event flows through DOM to ChatService and updates store', () => {
    const sessionId = 'e2e-agent-1';
    const chatService = setupChatService(sessionId);

    // Simulate AgentService dispatching a stream event (as it would after IPC)
    (agentService as any).dispatchStreamEvent(sessionId, 'start', {
      type: 'start', sessionId,
    });

    // Flush RAF if scheduled
    if (rafCallback) { rafCallback(); rafCallback = null; }

    const stateAfterStart = get(chatService.getStore());
    expect(stateAfterStart.isStreaming).toBe(true);

    // Dispatch chunk
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'Hello World', sessionId,
    });

    // Flush chunk update
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // Verify ChatService accumulated the content
    expect((chatService as any).localStreamingContent).toBe('Hello World');
    const state = get(chatService.getStore());
    expect(state.streamingContent).toBe('Hello World');
  });

  // ── Scenario 2: Full stream lifecycle (start → chunks → end) ──────────
  it('2. Full stream lifecycle: start → chunks → end → complete message in store', () => {
    const sessionId = 'e2e-agent-2';
    const chatService = setupChatService(sessionId);

    // Start
    (agentService as any).dispatchStreamEvent(sessionId, 'start', {
      type: 'start', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // Chunks
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'Hello ', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'World!', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    expect((chatService as any).localStreamingContent).toBe('Hello World!');

    // End — provide final message
    (agentService as any).dispatchStreamEvent(sessionId, 'end', {
      type: 'end', sessionId,
      message: {
        id: 'msg_final',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Hello World!' }],
        timestamp: new Date().toISOString(),
      },
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    const finalState = get(chatService.getStore());
    expect(finalState.isStreaming).toBe(false);
    expect(finalState.isProcessing).toBe(false);
    expect(finalState.streamingContent).toBe('');
    // localStreamingContent should be reset after end
    expect((chatService as any).localStreamingContent).toBe('');
  });

  // ── Scenario 3: Error propagation ─────────────────────────────────────
  it('3. IPC error event propagates to ChatService error state', () => {
    const sessionId = 'e2e-agent-3';
    const chatService = setupChatService(sessionId);

    // Start streaming
    (agentService as any).dispatchStreamEvent(sessionId, 'start', {
      type: 'start', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // Send some content first
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'Partial content', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // Error
    (agentService as any).dispatchStreamEvent(sessionId, 'error', {
      type: 'error', error: 'Connection lost', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    const state = get(chatService.getStore());
    expect(state.isStreaming).toBe(false);
    expect(state.isProcessing).toBe(false);
    expect(state.error).toBe('Connection lost');
  });

  // ── Scenario 4: Backend-initiated stream (prepare-handler flow) ───────
  it('4. Backend-initiated stream: events dispatched → ChatService receives full flow', () => {
    const sessionId = 'e2e-agent-4';
    const chatService = setupChatService(sessionId);

    // Simulate backend-initiated stream: start → chunks → end
    (agentService as any).dispatchStreamEvent(sessionId, 'start', {
      type: 'start', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'Backend ', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'initiated ', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'stream', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    expect((chatService as any).localStreamingContent).toBe('Backend initiated stream');

    // Content blocks (tool use)
    (agentService as any).dispatchStreamEvent(sessionId, 'content-blocks', {
      type: 'content-blocks', sessionId,
      data: [{ type: 'tool_use', id: 'tool_1', name: 'search', input: { query: 'test' } }],
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // After tool_use, localStreamingContent should be reset
    expect((chatService as any).localStreamingContent).toBe('');

    // More text after tool
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'After tool', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    expect((chatService as any).localStreamingContent).toBe('After tool');

    // End
    (agentService as any).dispatchStreamEvent(sessionId, 'end', {
      type: 'end', sessionId,
      message: {
        id: 'msg_final_4',
        role: 'assistant',
        contentBlocks: [
          { type: 'text', text: 'Backend initiated stream' },
          { type: 'tool_use', id: 'tool_1', name: 'search', input: { query: 'test' } },
          { type: 'text', text: 'After tool' },
        ],
        timestamp: new Date().toISOString(),
      },
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    const finalState = get(chatService.getStore());
    expect(finalState.isStreaming).toBe(false);
  });

  // ── Scenario 5: Chunks arrive before ChatService registers ────────────
  it('5. Chunks queued before ChatService registers → replayed → content appears', () => {
    const sessionId = 'e2e-agent-5';

    // NO ChatService yet — chunks arrive and get queued
    (agentService as any).dispatchStreamEvent(sessionId, 'start', {
      type: 'start', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'Queued ', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'content', sessionId,
    });

    // Verify events were queued (no DOM handler registered)
    expect((agentService as any).pendingEventQueue.has(sessionId)).toBe(true);
    expect((agentService as any).pendingEventQueue.getQueueSize(sessionId)).toBe(3);

    // NOW ChatService registers and replays
    const chatService = setupChatService(sessionId);
    agentService.replayPendingEvents(sessionId);

    // Flush RAF
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // Queue should be empty after replay
    expect((agentService as any).pendingEventQueue.has(sessionId)).toBe(false);

    // ChatService should have received the replayed events
    expect((chatService as any).localStreamingContent).toBe('Queued content');
    const state = get(chatService.getStore());
    expect(state.isStreaming).toBe(true);
    expect(state.streamingContent).toBe('Queued content');
  });

  // ── Scenario 6: Stream end arrives before DOM handler ─────────────────
  it('6. Stream end queued before handler → replayed → isProcessing clears', () => {
    const sessionId = 'e2e-agent-6';

    // Full stream completes before ChatService exists
    (agentService as any).dispatchStreamEvent(sessionId, 'start', {
      type: 'start', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'Complete response', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'end', {
      type: 'end', sessionId,
      message: {
        id: 'msg_final_6',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Complete response' }],
        timestamp: new Date().toISOString(),
      },
    });

    // All 3 events queued
    expect((agentService as any).pendingEventQueue.getQueueSize(sessionId)).toBe(3);

    // ChatService registers and replays
    const chatService = setupChatService(sessionId);
    agentService.replayPendingEvents(sessionId);
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // After replay, stream should be complete
    const state = get(chatService.getStore());
    expect(state.isStreaming).toBe(false);
    expect(state.isProcessing).toBe(false);
    expect(state.streamingContent).toBe('');
  });


  // ── Scenario 7: Page refresh simulation ────────────────────────────────
  it('7. Page refresh: cleanup handlers → reconnect → streaming resumes', () => {
    const sessionId = 'e2e-agent-7';
    const chatService = setupChatService(sessionId);

    // Start streaming
    (agentService as any).dispatchStreamEvent(sessionId, 'start', {
      type: 'start', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'Before refresh', sessionId,
    });
    if (rafCallback) { rafCallback(); rafCallback = null; }

    expect((chatService as any).localStreamingContent).toBe('Before refresh');

    // Simulate page refresh: cleanup all handlers
    const handler = (chatService as any).streamHandlers.get(sessionId);
    if (handler) {
      window.removeEventListener(`agent:stream:${sessionId}`, handler);
    }
    (chatService as any).streamHandlers.delete(sessionId);
    agentService.unregisterDomHandler(sessionId);

    // Events during "refresh" get queued
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: ' and after', sessionId,
    });
    expect((agentService as any).pendingEventQueue.has(sessionId)).toBe(true);

    // Reconnect: re-register handler and replay
    const newHandler = (event: Event) => {
      (chatService as any).handleStreamEvent(sessionId, event);
    };
    (chatService as any).streamHandlers.set(sessionId, newHandler);
    window.addEventListener(`agent:stream:${sessionId}`, newHandler);
    agentService.registerDomHandler(sessionId);
    agentService.replayPendingEvents(sessionId);
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // Content should include the queued chunk
    expect((chatService as any).localStreamingContent).toBe('Before refresh and after');
  });

  // ── Scenario 8: Reconcile streaming state after mount ─────────────────
  it('8. ChatService mounts after streaming started → reconcileStreamingState → content displays', () => {
    const sessionId = 'e2e-agent-8';

    // Simulate: backend is already streaming, events are queued
    (agentService as any).dispatchStreamEvent(sessionId, 'start', {
      type: 'start', sessionId,
    });
    (agentService as any).dispatchStreamEvent(sessionId, 'chunk', {
      type: 'chunk', content: 'Already streaming', sessionId,
    });

    // Events are queued
    expect((agentService as any).pendingEventQueue.getQueueSize(sessionId)).toBe(2);

    // ChatService mounts — set up with session marked as streaming
    const chatService = new ChatService(sessionId);
    chatService.getStore().update((s: any) => ({
      ...s,
      session: {
        id: sessionId, backendSessionId: sessionId,
        workspaceId: 'test-workspace', name: 'Test',
        status: 'active', messages: [], model: 'test',
        systemPrompt: '', createdAt: new Date(), updatedAt: new Date(),
        isStreaming: true,
      },
      messages: [],
    }));

    // Mock sessionStore.getSessionForWorkspace to return streaming session (for reconcileStreamingState)
    mockSessionStore.getSessionForWorkspace.mockReturnValue({
      id: sessionId, isStreaming: true, messages: [],
      workspaceId: 'test-workspace',
    });

    // Register handler manually (simulates setupStreaming)
    const handler = (event: Event) => {
      (chatService as any).handleStreamEvent(sessionId, event);
    };
    (chatService as any).streamHandlers.set(sessionId, handler);
    window.addEventListener(`agent:stream:${sessionId}`, handler);
    agentService.registerDomHandler(sessionId);

    // Call reconcileStreamingState — this is what ChatPanel calls on mount
    const reconciled = chatService.reconcileStreamingState(sessionId);

    // Replay queued events
    agentService.replayPendingEvents(sessionId);
    if (rafCallback) { rafCallback(); rafCallback = null; }

    // Verify content was received
    expect((chatService as any).localStreamingContent).toBe('Already streaming');
    const state = get(chatService.getStore());
    expect(state.isStreaming).toBe(true);
    expect(state.streamingContent).toBe('Already streaming');

    // Clean up mock
    mockSessionStore.getSessionForWorkspace.mockReset();
  });
});
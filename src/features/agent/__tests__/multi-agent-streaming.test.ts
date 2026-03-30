/**
 * Multi-Agent Concurrent Streaming & Delegation Flow Tests
 *
 * Covers 10 scenarios:
 *   1–4: Concurrent streaming isolation (PendingEventQueue)
 *   5–8: Delegation flow (AgentService IPC handlers)
 *   9–10: Workspace switching during multi-agent streaming
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PendingEventQueue } from '../utils/pending-event-queue';

// ═══════════════════════════════════════════════════════════════════════════
// Dependency mocks (must be before dynamic import of AgentService)
// ═══════════════════════════════════════════════════════════════════════════

const mockOn = vi.fn();
const mockOff = vi.fn();

vi.mock('$lib/electron-bridge', async () => await import('$lib/store/utils/test-helpers/electron-bridge-mock'));
vi.mock('$lib/utils/client-logger', async () => await import('$lib/store/utils/test-helpers/client-logger-mock'));
vi.mock('$shared/types/branded-ids', () => ({
  createMessageId: (id: string) => id,
  WorkspaceId: (id: string) => id,
}));
vi.mock('../services/unified-state-store', () => ({
  unifiedStateStore: {
    currentWorkspace: { workspace: { id: 'ws-1' } },
    getSession: vi.fn(), getAllSessionsAcrossWorkspaces: vi.fn(() => []),
    addSession: vi.fn(), setStreaming: vi.fn(),
    updateMessage: vi.fn(), updateMessageForWorkspace: vi.fn(),
  },
}));
vi.mock('../services/performance-optimizer', () => ({
  performanceOptimizer: { scheduleUpdate: vi.fn((fn: () => void) => fn()), flush: vi.fn() },
}));
vi.mock('../services/agent-factory', () => ({ agentFactory: { createAgent: vi.fn() } }));

const mockSessionStore = new Proxy(
  { getStore: () => ({ subscribe: vi.fn(), set: vi.fn(), update: vi.fn() }) },
  {
    get(target: any, prop: string) {
      if (prop in target) return target[prop];
      target[prop] = vi.fn();
      return target[prop];
    },
  },
);

vi.mock('../browser', () => ({
  agentIpcProxy: { invoke: vi.fn() },
  configCache: { get: vi.fn(), set: vi.fn() },
  errorBoundary: { wrap: vi.fn((fn: any) => fn) },
  persistenceService: { saveSession: vi.fn(), loadSessions: vi.fn(() => []) },
  sessionStore: mockSessionStore,
}));
vi.mock('../browser/services/error-recovery.service', () => ({
  errorRecovery: { wrap: vi.fn((fn: any) => fn), execute: vi.fn() }, DEFAULT_STRATEGIES: {},
}));
vi.mock('$shared/ipc/channels', () => ({
  AGENT_BACKEND_CHANNELS: {
    STREAM: 'agent:stream', CREATE: 'agent:create',
    SEND_MESSAGE: 'agent:send-message', GET_ACTIVE_STREAMS: 'agent:get-active-streams',
  },
}));
vi.mock('$shared/constants/agent-streaming', () => ({
  AGENT_STREAMING_CONFIG: { STREAM_TIMEOUT_MS: 120_000, KEEP_ALIVE_INTERVAL_MS: 30_000 },
}));
vi.mock('$shared/types', () => ({
  AgentStatus: { IDLE: 'idle', STREAMING: 'streaming' },
  normalizeContentBlocks: vi.fn((b: any) => b),
}));
vi.mock('$shared/types/agent-session', () => ({ AgentActivationState: { IDLE: 'idle' } }));
vi.mock('$shared/constants/agent-services', () => ({ DEFAULT_AGENT_MODEL: 'test-model' }));
vi.mock('../browser/services/request-deduplicator.service', () => ({
  requestDeduplicator: { deduplicate: vi.fn((_k: string, fn: () => any) => fn()) },
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
vi.mock('svelte/store', () => ({
  writable: (val: any) => ({ subscribe: vi.fn(), set: vi.fn(), update: vi.fn() }),
  get: vi.fn(() => new Map()),
}));
vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));



// ═══════════════════════════════════════════════════════════════════════════
// Part 1: Concurrent streaming isolation via PendingEventQueue (scenarios 1–4)
// ═══════════════════════════════════════════════════════════════════════════

describe('Concurrent streaming isolation (PendingEventQueue)', () => {
  let queue: PendingEventQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new PendingEventQueue(30_000, 100);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Scenario 1
  it('two agents streaming simultaneously — chunks route to correct session', () => {
    queue.queue('agent-1', 'chunk', { text: 'Hello from agent-1' });
    queue.queue('agent-2', 'chunk', { text: 'Hello from agent-2' });
    queue.queue('agent-1', 'chunk', { text: 'More from agent-1' });
    queue.queue('agent-2', 'chunk', { text: 'More from agent-2' });
    queue.queue('agent-1', 'chunk', { text: 'Final from agent-1' });

    expect(queue.getQueueSize('agent-1')).toBe(3);
    expect(queue.getQueueSize('agent-2')).toBe(2);

    const a1 = queue.replay('agent-1');
    const a2 = queue.replay('agent-2');

    expect(a1).toEqual([
      { type: 'chunk', detail: { text: 'Hello from agent-1' } },
      { type: 'chunk', detail: { text: 'More from agent-1' } },
      { type: 'chunk', detail: { text: 'Final from agent-1' } },
    ]);
    expect(a2).toEqual([
      { type: 'chunk', detail: { text: 'Hello from agent-2' } },
      { type: 'chunk', detail: { text: 'More from agent-2' } },
    ]);
  });

  // Scenario 2
  it('one agent stream ends while another continues — no cross-contamination', () => {
    queue.queue('agent-1', 'chunk', { text: 'a1' });
    queue.queue('agent-2', 'chunk', { text: 'a2' });

    const a1 = queue.replay('agent-1');
    expect(a1).toHaveLength(1);
    expect(queue.has('agent-1')).toBe(false);

    queue.queue('agent-2', 'chunk', { text: 'a2-2' });
    queue.queue('agent-2', 'end', { done: true });

    expect(queue.getQueueSize('agent-2')).toBe(3);
    const a2 = queue.replay('agent-2');
    expect(a2).toHaveLength(3);
    expect(a2[2]).toEqual({ type: 'end', detail: { done: true } });
    expect(queue.has('agent-1')).toBe(false);
  });

  // Scenario 3
  it('clearing agent-1 does not affect agent-2 active stream', () => {
    queue.queue('agent-1', 'chunk', { n: 1 });
    queue.queue('agent-1', 'chunk', { n: 2 });
    queue.queue('agent-2', 'chunk', { n: 10 });
    queue.queue('agent-2', 'chunk', { n: 20 });

    queue.clear('agent-1');
    expect(queue.has('agent-1')).toBe(false);
    expect(queue.has('agent-2')).toBe(true);
    expect(queue.getQueueSize('agent-2')).toBe(2);

    const events = queue.replay('agent-2');
    expect(events).toEqual([
      { type: 'chunk', detail: { n: 10 } },
      { type: 'chunk', detail: { n: 20 } },
    ]);
  });

  // Scenario 4
  it('pending event queues are fully isolated — overflow and clearAll', () => {
    const small = new PendingEventQueue(30_000, 3);
    small.queue('agent-1', 'a', {});
    vi.advanceTimersByTime(1);
    small.queue('agent-1', 'b', {});
    vi.advanceTimersByTime(1);
    small.queue('agent-1', 'c', {});
    vi.advanceTimersByTime(1);
    small.queue('agent-1', 'd', {}); // overflow

    small.queue('agent-2', 'x', {});
    vi.advanceTimersByTime(1);
    small.queue('agent-2', 'y', {});

    expect(small.getQueueSize('agent-1')).toBe(3);
    expect(small.getQueueSize('agent-2')).toBe(2);

    expect(small.replay('agent-1').map((e) => e.type)).toEqual(['b', 'c', 'd']);
    expect(small.replay('agent-2').map((e) => e.type)).toEqual(['x', 'y']);

    small.queue('agent-1', 'new', {});
    small.queue('agent-2', 'new', {});
    small.clearAll();
    expect(small.has('agent-1')).toBe(false);
    expect(small.has('agent-2')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 2: AgentService concurrent streaming & delegation flow (scenarios 5–10)
// ═══════════════════════════════════════════════════════════════════════════

describe('AgentService multi-agent streaming & delegation', () => {
  let agentService: any;
  let dispatchSpy: ReturnType<typeof vi.fn>;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sendSpy = vi.fn();
    (globalThis as any).window = {
      electronAPI: {
        on: mockOn,
        off: mockOff,
        offById: vi.fn(),
        removeAllListeners: vi.fn(),
        invoke: vi.fn(),
        send: sendSpy,
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      CustomEvent: CustomEvent,
    };
    dispatchSpy = (globalThis as any).window.dispatchEvent;

    const mod = await import('../agent.service');
    agentService = mod.agentService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  // ── Scenario 5: agent:created → registerStreamHandler → session-updated ──

  it('Scenario 5: concurrent agents — registerDomHandler + dispatch are isolated', () => {
    // Register DOM handler for agent-1 only
    agentService.registerDomHandler('agent-1');

    // Dispatch to agent-1 (has handler → dispatches)
    (agentService as any).dispatchStreamEvent('agent-1', 'chunk', { data: 'for-1' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0][0].type).toBe('agent:stream:agent-1');

    // Dispatch to agent-2 (no handler → queues)
    (agentService as any).dispatchStreamEvent('agent-2', 'chunk', { data: 'for-2' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1); // still 1
    expect((agentService as any).pendingEventQueue.has('agent-2')).toBe(true);

    // Now register agent-2 and replay
    agentService.registerDomHandler('agent-2');
    agentService.replayPendingEvents('agent-2');
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy.mock.calls[1][0].type).toBe('agent:stream:agent-2');
    expect(dispatchSpy.mock.calls[1][0].detail).toEqual({ data: 'for-2' });
  });

  // ── Scenario 6: agent:prepare-handler flow ──

  it('Scenario 6: prepare-handler → handler registration → handler-ready signal', () => {
    // Find the agent:prepare-handler handler registered by setupEventListeners
    const prepareHandlerCall = mockOn.mock.calls.find(
      (call: any[]) => call[0] === 'agent:prepare-handler',
    );
    expect(prepareHandlerCall).toBeDefined();

    // Simulate the IPC event
    const handler = prepareHandlerCall![1];
    mockSessionStore.getSession = vi.fn(() => ({
      id: 'delegated-agent-1',
      name: 'Test Agent',
      messages: [],
      isStreaming: false,
    }));

    handler({
      agentId: 'delegated-agent-1',
      workspaceId: 'ws-1',
      agentInfo: { name: 'Delegated Agent' },
    });

    // Should have sent handler-ready back to backend
    expect(sendSpy).toHaveBeenCalledWith('agent:handler-ready', { agentId: 'delegated-agent-1' });

    // Should have registered a stream handler
    expect((agentService as any).activeStreamHandlers.has('delegated-agent-1')).toBe(true);
  });

  // ── Scenario 7: agent:queue:processing flow ──

  it('Scenario 7: queue:processing → stale handler cleanup → fresh handler → streaming', async () => {
    const queueProcessingCall = mockOn.mock.calls.find(
      (call: any[]) => call[0] === 'agent:queue:processing',
    );
    expect(queueProcessingCall).toBeDefined();

    const handler = queueProcessingCall![1];

    // Set up a session that exists
    mockSessionStore.getSessionForWorkspace = vi.fn(() => ({
      id: 'agent-q',
      name: 'Queue Agent',
      messages: [],
      isStreaming: false,
      workspaceId: 'ws-1',
    }));

    // Simulate a stale handler entry
    (agentService as any).activeStreamHandlers.set('agent-q', {
      channel: 'agent:stream:agent-q',
      handler: vi.fn(),
    });

    // The handler is async (it awaits saveSession for Bug I fix),
    // so we must await it to see the handler-ready send.
    await handler({
      agentId: 'agent-q',
      messageId: 'msg-1',
      content: 'Hello',
      contextItems: [],
    });

    // Should have re-registered a fresh handler (old one cleared)
    expect((agentService as any).activeStreamHandlers.has('agent-q')).toBe(true);

    // Should have sent handler-ready
    expect(sendSpy).toHaveBeenCalledWith('agent:handler-ready', { agentId: 'agent-q' });

    // Should have added user message (via workspace-aware method)
    expect(mockSessionStore.addMessageForWorkspace).toHaveBeenCalled();
  });

  // ── Scenario 8: Delegated agent completes → no streaming state leak ──

  it('Scenario 8: delegated agent completes — no streaming state leak', () => {
    // Set up two agents: parent and delegated child
    agentService.registerDomHandler('parent-agent');
    agentService.registerDomHandler('child-agent');

    // Both are streaming
    (agentService as any).dispatchStreamEvent('parent-agent', 'chunk', { data: 'parent-data' });
    (agentService as any).dispatchStreamEvent('child-agent', 'chunk', { data: 'child-data' });
    expect(dispatchSpy).toHaveBeenCalledTimes(2);

    // Child completes — cleanup
    agentService.unregisterDomHandler('child-agent');
    agentService.clearPendingEvents('child-agent');

    // Verify child is cleaned up
    expect((agentService as any).registeredDomHandlers.has('child-agent')).toBe(false);
    expect((agentService as any).pendingEventQueue.has('child-agent')).toBe(false);

    // Parent still works
    dispatchSpy.mockClear();
    (agentService as any).dispatchStreamEvent('parent-agent', 'chunk', { data: 'more-parent' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0][0].type).toBe('agent:stream:parent-agent');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 3: Workspace switching during multi-agent streaming (scenarios 9–10)
// ═══════════════════════════════════════════════════════════════════════════

describe('Workspace switching during multi-agent streaming', () => {
  let agentService: any;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    (globalThis as any).window = {
      electronAPI: {
        on: mockOn,
        off: mockOff,
        offById: vi.fn(),
        removeAllListeners: vi.fn(),
        invoke: vi.fn(),
        send: vi.fn(),
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      CustomEvent: CustomEvent,
    };
    dispatchSpy = (globalThis as any).window.dispatchEvent;

    const mod = await import('../agent.service');
    agentService = mod.agentService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  // Scenario 9: Switch workspace while agent streams → switch back → content intact
  it('Scenario 9: workspace switch preserves queued events for background agent', () => {
    // Agent is streaming in workspace-A
    agentService.registerDomHandler('bg-agent');
    (agentService as any).dispatchStreamEvent('bg-agent', 'chunk', { text: 'chunk-1' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // User switches workspace — DOM handler is unregistered (component unmounts)
    agentService.unregisterDomHandler('bg-agent');

    // Events arrive while user is in different workspace → queued
    (agentService as any).dispatchStreamEvent('bg-agent', 'chunk', { text: 'chunk-2' });
    (agentService as any).dispatchStreamEvent('bg-agent', 'chunk', { text: 'chunk-3' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1); // no new dispatches
    expect((agentService as any).pendingEventQueue.getQueueSize('bg-agent')).toBe(2);

    // User switches back — DOM handler re-registered, replay pending events
    agentService.registerDomHandler('bg-agent');
    agentService.replayPendingEvents('bg-agent');

    // Should have dispatched the 2 queued events
    expect(dispatchSpy).toHaveBeenCalledTimes(3); // 1 original + 2 replayed
    expect(dispatchSpy.mock.calls[1][0].detail).toEqual({ text: 'chunk-2' });
    expect(dispatchSpy.mock.calls[2][0].detail).toEqual({ text: 'chunk-3' });

    // Queue is now empty
    expect((agentService as any).pendingEventQueue.has('bg-agent')).toBe(false);
  });

  // Scenario 10: Two agents in different workspaces — events route correctly
  it('Scenario 10: two agents in different workspaces — events route to correct workspace', () => {
    // Agent in workspace-A has DOM handler
    agentService.registerDomHandler('ws-a-agent');

    // Agent in workspace-B does NOT have DOM handler (user is viewing workspace-A)
    // Events for ws-b-agent should be queued

    // Interleaved events
    (agentService as any).dispatchStreamEvent('ws-a-agent', 'chunk', { ws: 'A', n: 1 });
    (agentService as any).dispatchStreamEvent('ws-b-agent', 'chunk', { ws: 'B', n: 1 });
    (agentService as any).dispatchStreamEvent('ws-a-agent', 'chunk', { ws: 'A', n: 2 });
    (agentService as any).dispatchStreamEvent('ws-b-agent', 'chunk', { ws: 'B', n: 2 });

    // ws-a-agent: dispatched directly (2 events)
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy.mock.calls[0][0].type).toBe('agent:stream:ws-a-agent');
    expect(dispatchSpy.mock.calls[1][0].type).toBe('agent:stream:ws-a-agent');

    // ws-b-agent: queued (2 events)
    expect((agentService as any).pendingEventQueue.getQueueSize('ws-b-agent')).toBe(2);

    // User switches to workspace-B
    agentService.unregisterDomHandler('ws-a-agent');
    agentService.registerDomHandler('ws-b-agent');

    // Replay ws-b-agent events
    agentService.replayPendingEvents('ws-b-agent');
    expect(dispatchSpy).toHaveBeenCalledTimes(4); // 2 original + 2 replayed
    expect(dispatchSpy.mock.calls[2][0].type).toBe('agent:stream:ws-b-agent');
    expect(dispatchSpy.mock.calls[2][0].detail).toEqual({ ws: 'B', n: 1 });
    expect(dispatchSpy.mock.calls[3][0].detail).toEqual({ ws: 'B', n: 2 });

    // New events for ws-a-agent are now queued (no handler)
    (agentService as any).dispatchStreamEvent('ws-a-agent', 'chunk', { ws: 'A', n: 3 });
    expect(dispatchSpy).toHaveBeenCalledTimes(4); // no new dispatch
    expect((agentService as any).pendingEventQueue.has('ws-a-agent')).toBe(true);

    // ws-b-agent events dispatch directly
    (agentService as any).dispatchStreamEvent('ws-b-agent', 'chunk', { ws: 'B', n: 3 });
    expect(dispatchSpy).toHaveBeenCalledTimes(5);
    expect(dispatchSpy.mock.calls[4][0].type).toBe('agent:stream:ws-b-agent');
  });
});
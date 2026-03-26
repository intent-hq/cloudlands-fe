/**
 * AgentService Streaming & PendingEventQueue Tests
 *
 * Tests the REAL methods — not mocked versions. Covers bug fixes:
 * - BUG 1a: hasActiveStreamListener checks DOM handlers only
 * - BUG 1b: dispatchStreamEvent queues OR dispatches, never both
 * - BUG 1c: PendingEventQueue snapshot approach prevents lost events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PendingEventQueue } from '../utils/pending-event-queue';

// ═══════════════════════════════════════════════════════════════════════════
// Part 1: PendingEventQueue unit tests (scenarios 1–9)
// Pure data structure — no mocking needed.
// ═══════════════════════════════════════════════════════════════════════════

describe('PendingEventQueue', () => {
  let queue: PendingEventQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new PendingEventQueue(30_000, 100);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Scenario 1
  it('queue() adds events to the queue', () => {
    queue.queue('s1', 'chunk', { data: 'hello' });
    expect(queue.has('s1')).toBe(true);
    expect(queue.getQueueSize('s1')).toBe(1);
    queue.queue('s1', 'chunk', { data: 'world' });
    expect(queue.getQueueSize('s1')).toBe(2);
  });

  // Scenario 2
  it('queue() enforces maxSize (oldest removed)', () => {
    const small = new PendingEventQueue(30_000, 3);
    small.queue('s1', 'a', {});
    vi.advanceTimersByTime(1);
    small.queue('s1', 'b', {});
    vi.advanceTimersByTime(1);
    small.queue('s1', 'c', {});
    vi.advanceTimersByTime(1);
    small.queue('s1', 'd', {});
    expect(small.getQueueSize('s1')).toBe(3);
    const events = small.replay('s1');
    expect(events.map((e) => e.type)).toEqual(['b', 'c', 'd']);
  });

  // Scenario 3
  it('queue() filters expired events on insertion', () => {
    queue.queue('s1', 'old', { n: 1 });
    vi.advanceTimersByTime(31_000);
    queue.queue('s1', 'new', { n: 2 });
    expect(queue.getQueueSize('s1')).toBe(1);
    const events = queue.replay('s1');
    expect(events).toEqual([{ type: 'new', detail: { n: 2 } }]);
  });

  // Scenario 4
  it('replay() returns events in order and clears them', () => {
    queue.queue('s1', 'a', { n: 1 });
    vi.advanceTimersByTime(10);
    queue.queue('s1', 'b', { n: 2 });
    vi.advanceTimersByTime(10);
    queue.queue('s1', 'c', { n: 3 });
    const events = queue.replay('s1');
    expect(events).toEqual([
      { type: 'a', detail: { n: 1 } },
      { type: 'b', detail: { n: 2 } },
      { type: 'c', detail: { n: 3 } },
    ]);
    expect(queue.has('s1')).toBe(false);
    expect(queue.getQueueSize('s1')).toBe(0);
  });

  // Scenario 5
  it('replay() preserves events added after replay (snapshot behavior)', () => {
    queue.queue('s1', 'existing', { n: 1 });
    vi.advanceTimersByTime(5);
    const events = queue.replay('s1');
    expect(events).toHaveLength(1);
    // Add event after replay returned (simulating event added during caller dispatch)
    queue.queue('s1', 'later', { n: 2 });
    expect(queue.has('s1')).toBe(true);
    expect(queue.getQueueSize('s1')).toBe(1);
    const later = queue.replay('s1');
    expect(later).toEqual([{ type: 'later', detail: { n: 2 } }]);
  });

  // Scenario 6
  it('replay() skips expired events', () => {
    queue.queue('s1', 'old', {});
    vi.advanceTimersByTime(31_000);
    const events = queue.replay('s1');
    expect(events).toEqual([]);
    expect(queue.has('s1')).toBe(false);
  });

  // Scenario 7
  it('clear() removes all events for a session', () => {
    queue.queue('s1', 'a', {});
    queue.queue('s1', 'b', {});
    queue.clear('s1');
    expect(queue.has('s1')).toBe(false);
    expect(queue.getQueueSize('s1')).toBe(0);
  });

  // Scenario 8
  it('has() returns correct boolean', () => {
    expect(queue.has('s1')).toBe(false);
    queue.queue('s1', 'x', {});
    expect(queue.has('s1')).toBe(true);
    queue.clear('s1');
    expect(queue.has('s1')).toBe(false);
  });

  // Scenario 9
  it('multiple sessions are isolated', () => {
    queue.queue('s1', 'a', { from: 's1' });
    queue.queue('s2', 'b', { from: 's2' });
    expect(queue.getQueueSize('s1')).toBe(1);
    expect(queue.getQueueSize('s2')).toBe(1);
    const s1 = queue.replay('s1');
    expect(s1).toEqual([{ type: 'a', detail: { from: 's1' } }]);
    expect(queue.has('s2')).toBe(true);
    queue.clearAll();
    expect(queue.has('s2')).toBe(false);
  });

  // ── Global limit and cleanup tests ──────────────────────────────────────

  it('enforces maxTotalEvents by dropping from the largest session', () => {
    const q = new PendingEventQueue(30_000, 100, 5);
    // Add 3 to s1, 2 to s2 = 5 total (at limit)
    q.queue('s1', 'a', {});
    vi.advanceTimersByTime(1);
    q.queue('s1', 'b', {});
    vi.advanceTimersByTime(1);
    q.queue('s1', 'c', {});
    vi.advanceTimersByTime(1);
    q.queue('s2', 'x', {});
    vi.advanceTimersByTime(1);
    q.queue('s2', 'y', {});
    expect(q.getTotalEventCount()).toBe(5);

    // Adding one more should drop oldest from s1 (largest session)
    vi.advanceTimersByTime(1);
    q.queue('s2', 'z', {});
    expect(q.getTotalEventCount()).toBe(5);
    // s1 should have lost its oldest event ('a')
    const s1Events = q.replay('s1');
    expect(s1Events.map((e) => e.type)).toEqual(['b', 'c']);
  });

  it('cleanup() removes expired events and empty sessions', () => {
    const q = new PendingEventQueue(1000, 100, 1000);
    q.queue('s1', 'a', {});
    vi.advanceTimersByTime(500);
    q.queue('s1', 'b', {});
    q.queue('s2', 'x', {});

    // Advance past maxAge for 'a' but not 'b' or 'x'
    vi.advanceTimersByTime(600);

    const result = q.cleanup();
    expect(result.eventsRemoved).toBe(1); // 'a' expired
    expect(result.sessionsRemoved).toBe(0); // s1 still has 'b'
    expect(q.getQueueSize('s1')).toBe(1);

    // Expire everything
    vi.advanceTimersByTime(1000);
    const result2 = q.cleanup();
    expect(result2.eventsRemoved).toBe(2);
    expect(result2.sessionsRemoved).toBe(2);
    expect(q.getSessionCount()).toBe(0);
  });

  it('startPeriodicCleanup() runs cleanup on interval', () => {
    const q = new PendingEventQueue(500, 100, 1000);
    q.queue('s1', 'a', {});
    q.startPeriodicCleanup(200);

    // After 200ms, event is still valid (maxAge=500)
    vi.advanceTimersByTime(200);
    expect(q.getQueueSize('s1')).toBe(1);

    // After 600ms total, event is expired and cleanup should have run
    vi.advanceTimersByTime(400);
    expect(q.getSessionCount()).toBe(0);

    q.stopPeriodicCleanup();
  });

  it('stopPeriodicCleanup() stops the timer', () => {
    const q = new PendingEventQueue(100, 100, 1000);
    q.queue('s1', 'a', {});
    q.startPeriodicCleanup(50);
    q.stopPeriodicCleanup();

    // Even after time passes, cleanup should not have run
    vi.advanceTimersByTime(200);
    // Event expired but cleanup timer was stopped, so session entry remains
    // (events are only cleaned on access or explicit cleanup)
    expect(q.getSessionCount()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 2: AgentService dispatch/handler tests (scenarios 10–20)
//
// Strategy: mock all heavy dependencies so the module loads, then test the
// REAL dispatch, handler registration, and queue integration methods.
// ═══════════════════════════════════════════════════════════════════════════

// --- dependency mocks (must be before dynamic import) ---

const mockOn = vi.fn();
const mockOff = vi.fn();

vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn() }));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('$shared/types/branded-ids', () => ({
  createMessageId: (id: string) => id,
  WorkspaceId: (id: string) => id,
}));

vi.mock('../services/unified-state-store', () => ({
  unifiedStateStore: {
    currentWorkspace: { workspace: { id: 'ws-1' } },
    getSession: vi.fn(),
    getAllSessionsAcrossWorkspaces: vi.fn(() => []),
    addSession: vi.fn(),
    setAgent: vi.fn(),
    setStreaming: vi.fn(),
    updateMessage: vi.fn(),
    updateMessageForWorkspace: vi.fn(),
  },
}));

vi.mock('../services/performance-optimizer', () => ({
  performanceOptimizer: {
    scheduleUpdate: vi.fn((fn: () => void) => fn()),
    flush: vi.fn(),
  },
}));

vi.mock('../services/agent-factory', () => ({
  agentFactory: { createAgent: vi.fn() },
}));

// Create a comprehensive sessionStore mock with all used methods
const mockSessionStore = new Proxy(
  {
    getStore: () => ({
      subscribe: vi.fn(),
      set: vi.fn(),
      update: vi.fn(),
    }),
  },
  {
    get(target: any, prop: string) {
      if (prop in target) return target[prop];
      // Auto-create vi.fn() for any accessed method
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
  errorRecovery: { wrap: vi.fn((fn: any) => fn), execute: vi.fn() },
  DEFAULT_STRATEGIES: {},
}));

vi.mock('$shared/ipc/channels', () => ({
  AGENT_BACKEND_CHANNELS: {
    STREAM: 'agent:stream',
    CREATE: 'agent:create',
    SEND_MESSAGE: 'agent:send-message',
    GET_ACTIVE_STREAMS: 'agent:get-active-streams',
  },
}));

vi.mock('$shared/constants/agent-streaming', () => ({
  AGENT_STREAMING_CONFIG: {
    STREAM_TIMEOUT_MS: 120_000,
    KEEP_ALIVE_INTERVAL_MS: 30_000,
  },
}));

vi.mock('$shared/types', () => ({
  AgentStatus: { IDLE: 'idle', STREAMING: 'streaming' },
  normalizeContentBlocks: vi.fn((b: any) => b),
}));

vi.mock('$shared/types/agent-session', () => ({
  AgentActivationState: { IDLE: 'idle' },
}));

vi.mock('$shared/constants/agent-services', () => ({
  DEFAULT_AGENT_MODEL: 'test-model',
}));

vi.mock('../browser/services/request-deduplicator.service', () => ({
  requestDeduplicator: {
    deduplicate: vi.fn((_key: string, fn: () => any) => fn()),
  },
  generateMessageKey: vi.fn(() => 'key'),
}));

vi.mock('../services/unread-tracking.service', () => ({
  unreadTrackingService: {
    markAsRead: vi.fn(),
    markAsUnread: vi.fn(),
    getUnreadCount: vi.fn(() => 0),
    setAgentExistsCallback: vi.fn(),
    onNewAssistantMessage: vi.fn(),
  },
}));

vi.mock('$lib/services/analytics', () => ({
  track: vi.fn(),
}));

vi.mock('$features/agent/services/error-handler', () => ({
  errorHandler: { handle: vi.fn(), wrap: vi.fn((fn: any) => fn) },
  AgentError: class extends Error {},
  ErrorCode: {},
  ErrorCategory: {},
  ErrorSeverity: {},
}));

vi.mock('../../observability/event-collector-client', () => ({
  eventCollector: { emit: vi.fn(), track: vi.fn() },
  AgentEventType: {},
}));

vi.mock('../../workspace/workspace-metrics', () => ({
  workspaceMetrics: { record: vi.fn() },
}));

vi.mock('../agent-file-tracker', () => ({
  agentFileTracker: { track: vi.fn() },
}));

vi.mock('$lib/utils/browser-event-emitter', () => {
  class EventEmitter {
    private _h = new Map<string, Set<Function>>();
    on(ev: string, fn: Function) {
      if (!this._h.has(ev)) this._h.set(ev, new Set());
      this._h.get(ev)!.add(fn);
    }
    off(ev: string, fn: Function) {
      this._h.get(ev)?.delete(fn);
    }
    emit(ev: string, ...args: any[]) {
      this._h.get(ev)?.forEach((h) => h(...args));
    }
  }
  return { EventEmitter };
});

vi.mock('svelte/store', () => ({
  writable: (val: any) => ({
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  }),
  get: vi.fn(() => new Map()),
}));

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('AgentService dispatch/handler methods', () => {
  let agentService: any;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Set up window globals needed by AgentService constructor
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

    // Dynamically import to get a fresh module with our mocks applied
    const mod = await import('../agent.service');
    agentService = mod.agentService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  // Scenario 10
  it('registerDomHandler / unregisterDomHandler track correctly', () => {
    agentService.registerDomHandler('agent-1');
    expect((agentService as any).registeredDomHandlers.has('agent-1')).toBe(true);

    agentService.unregisterDomHandler('agent-1');
    expect((agentService as any).registeredDomHandlers.has('agent-1')).toBe(false);
  });

  // Scenario 11
  it('dispatchStreamEvent dispatches when DOM handler exists', () => {
    agentService.registerDomHandler('agent-1');
    (agentService as any).dispatchStreamEvent('agent-1', 'chunk', { data: 'hello' });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0];
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe('agent:stream:agent-1');
    expect(event.detail).toEqual({ data: 'hello' });

    // Should NOT have queued the event
    expect((agentService as any).pendingEventQueue.has('agent-1')).toBe(false);
  });

  // Scenario 12
  it('dispatchStreamEvent queues when no DOM handler exists', () => {
    (agentService as any).dispatchStreamEvent('agent-2', 'chunk', { data: 'queued' });

    // Should NOT have dispatched
    expect(dispatchSpy).not.toHaveBeenCalled();

    // Should have queued
    expect((agentService as any).pendingEventQueue.has('agent-2')).toBe(true);
    expect((agentService as any).pendingEventQueue.getQueueSize('agent-2')).toBe(1);
  });

  // Scenario 13 — regression test for BUG 1b
  it('dispatchStreamEvent NEVER both queues AND dispatches', () => {
    // Without DOM handler → only queue
    (agentService as any).dispatchStreamEvent('agent-3', 'chunk', { data: 'x' });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect((agentService as any).pendingEventQueue.has('agent-3')).toBe(true);

    // Clear for next test
    (agentService as any).pendingEventQueue.clear('agent-3');
    dispatchSpy.mockClear();

    // With DOM handler → only dispatch
    agentService.registerDomHandler('agent-3');
    (agentService as any).dispatchStreamEvent('agent-3', 'chunk', { data: 'y' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect((agentService as any).pendingEventQueue.has('agent-3')).toBe(false);
  });

  // Scenario 14 — regression test for BUG 1a
  it('hasActiveStreamListener returns false when only IPC handler exists', () => {
    // Simulate IPC handler registered but NO DOM handler
    (agentService as any).activeStreamHandlers.set('agent-4', {
      channel: 'agent:stream:agent-4',
      handler: vi.fn(),
    });

    expect((agentService as any).hasActiveStreamListener('agent-4')).toBe(false);
  });

  // Scenario 15
  it('hasActiveStreamListener returns true only when DOM handler registered', () => {
    expect((agentService as any).hasActiveStreamListener('agent-5')).toBe(false);
    agentService.registerDomHandler('agent-5');
    expect((agentService as any).hasActiveStreamListener('agent-5')).toBe(true);
    agentService.unregisterDomHandler('agent-5');
    expect((agentService as any).hasActiveStreamListener('agent-5')).toBe(false);
  });

  // Scenario 16
  it('replayPendingEvents dispatches queued events as CustomEvents', () => {
    // Queue some events (no DOM handler)
    (agentService as any).dispatchStreamEvent('agent-6', 'start', { id: 1 });
    (agentService as any).dispatchStreamEvent('agent-6', 'chunk', { id: 2 });
    (agentService as any).dispatchStreamEvent('agent-6', 'end', { id: 3 });
    expect(dispatchSpy).not.toHaveBeenCalled();

    // Now replay
    agentService.replayPendingEvents('agent-6');
    expect(dispatchSpy).toHaveBeenCalledTimes(3);

    const calls = dispatchSpy.mock.calls;
    expect(calls[0][0].type).toBe('agent:stream:agent-6');
    expect(calls[0][0].detail).toEqual({ id: 1 });
    expect(calls[1][0].detail).toEqual({ id: 2 });
    expect(calls[2][0].detail).toEqual({ id: 3 });

    // Queue should be empty after replay
    expect((agentService as any).pendingEventQueue.has('agent-6')).toBe(false);
  });

  // Scenario 17
  it('clearPendingEvents empties the queue', () => {
    (agentService as any).dispatchStreamEvent('agent-7', 'chunk', { data: 'x' });
    expect((agentService as any).pendingEventQueue.has('agent-7')).toBe(true);

    agentService.clearPendingEvents('agent-7');
    expect((agentService as any).pendingEventQueue.has('agent-7')).toBe(false);
  });

  // ── Multi-agent isolation tests (scenarios 18–20) ───────────────────────

  // Scenario 18
  it('events for agent-1 do not appear in agent-2 queue', () => {
    (agentService as any).dispatchStreamEvent('agent-A', 'chunk', { for: 'A' });
    (agentService as any).dispatchStreamEvent('agent-B', 'chunk', { for: 'B' });

    expect((agentService as any).pendingEventQueue.getQueueSize('agent-A')).toBe(1);
    expect((agentService as any).pendingEventQueue.getQueueSize('agent-B')).toBe(1);

    const aEvents = (agentService as any).pendingEventQueue.replay('agent-A');
    expect(aEvents).toEqual([{ type: 'chunk', detail: { for: 'A' } }]);
    // B unaffected
    expect((agentService as any).pendingEventQueue.has('agent-B')).toBe(true);
  });

  // Scenario 19
  it('registering DOM handler for agent-1 does not affect agent-2 dispatch', () => {
    agentService.registerDomHandler('agent-A');

    // agent-A dispatches (has handler)
    (agentService as any).dispatchStreamEvent('agent-A', 'chunk', { for: 'A' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // agent-B queues (no handler)
    (agentService as any).dispatchStreamEvent('agent-B', 'chunk', { for: 'B' });
    expect(dispatchSpy).toHaveBeenCalledTimes(1); // still 1
    expect((agentService as any).pendingEventQueue.has('agent-B')).toBe(true);
  });

  // Scenario 20
  it('clearing agent-1 queue does not affect agent-2', () => {
    (agentService as any).dispatchStreamEvent('agent-A', 'chunk', {});
    (agentService as any).dispatchStreamEvent('agent-B', 'chunk', {});

    agentService.clearPendingEvents('agent-A');
    expect((agentService as any).pendingEventQueue.has('agent-A')).toBe(false);
    expect((agentService as any).pendingEventQueue.has('agent-B')).toBe(true);
  });

  // ── Streaming diagnostics tests (scenarios 21–23) ──────────────────────

  // Scenario 21
  it('getStreamingDiagnostics returns correct state after setup', () => {
    // Clear leaked state from previous tests
    (agentService as any).activeStreamHandlers.clear();
    (agentService as any).registeredDomHandlers.clear();
    (agentService as any).pendingEventQueue.clearAll();

    // Register an IPC handler (simulating ensureStreamHandler)
    (agentService as any).activeStreamHandlers.set('agent-diag-1', {
      channel: 'agent:stream:agent-diag-1',
      handler: vi.fn(),
    });

    // Register a DOM handler
    agentService.registerDomHandler('agent-diag-1');

    // Queue some events for a different session (no DOM handler)
    (agentService as any).dispatchStreamEvent('agent-diag-2', 'chunk', { data: 'pending' });

    const diag = agentService.getStreamingDiagnostics();

    // IPC handlers
    expect(diag.activeIpcHandlers).toEqual([
      { agentId: 'agent-diag-1', channel: 'agent:stream:agent-diag-1', hasTimeout: false },
    ]);

    // DOM handlers
    expect(diag.registeredDomHandlers).toContain('agent-diag-1');

    // Pending queues
    expect(diag.pendingQueues).toHaveLength(1);
    expect(diag.pendingQueues[0].sessionId).toBe('agent-diag-2');
    expect(diag.pendingQueues[0].eventCount).toBe(1);
    expect(diag.pendingQueues[0].oldestEventAge).toBeGreaterThanOrEqual(0);

    // Health summary
    expect(diag.health.totalActiveStreams).toBe(1);
    expect(diag.health.totalPendingEvents).toBe(1);
    expect(diag.health.hasOrphanedHandlers).toBe(false);
    expect(diag.health.oldestPendingEventAge).toBeGreaterThanOrEqual(0);
  });

  // Scenario 22
  it('getStreamingDiagnostics detects orphaned handlers', () => {
    // Clear leaked state
    (agentService as any).activeStreamHandlers.clear();
    (agentService as any).registeredDomHandlers.clear();
    (agentService as any).pendingEventQueue.clearAll();

    // IPC handler exists but NO DOM handler → orphaned
    (agentService as any).activeStreamHandlers.set('agent-orphan', {
      channel: 'agent:stream:agent-orphan',
      handler: vi.fn(),
    });

    const diag = agentService.getStreamingDiagnostics();

    expect(diag.orphanedHandlers).toEqual(['agent-orphan']);
    expect(diag.health.hasOrphanedHandlers).toBe(true);
  });

  // Scenario 23
  it('getStreamingDiagnostics returns empty state when nothing is active', () => {
    // Clear leaked state
    (agentService as any).activeStreamHandlers.clear();
    (agentService as any).registeredDomHandlers.clear();
    (agentService as any).pendingEventQueue.clearAll();

    const diag = agentService.getStreamingDiagnostics();

    expect(diag.activeIpcHandlers).toEqual([]);
    expect(diag.registeredDomHandlers).toEqual([]);
    expect(diag.pendingQueues).toEqual([]);
    expect(diag.streamTimeouts).toEqual([]);
    expect(diag.orphanedHandlers).toEqual([]);
    expect(diag.health).toEqual({
      totalActiveStreams: 0,
      totalPendingEvents: 0,
      hasOrphanedHandlers: false,
      oldestPendingEventAge: null,
    });
  });

  // ─── forceReregister IPC listener cleanup (regression tests) ───────────
  describe('forceReregister IPC listener cleanup', () => {
    const agentId = 'agent-force-reregister';
    let originalGetSession: any;

    beforeEach(() => {
      vi.useFakeTimers();

      // Clear state that may leak from prior scenarios
      (agentService as any).activeStreamHandlers.clear();
      (agentService as any).activePingHandlers.clear();
      (agentService as any).pendingEventQueue.clearAll();

      // Mock sessionStore.getSession to return a session with workspaceId
      originalGetSession = mockSessionStore.getSession;
      mockSessionStore.getSession = vi.fn(() => ({ workspaceId: 'ws-1' }));

      // Mock registerStreamHandlerForSession to avoid its heavy dependencies
      vi.spyOn(agentService as any, 'registerStreamHandlerForSession').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.useRealTimers();
      mockSessionStore.getSession = originalGetSession;
    });

    it('ensureStreamHandler with forceReregister calls offById to remove old IPC listener', () => {
      // Seed an existing handler with a listenerId
      (agentService as any).activeStreamHandlers.set(agentId, {
        channel: `agent:stream:${agentId}`,
        handler: vi.fn(),
        listenerId: 'old-listener-123',
        registeredAt: Date.now(),
      });

      agentService.ensureStreamHandler(agentId, { forceReregister: true });

      // offById should have been called with the old handler's channel and listenerId
      expect(window.electronAPI.offById).toHaveBeenCalledWith(
        `agent:stream:${agentId}`,
        'old-listener-123',
      );
    });

    it('ensureStreamHandler with forceReregister cleans up ping handler', () => {
      // Seed existing stream handler
      (agentService as any).activeStreamHandlers.set(agentId, {
        channel: `agent:stream:${agentId}`,
        handler: vi.fn(),
        listenerId: 'stream-lid',
        registeredAt: Date.now(),
      });
      // Seed existing ping handler
      (agentService as any).activePingHandlers.set(agentId, {
        channel: `agent:stream:ping:${agentId}`,
        handler: vi.fn(),
        listenerId: 'ping-lid',
      });

      agentService.ensureStreamHandler(agentId, { forceReregister: true });

      // Both stream and ping listeners should be cleaned up via offById
      expect(window.electronAPI.offById).toHaveBeenCalledWith(
        `agent:stream:${agentId}`,
        'stream-lid',
      );
      expect(window.electronAPI.offById).toHaveBeenCalledWith(
        `agent:stream:ping:${agentId}`,
        'ping-lid',
      );
      // Ping handler should be removed from the map
      expect((agentService as any).activePingHandlers.has(agentId)).toBe(false);
    });

    it('ensureStreamHandler with forceReregister clears pending events', () => {
      // Seed existing handler
      (agentService as any).activeStreamHandlers.set(agentId, {
        channel: `agent:stream:${agentId}`,
        handler: vi.fn(),
        listenerId: 'lid',
        registeredAt: Date.now(),
      });
      // Queue some pending events
      (agentService as any).pendingEventQueue.queue(agentId, 'chunk', { data: 'a' });
      (agentService as any).pendingEventQueue.queue(agentId, 'chunk', { data: 'b' });
      expect((agentService as any).pendingEventQueue.has(agentId)).toBe(true);

      agentService.ensureStreamHandler(agentId, { forceReregister: true });

      // Pending events should be cleared
      expect((agentService as any).pendingEventQueue.has(agentId)).toBe(false);
    });

    it('ensureStreamHandler without forceReregister does not remove existing handler', () => {
      const existingHandler = {
        channel: `agent:stream:${agentId}`,
        handler: vi.fn(),
        listenerId: 'keep-me',
        registeredAt: Date.now(),
      };
      (agentService as any).activeStreamHandlers.set(agentId, existingHandler);

      const result = agentService.ensureStreamHandler(agentId);

      // Should return early without cleaning up
      expect(result).toEqual({ created: false, channel: `agent:stream:${agentId}` });
      expect(window.electronAPI.offById).not.toHaveBeenCalled();
      // Handler should still be in the map
      expect((agentService as any).activeStreamHandlers.get(agentId)).toBe(existingHandler);
    });
  });

  // ── Race condition regression test ─────────────────────────────────────
  // REGRESSION: Prevents reintroduction of the fallback that called
  // sessionStore.setStreamingForWorkspace(wsId, agentId, false) inside the
  // IPC handler's "no DOM handler" branch. That fallback raced with
  // initializeChat() which reads isStreaming from sessionStore — clearing it
  // too early caused initializeChat to load stale state and lose the response.
  // The fix removed that fallback: the IPC handler already clears streaming
  // state in its session-processing branches (lines ~1878/1924/1943), so the
  // additional clear after dispatchStreamEvent was redundant and harmful.
  // This test exercises the ACTUAL IPC handler path (registerStreamHandlerForSession)
  // rather than calling dispatchStreamEvent directly, so it would fail if the
  // fallback were accidentally reintroduced.
  it('REGRESSION: IPC handler end-event path should NOT double-clear streaming state when no DOM handler', () => {
    const agentId = 'agent-race-condition';
    const workspaceId = 'ws-race-test';

    // Step 1: Clear state and set up mocks for registerStreamHandlerForSession
    (agentService as any).activeStreamHandlers.clear();
    (agentService as any).pendingStreamRegistrations.clear();
    (agentService as any).pendingEventQueue.clearAll();
    mockOn.mockClear();
    mockSessionStore.setStreamingForWorkspace.mockClear();
    // Return a session with a user message but no streaming assistant message.
    // This makes the IPC handler's 'complete' path enter the session-processing branch
    // and reach the else clause that calls setStreamingForWorkspace(false).
    mockSessionStore.getSessionForWorkspace.mockReturnValue({
      id: agentId,
      messages: [{ role: 'user', content: 'test' }],
      workspaceId: workspaceId,
    });

    // Step 2: Register the IPC stream handler (this is what happens in production
    // when reconnectStreamHandlersForWorkspace or ensureStreamHandler runs)
    agentService.registerStreamHandlerForSession(agentId, undefined, workspaceId);

    // Step 3: Extract the IPC handler that was registered via window.electronAPI.on
    const streamChannel = `agent:stream:${agentId}`;
    const onCall = mockOn.mock.calls.find((c: any[]) => c[0] === streamChannel);
    expect(onCall).toBeDefined();
    const ipcHandler = onCall![1];

    // Step 4: Ensure NO DOM handler is registered (simulating ChatPanel destroyed during remount)
    agentService.unregisterDomHandler(agentId);
    expect((agentService as any).hasActiveStreamListener(agentId)).toBe(false);

    // Step 5: Simulate the backend sending a 'complete' event through the IPC handler
    // while no DOM handler is registered — this is the exact race condition scenario.
    // No backendMessage means the handler enters the final else branch that calls
    // setStreamingForWorkspace(false) once from session processing.
    mockSessionStore.setStreamingForWorkspace.mockClear();
    mockSessionStore.getSessionForWorkspace.mockClear();
    dispatchSpy.mockClear();
    ipcHandler({ type: 'complete' });

    // Step 6: FIX VERIFICATION — setStreamingForWorkspace(false) should be called
    // exactly ONCE from the session-processing branch (line ~1943 in agent.service.ts),
    // NOT a second time from the fallback after dispatchStreamEvent queues the end event.
    // The old buggy code had an additional setStreamingForWorkspace(false) call in the
    // "no DOM handler" branch that raced with initializeChat().
    const falseCalls = mockSessionStore.setStreamingForWorkspace.mock.calls.filter(
      (call: any[]) => call[2] === false,
    );
    expect(falseCalls).toHaveLength(1);
    expect(falseCalls[0]).toEqual([workspaceId, agentId, false]);

    // Step 7: Verify the call came from the session-processing branch, not a fallback.
    // The session-processing else branch (~line 1943) clears streaming state BEFORE
    // getStreamSession() is called for unread tracking (~line 2062). A fallback
    // reintroduced after dispatchStreamEvent (~line 2089) would clear it AFTER that
    // getStreamSession() call. Checking relative invocation order proves provenance.
    const falseCallIndex = mockSessionStore.setStreamingForWorkspace.mock.calls.findIndex(
      (call: any[]) => call[2] === false,
    );
    const setStreamingCallOrder =
      mockSessionStore.setStreamingForWorkspace.mock.invocationCallOrder[falseCallIndex];
    const getSessionCallOrders =
      mockSessionStore.getSessionForWorkspace.mock.invocationCallOrder;
    const lastGetSessionCallOrder = getSessionCallOrders[getSessionCallOrders.length - 1];
    expect(setStreamingCallOrder).toBeLessThan(lastGetSessionCallOrder);

    // Clean up mock to not affect other tests
    mockSessionStore.getSessionForWorkspace.mockReset();
  });
});



// ═══════════════════════════════════════════════════════════════════════════
// Part 4: Streaming invariants and health check tests
// ═══════════════════════════════════════════════════════════════════════════

describe('assertStreamingInvariant', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does nothing when condition is true', async () => {
    const { assertStreamingInvariant } = await import('../utils/streaming-invariants');
    assertStreamingInvariant(true, 'should not fire');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('logs console.error when condition is false', async () => {
    const { assertStreamingInvariant } = await import('../utils/streaming-invariants');
    assertStreamingInvariant(false, 'test violation');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('[STREAMING INVARIANT VIOLATION]');
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('test violation');
  });

  it('includes context in the error message', async () => {
    const { assertStreamingInvariant } = await import('../utils/streaming-invariants');
    assertStreamingInvariant(false, 'with context', { sessionId: 'abc', count: 42 });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const msg = consoleErrorSpy.mock.calls[0][0];
    expect(msg).toContain('with context');
    expect(msg).toContain('"sessionId":"abc"');
    expect(msg).toContain('"count":42');
  });

  it('never throws even when condition is false', async () => {
    const { assertStreamingInvariant } = await import('../utils/streaming-invariants');
    expect(() => {
      assertStreamingInvariant(false, 'should not throw');
    }).not.toThrow();
  });
});

describe('AgentService.getStreamingHealth', () => {
  let agentService: any;

  beforeEach(async () => {
    (globalThis as any).window = {
      electronAPI: {
        on: vi.fn(),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
        invoke: vi.fn(),
        send: vi.fn(),
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      CustomEvent: CustomEvent,
    };

    const mod = await import('../agent.service');
    agentService = mod.agentService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  it('returns correct health summary with no active state', () => {
    // Clear any leaked state
    (agentService as any).activeStreamHandlers.clear();
    (agentService as any).registeredDomHandlers.clear();
    (agentService as any).pendingEventQueue.clearAll();

    const health = agentService.getStreamingHealth();
    expect(health).toEqual({
      activeIpcHandlers: 0,
      activeDomHandlers: 0,
      pendingQueueSessions: 0,
      totalPendingEvents: 0,
      orphanedHandlers: [],
    });
  });

  it('detects orphaned IPC handlers (IPC without DOM)', () => {
    (agentService as any).activeStreamHandlers.clear();
    (agentService as any).registeredDomHandlers.clear();
    (agentService as any).pendingEventQueue.clearAll();

    // IPC handler exists but no DOM handler
    (agentService as any).activeStreamHandlers.set('orphan-1', {
      channel: 'agent:stream:orphan-1',
      handler: vi.fn(),
    });

    const health = agentService.getStreamingHealth();
    expect(health.activeIpcHandlers).toBe(1);
    expect(health.activeDomHandlers).toBe(0);
    expect(health.orphanedHandlers).toEqual(['orphan-1']);
  });

  it('reports matching IPC and DOM handlers as non-orphaned', () => {
    (agentService as any).activeStreamHandlers.clear();
    (agentService as any).registeredDomHandlers.clear();
    (agentService as any).pendingEventQueue.clearAll();

    (agentService as any).activeStreamHandlers.set('matched-1', {
      channel: 'agent:stream:matched-1',
      handler: vi.fn(),
    });
    agentService.registerDomHandler('matched-1');

    const health = agentService.getStreamingHealth();
    expect(health.activeIpcHandlers).toBe(1);
    expect(health.activeDomHandlers).toBe(1);
    expect(health.orphanedHandlers).toEqual([]);
  });

  it('counts pending events correctly', () => {
    (agentService as any).activeStreamHandlers.clear();
    (agentService as any).registeredDomHandlers.clear();
    (agentService as any).pendingEventQueue.clearAll();

    // Queue events for two sessions (no DOM handlers)
    (agentService as any).dispatchStreamEvent('q1', 'chunk', { a: 1 });
    (agentService as any).dispatchStreamEvent('q1', 'chunk', { a: 2 });
    (agentService as any).dispatchStreamEvent('q2', 'end', { b: 1 });

    const health = agentService.getStreamingHealth();
    expect(health.pendingQueueSessions).toBe(2);
    expect(health.totalPendingEvents).toBe(3);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Part 5: Debounced reconnect and safety timeout tests (Task 16)
// ═══════════════════════════════════════════════════════════════════════════

describe('Debounced reconnect after disk load (Task 16a)', () => {
  let agentService: any;

  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as any).window = {
      electronAPI: {
        on: vi.fn(),
        off: vi.fn(),
        offById: vi.fn(),
        removeAllListeners: vi.fn(),
        invoke: vi.fn().mockResolvedValue({ success: true, data: [] }),
        send: vi.fn(),
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      CustomEvent: CustomEvent,
    };

    const mod = await import('../agent.service');
    agentService = mod.agentService;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  it('scheduleBackendStreamReconnect sets a 500ms debounce timer', () => {
    const spy = vi.spyOn(agentService, 'reconnectToBackendStreams').mockResolvedValue([]);

    (agentService as any).scheduleBackendStreamReconnect();

    // Timer should be set but not fired yet
    expect(spy).not.toHaveBeenCalled();
    expect((agentService as any).reconnectDebounceTimer).not.toBeNull();

    // Advance past debounce
    vi.advanceTimersByTime(500);

    expect(spy).toHaveBeenCalledTimes(1);
    expect((agentService as any).reconnectDebounceTimer).toBeNull();
  });

  it('multiple calls within debounce window are coalesced', () => {
    const spy = vi.spyOn(agentService, 'reconnectToBackendStreams').mockResolvedValue([]);

    (agentService as any).scheduleBackendStreamReconnect();
    vi.advanceTimersByTime(200);
    (agentService as any).scheduleBackendStreamReconnect();
    vi.advanceTimersByTime(200);
    (agentService as any).scheduleBackendStreamReconnect();

    // Only 500ms from last call should trigger
    vi.advanceTimersByTime(500);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('dispose clears the debounce timer', () => {
    // Ensure service is not already disposed from a previous test
    (agentService as any).isDisposed = false;

    vi.spyOn(agentService, 'reconnectToBackendStreams').mockResolvedValue([]);

    (agentService as any).scheduleBackendStreamReconnect();
    expect((agentService as any).reconnectDebounceTimer).not.toBeNull();

    agentService.dispose();
    expect((agentService as any).reconnectDebounceTimer).toBeNull();
  });
});

describe('Safety timeout for stale streaming (Task 16b)', () => {
  let agentService: any;

  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as any).window = {
      electronAPI: {
        on: vi.fn(),
        off: vi.fn(),
        offById: vi.fn(),
        removeAllListeners: vi.fn(),
        invoke: vi.fn().mockResolvedValue({ success: true, data: [] }),
        send: vi.fn(),
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      CustomEvent: CustomEvent,
    };

    const mod = await import('../agent.service');
    agentService = mod.agentService;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  it('startStreamingSafetyTimeout sets a 10-second timer', () => {
    (agentService as any).startStreamingSafetyTimeout(new Set());
    expect((agentService as any).streamingSafetyTimeout).not.toBeNull();
  });

  it('dispose clears the safety timeout', () => {
    // Ensure service is not already disposed from a previous test
    (agentService as any).isDisposed = false;

    (agentService as any).startStreamingSafetyTimeout(new Set());
    expect((agentService as any).streamingSafetyTimeout).not.toBeNull();

    agentService.dispose();
    expect((agentService as any).streamingSafetyTimeout).toBeNull();
  });

  it('safety timeout clears stale streaming after 10 seconds', async () => {
    // Mock sessionStore to return a session with stale streaming
    const { sessionStore: mockStore } = await import('../browser');
    (mockStore.getAllSessionsAcrossWorkspaces as any).mockReturnValue([
      {
        id: 'stale-agent',
        isStreaming: true,
        workspaceId: 'ws-1',
        messages: [],
      },
    ]);

    // Backend says no active streams
    (window.electronAPI.invoke as any).mockResolvedValue({ success: true, data: [] });

    (agentService as any).startStreamingSafetyTimeout(new Set());

    // Advance past safety timeout
    vi.advanceTimersByTime(10_000);

    // Allow the async callback to execute
    await vi.runAllTimersAsync();

    // Should have called setStreamingForWorkspace to clear the stale state
    expect(mockStore.setStreamingForWorkspace).toHaveBeenCalledWith('ws-1', 'stale-agent', false);
  });

  it('safety timeout does NOT clear sessions with active backend streams', async () => {
    const { sessionStore: mockStore } = await import('../browser');
    (mockStore.getAllSessionsAcrossWorkspaces as any).mockReturnValue([
      {
        id: 'active-agent',
        isStreaming: true,
        workspaceId: 'ws-1',
        messages: [],
      },
    ]);

    // Backend says this agent IS actively streaming
    (window.electronAPI.invoke as any).mockResolvedValue({
      success: true,
      data: [{ agentId: 'active-agent' }],
    });

    // Clear any previous calls
    (mockStore.setStreamingForWorkspace as any).mockClear();

    (agentService as any).startStreamingSafetyTimeout(new Set(['active-agent']));

    vi.advanceTimersByTime(10_000);
    await vi.runAllTimersAsync();

    // Should NOT have cleared streaming for the active agent
    expect(mockStore.setStreamingForWorkspace).not.toHaveBeenCalledWith(
      'ws-1',
      'active-agent',
      false,
    );
  });
});
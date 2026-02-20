/**
 * Agent Stuck Reproduction Tests
 *
 * These tests reproduce and verify the "agent randomly stops responding" issue.
 * The root cause is that completion events from the backend can be missed when:
 * 1. The frontend handler is not registered (timing during navigation/HMR)
 * 2. The handler is removed before the event arrives (race in stopChat())
 * 3. CustomEvents are dispatched to window with no active listeners
 *
 * Key scenarios tested:
 * 1. Completion event arrives when no handler is registered
 * 2. Handler cleanup removes listener before completion event
 * 3. Session-updated event fallback mechanism
 * 4. Recovery via state reconciliation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock window.electronAPI
const mockElectronAPI = {
  on: vi.fn(),
  off: vi.fn(),
  removeAllListeners: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
};

// Track event listeners on window
const windowEventListeners = new Map<string, Set<EventListener>>();

// Mock window
const mockWindow = {
  electronAPI: mockElectronAPI,
  dispatchEvent: vi.fn((event: CustomEvent) => {
    const listeners = windowEventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
      return true;
    }
    // CRITICAL: Event is dropped if no listeners - this is the bug!
    return false;
  }),
  addEventListener: vi.fn((type: string, listener: EventListener) => {
    if (!windowEventListeners.has(type)) {
      windowEventListeners.set(type, new Set());
    }
    windowEventListeners.get(type)!.add(listener);
  }),
  removeEventListener: vi.fn((type: string, listener: EventListener) => {
    const listeners = windowEventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }),
};

// Mock dependencies
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
}));

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

describe('Agent Stuck Reproduction', () => {
  beforeEach(() => {
    (global as any).window = mockWindow;
    windowEventListeners.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (global as any).window;
  });

  describe('Missed Completion Event (Primary Bug)', () => {
    it('should demonstrate that completion events are dropped when no listener exists', () => {
      const agentId = 'agent-123';
      const streamChannel = `agent:stream:${agentId}`;

      // Simulate state: agent is streaming/processing
      const agentState = {
        isProcessing: true,
        isStreaming: true,
      };

      // NO handler is registered (simulating navigation/HMR cleared it)
      // This is the bug: events dispatched to window are silently dropped

      // Backend sends completion event via agent.service.ts which dispatches to window
      const completeEvent = new CustomEvent(streamChannel, {
        detail: { type: 'complete', message: { id: 'msg-1', contentBlocks: [] } },
      });

      const wasReceived = mockWindow.dispatchEvent(completeEvent);

      // VERIFY: Event was NOT received because no handler was registered
      expect(wasReceived).toBe(false);

      // VERIFY: Agent state is still stuck at isProcessing=true
      // In real code, this means the UI shows "agent is thinking" indefinitely
      expect(agentState.isProcessing).toBe(true);
      expect(agentState.isStreaming).toBe(true);
    });

    it('should receive completion event when handler IS registered', () => {
      const agentId = 'agent-456';
      const streamChannel = `agent:stream:${agentId}`;

      // Simulate state: agent is streaming/processing
      const agentState = {
        isProcessing: true,
        isStreaming: true,
      };

      // Register handler (normal case - ChatService.setupStreaming was called)
      const handler = (event: CustomEvent) => {
        if (event.detail.type === 'complete') {
          agentState.isProcessing = false;
          agentState.isStreaming = false;
        }
      };
      mockWindow.addEventListener(streamChannel, handler as EventListener);

      // Backend sends completion event
      const completeEvent = new CustomEvent(streamChannel, {
        detail: { type: 'complete', message: { id: 'msg-1', contentBlocks: [] } },
      });

      const wasReceived = mockWindow.dispatchEvent(completeEvent);

      // VERIFY: Event was received and state was updated
      expect(wasReceived).toBe(true);
      expect(agentState.isProcessing).toBe(false);
      expect(agentState.isStreaming).toBe(false);
    });
  });

  describe('Handler Removal Race Condition', () => {
    it('should demonstrate race condition when stopChat() removes handler before completion', async () => {
      const agentId = 'agent-789';
      const streamChannel = `agent:stream:${agentId}`;

      // Simulate state
      const agentState = {
        isProcessing: true,
        isStreaming: true,
      };

      // Track if handler was called
      let handlerCalled = false;

      // Handler is registered initially
      const handler = (event: CustomEvent) => {
        handlerCalled = true;
        if (event.detail.type === 'complete') {
          agentState.isProcessing = false;
          agentState.isStreaming = false;
        }
      };
      mockWindow.addEventListener(streamChannel, handler as EventListener);

      // Simulate stopChat() behavior: remove handler and wait
      // This is the race condition - completion can arrive during this window
      mockWindow.removeEventListener(streamChannel, handler as EventListener);

      // Simulate backend completion arriving during the 300ms cleanup window
      // (In real code, stopChat() waits 300ms after removing handler)
      const completeEvent = new CustomEvent(streamChannel, {
        detail: { type: 'complete', message: { id: 'msg-1', contentBlocks: [] } },
      });

      mockWindow.dispatchEvent(completeEvent);

      // VERIFY: Handler was NOT called - it was removed before event arrived
      expect(handlerCalled).toBe(false);

      // VERIFY: State is stuck - stopChat() expected the stream to complete gracefully
      // but the completion event was dropped because the handler was removed
      expect(agentState.isProcessing).toBe(true);
    });
  });

  describe('Session-Updated Fallback Mechanism', () => {
    it('should recover via session-updated event when stream event is missed', () => {
      const agentId = 'agent-fallback';
      const streamChannel = `agent:stream:${agentId}`;
      const sessionUpdatedChannel = `agent:session-updated:${agentId}`;

      // Simulate state
      const agentState = {
        isProcessing: true,
        isStreaming: true,
      };

      // Mock sessionStore that has updated session
      const mockSessionStore = {
        getSession: () => ({
          id: agentId,
          isStreaming: false, // Backend has marked it as complete
          messages: [],
        }),
      };

      // NO stream handler registered (simulating the bug)
      // But session-updated handler IS registered (fallback)
      const sessionUpdatedHandler = () => {
        const session = mockSessionStore.getSession();
        if (session && !session.isStreaming) {
          // This is the fallback recovery path
          agentState.isProcessing = false;
          agentState.isStreaming = false;
        }
      };
      mockWindow.addEventListener(sessionUpdatedChannel, sessionUpdatedHandler as EventListener);

      // Stream completion event is dropped (no handler)
      const completeEvent = new CustomEvent(streamChannel, {
        detail: { type: 'complete', message: { id: 'msg-1', contentBlocks: [] } },
      });
      mockWindow.dispatchEvent(completeEvent);

      // State is still stuck
      expect(agentState.isProcessing).toBe(true);

      // But the fallback session-updated event IS received
      const sessionUpdatedEvent = new CustomEvent(sessionUpdatedChannel);
      const fallbackReceived = mockWindow.dispatchEvent(sessionUpdatedEvent);

      // VERIFY: Fallback was received and recovered state
      expect(fallbackReceived).toBe(true);
      expect(agentState.isProcessing).toBe(false);
      expect(agentState.isStreaming).toBe(false);
    });
  });

  describe('Proposed Fix: Pending Event Queue', () => {
    it('should queue events when no handler is registered and replay on registration', () => {
      const agentId = 'agent-queue-fix';
      const streamChannel = `agent:stream:${agentId}`;

      // Simulate state
      const agentState = {
        isProcessing: true,
        isStreaming: true,
      };

      // PROPOSED FIX: A pending event queue
      const pendingEvents = new Map<string, CustomEvent[]>();

      // Enhanced dispatch that queues events when no handler exists
      const enhancedDispatch = (event: CustomEvent) => {
        const listeners = windowEventListeners.get(event.type);
        if (listeners && listeners.size > 0) {
          listeners.forEach((listener) => listener(event));
          return true;
        }
        // QUEUE the event instead of dropping it
        if (!pendingEvents.has(event.type)) {
          pendingEvents.set(event.type, []);
        }
        pendingEvents.get(event.type)!.push(event);
        return false;
      };

      // Enhanced addEventListener that replays pending events
      const enhancedAddEventListener = (type: string, listener: EventListener) => {
        if (!windowEventListeners.has(type)) {
          windowEventListeners.set(type, new Set());
        }
        windowEventListeners.get(type)!.add(listener);

        // REPLAY any pending events
        const pending = pendingEvents.get(type);
        if (pending && pending.length > 0) {
          pending.forEach((event) => listener(event));
          pendingEvents.delete(type);
        }
      };

      // Event arrives when no handler exists
      const completeEvent = new CustomEvent(streamChannel, {
        detail: { type: 'complete', message: { id: 'msg-1', contentBlocks: [] } },
      });
      enhancedDispatch(completeEvent);

      // State is still stuck (event was queued, not processed)
      expect(agentState.isProcessing).toBe(true);

      // Handler is registered later (e.g., after navigation completes)
      const handler = (event: CustomEvent) => {
        if (event.detail.type === 'complete') {
          agentState.isProcessing = false;
          agentState.isStreaming = false;
        }
      };
      enhancedAddEventListener(streamChannel, handler as EventListener);

      // VERIFY: State is now recovered because pending event was replayed
      expect(agentState.isProcessing).toBe(false);
      expect(agentState.isStreaming).toBe(false);
    });
  });

  describe('Proposed Fix: Periodic State Reconciliation', () => {
    it('should detect and recover from stuck state via periodic check', async () => {
      const agentId = 'agent-periodic-fix';

      // Simulate stuck state
      const agentState = {
        isProcessing: true,
        isStreaming: true,
        lastActivityTime: Date.now() - 60000, // 60 seconds ago
      };

      // Mock backend that reports no active streams
      const mockBackend = {
        getActiveStreams: async () => [] as string[],
      };

      // PROPOSED FIX: Periodic reconciliation function
      const reconcileState = async () => {
        if (!agentState.isProcessing) return;

        const activeStreams = await mockBackend.getActiveStreams();
        const hasActiveStream = activeStreams.includes(agentId);

        if (agentState.isProcessing && !hasActiveStream) {
          // State is inconsistent - recover
          const timeSinceActivity = Date.now() - agentState.lastActivityTime;
          if (timeSinceActivity > 30000) {
            // 30 second grace period
            agentState.isProcessing = false;
            agentState.isStreaming = false;
          }
        }
      };

      // Run reconciliation
      await reconcileState();

      // VERIFY: Stuck state was detected and recovered
      expect(agentState.isProcessing).toBe(false);
      expect(agentState.isStreaming).toBe(false);
    });
  });
});

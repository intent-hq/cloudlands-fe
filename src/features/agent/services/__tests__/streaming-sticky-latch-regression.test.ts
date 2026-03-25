/**
 * Regression Tests: Streaming OR-Latch Bug and sessionStore Streaming State
 *
 * Bug 1 (OR-latch): In chat.service.ts sessionUpdatedHandler (line ~2642), the state
 * update uses `newIsStreaming || s.isStreaming` which creates a sticky latch -- once
 * isStreaming/isProcessing become true, they can never transition back to false via
 * the sessionUpdatedHandler because `false || true === true`.
 *
 * Bug 2: When AgentService dispatches an 'end' event but no DOM handler is registered
 * (hasActiveStreamListener returns false), the event is queued but
 * sessionStore.setStreamingForWorkspace is never called with false, leaving the
 * sessionStore in a permanently streaming state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../agent.service', () => {
  const registeredDomHandlers = new Set<string>();
  const pendingEventQueue = new Map<string, Array<{ type: string; detail: any; timestamp: number }>>();

  return {
    agentService: {
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
      activateAgent: vi.fn(),
      getSession: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      registerDomHandler: vi.fn((sessionId: string) => {
        registeredDomHandlers.add(sessionId);
      }),
      unregisterDomHandler: vi.fn((sessionId: string) => {
        registeredDomHandlers.delete(sessionId);
      }),
      hasActiveStreamListener: vi.fn((sessionId: string) => {
        return registeredDomHandlers.has(sessionId);
      }),
      replayPendingEvents: vi.fn((sessionId: string) => {
        const queue = pendingEventQueue.get(sessionId);
        if (queue && queue.length > 0) {
          for (const event of queue) {
            window.dispatchEvent(
              new CustomEvent(`agent:stream:${sessionId}`, { detail: event.detail }),
            );
          }
          pendingEventQueue.delete(sessionId);
        }
      }),
      clearPendingEvents: vi.fn((sessionId: string) => {
        pendingEventQueue.delete(sessionId);
      }),
      // Expose internals for test assertions
      _registeredDomHandlers: registeredDomHandlers,
      _pendingEventQueue: pendingEventQueue,
      _queueEvent: (sessionId: string, type: string, detail: any) => {
        if (!pendingEventQueue.has(sessionId)) {
          pendingEventQueue.set(sessionId, []);
        }
        pendingEventQueue.get(sessionId)!.push({ type, detail, timestamp: Date.now() });
      },
    },
    AgentService: {
      getInstance: vi.fn(),
    },
  };
});

vi.mock('$features/agent/browser', () => ({
  sessionStore: {
    getSessionForWorkspace: vi.fn(),
    addSessionForWorkspace: vi.fn(),
    setActiveSessionForWorkspace: vi.fn(),
    updateMessagesForWorkspace: vi.fn(),
    addMessageForWorkspace: vi.fn(),
    setStreamingForWorkspace: vi.fn(),
    getStore: vi.fn(),
    getAllSessionsForWorkspace: vi.fn(() => []),
    getAllSessionsAcrossWorkspaces: vi.fn(() => []),
  },
  unifiedStateStore: {
    currentWorkspace: null,
    getWorkspace: vi.fn(),
    getAllWorkspaces: vi.fn(() => []),
    setAgent: vi.fn(),
    getAgent: vi.fn(),
  },
  notifyAgentSubscribers: vi.fn(),
}));

vi.mock('../../../shared/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../memory-manager', () => ({
  memoryManager: {
    registerTimer: vi.fn((callback: () => void) => {
      const id = setTimeout(callback, 1200000);
      return () => clearTimeout(id);
    }),
    registerListener: vi.fn((_target: EventTarget, _event: string, handler: EventListener) => {
      // Actually register the listener so events work
      if (_target === window && typeof _event === 'string') {
        window.addEventListener(_event, handler);
      }
      return () => {
        if (_target === window && typeof _event === 'string') {
          window.removeEventListener(_event, handler);
        }
      };
    }),
    registerSubscription: vi.fn(),
    cleanup: vi.fn(),
  },
}));

// Mock window.api for IPC
vi.stubGlobal('window', {
  ...globalThis.window,
  api: { on: vi.fn(), off: vi.fn() },
  addEventListener: globalThis.window?.addEventListener?.bind(globalThis.window) ?? vi.fn(),
  removeEventListener: globalThis.window?.removeEventListener?.bind(globalThis.window) ?? vi.fn(),
  dispatchEvent: globalThis.window?.dispatchEvent?.bind(globalThis.window) ?? vi.fn(),
  electronAPI: {
    on: vi.fn(),
    off: vi.fn(),
    invoke: vi.fn(),
    send: vi.fn(),
  },
});

import { ChatService } from '../chat.service';
import { agentService } from '../../agent.service';
import { sessionStore } from '$features/agent/browser';

// ── Helpers ────────────────────────────────────────────────────────────────

let chatService: ChatService;
let rafCallback: (() => void) | null = null;
let originalRaf: typeof requestAnimationFrame;

function makeSession(sessionId: string, overrides: Record<string, any> = {}) {
  return {
    id: sessionId,
    backendSessionId: sessionId,
    workspaceId: 'test-workspace',
    name: 'Test',
    status: 'active',
    messages: [],
    model: 'test',
    systemPrompt: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    isStreaming: false,
    ...overrides,
  } as any;
}

function makeMessage(id: string, role: string = 'assistant', text: string = 'hello') {
  return {
    id,
    role,
    contentBlocks: [{ type: 'text', text }],
    timestamp: new Date().toISOString(),
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('Streaming OR-Latch Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallback = () => cb(performance.now());
      return 1;
    }) as unknown as typeof requestAnimationFrame;

    chatService = new ChatService('test-agent');

    // Reset mock internals
    (agentService as any)._registeredDomHandlers.clear();
    (agentService as any)._pendingEventQueue.clear();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    rafCallback = null;
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Bug 1: OR-latch in sessionUpdatedHandler (chat.service.ts ~line 2642)
  //
  //   isStreaming: newIsStreaming || s.isStreaming  // BUG: once true, never goes false
  //   isProcessing: newIsStreaming || s.isProcessing  // BUG: same issue
  //
  // The || operator creates a sticky latch: once s.isStreaming is true,
  // the expression always evaluates to true regardless of newIsStreaming.
  // ═══════════════════════════════════════════════════════════════════════

  describe('Bug 1a: isStreaming should transition from true to false', () => {
    it('sessionUpdatedHandler should allow isStreaming to transition from true to false', () => {
      const sessionId = 'session-latch-1a';

      // Step 1: Set up session in the ChatService store
      chatService.getStore().update((s) => ({
        ...s,
        session: makeSession(sessionId),
        messages: [makeMessage('user-msg-1', 'user', 'Hello')],
        isStreaming: false,
        isProcessing: false,
      }));

      // Step 2: Mock sessionStore to return a non-streaming session initially
      // so setupStreaming doesn't dispatch a synthetic start event
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, { isStreaming: false, messages: [] }),
      );

      // Step 3: Call setupStreaming to register the sessionUpdatedHandler
      (chatService as any).setupStreaming(sessionId);

      // Step 4: Simulate the ChatService having entered streaming state
      // (e.g., from a sendMessage flow that set isStreaming=true)
      chatService.getStore().update((s) => ({
        ...s,
        isStreaming: true,
        isProcessing: true,
        messages: [
          makeMessage('user-msg-1', 'user', 'Hello'),
          makeMessage('assistant-msg-1', 'assistant', 'Streaming response...'),
        ],
      }));

      // Verify streaming state is active
      const stateDuring = get(chatService.getStore());
      expect(stateDuring.isStreaming).toBe(true);
      expect(stateDuring.isProcessing).toBe(true);

      // Step 5: Now the backend says streaming is done. Mock sessionStore
      // to return a session with isStreaming=false and finalized messages.
      const finalizedMessages = [
        makeMessage('user-msg-1', 'user', 'Hello'),
        makeMessage('assistant-msg-1', 'assistant', 'Complete response from backend'),
      ];
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, {
          isStreaming: false,
          messages: finalizedMessages,
        }),
      );

      // Step 6: Dispatch the session-updated event (triggers sessionUpdatedHandler)
      window.dispatchEvent(new CustomEvent(`agent:session-updated:${sessionId}`));

      // Step 7: Read state and assert
      const stateAfter = get(chatService.getStore());

      // REGRESSION: Fails because of OR-latch at line 2642:
      //   isStreaming: newIsStreaming || s.isStreaming = false || true = true
      // The isStreaming flag should be false because the session says streaming stopped.
      expect(stateAfter.isStreaming).toBe(false);
    });
  });

  describe('Bug 1b: isProcessing should clear when session says streaming stopped', () => {
    it('isProcessing should transition from true to false via sessionUpdatedHandler', () => {
      const sessionId = 'session-latch-1b';

      // Set up session in the ChatService store
      chatService.getStore().update((s) => ({
        ...s,
        session: makeSession(sessionId),
        messages: [makeMessage('user-msg-1', 'user', 'Hello')],
        isStreaming: false,
        isProcessing: false,
      }));

      // Mock sessionStore for setupStreaming
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, { isStreaming: false, messages: [] }),
      );

      // Register the sessionUpdatedHandler
      (chatService as any).setupStreaming(sessionId);

      // Simulate the ChatService being in streaming/processing state
      chatService.getStore().update((s) => ({
        ...s,
        isStreaming: true,
        isProcessing: true,
        messages: [
          makeMessage('user-msg-1', 'user', 'Hello'),
          makeMessage('assistant-msg-1', 'assistant', 'Streaming...'),
        ],
      }));

      // Backend signals streaming complete
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, {
          isStreaming: false,
          messages: [
            makeMessage('user-msg-1', 'user', 'Hello'),
            makeMessage('assistant-msg-1', 'assistant', 'Done'),
          ],
        }),
      );

      // Dispatch session-updated
      window.dispatchEvent(new CustomEvent(`agent:session-updated:${sessionId}`));

      const stateAfter = get(chatService.getStore());

      // REGRESSION: Fails because of OR-latch at line 2643:
      //   isProcessing: newIsStreaming || s.isProcessing = false || true = true
      // The isProcessing flag should be false because streaming has stopped.
      expect(stateAfter.isProcessing).toBe(false);
    });
  });

  describe('Bug 1c: messages should update when streaming ends with fewer messages', () => {
    it('messages should update when streaming ends via sessionUpdatedHandler even with fewer messages', () => {
      const sessionId = 'session-latch-1c';

      // Set up session with 3 streaming messages
      chatService.getStore().update((s) => ({
        ...s,
        session: makeSession(sessionId),
        messages: [
          makeMessage('user-msg-1', 'user', 'Hello'),
          makeMessage('assistant-msg-1', 'assistant', 'Partial streaming chunk 1'),
          makeMessage('assistant-msg-2', 'assistant', 'Partial streaming chunk 2'),
        ],
        isStreaming: true,
        isProcessing: true,
      }));

      // Mock sessionStore for setupStreaming
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, { isStreaming: false, messages: [] }),
      );

      // Register the sessionUpdatedHandler
      (chatService as any).setupStreaming(sessionId);

      // Backend finalizes with 2 messages (consolidated the assistant chunks)
      const finalizedMessages = [
        makeMessage('user-msg-1', 'user', 'Hello'),
        makeMessage('assistant-final', 'assistant', 'Complete consolidated response'),
      ];
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, {
          isStreaming: false,
          messages: finalizedMessages,
        }),
      );

      // Dispatch session-updated
      window.dispatchEvent(new CustomEvent(`agent:session-updated:${sessionId}`));

      const stateAfter = get(chatService.getStore());

      // REGRESSION: This fails because the OR-latch keeps isStreaming=true, and then
      // safeStateUpdate's monotonicity guard (line ~237) sees that both s.isStreaming
      // and next.isStreaming are true, so it blocks the message count reduction.
      //
      // The chain of failure:
      //   1. OR-latch: isStreaming = false || true = true (stuck)
      //   2. safeStateUpdate guard: s.isStreaming=true && next.isStreaming=true -> enforce guards
      //   3. Guard: next.messages.length (2) < s.messages.length (3) -> reject, keep old messages
      //
      // Expected: messages should be updated to the backend's finalized 2-message list.
      expect(stateAfter.messages).toHaveLength(2);
      expect(stateAfter.messages[1].id).toBe('assistant-final');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Bug 2: sessionStore.setStreamingForWorkspace never called with false
  //         when no DOM handler exists for the 'end' event
  //
  // In AgentService.dispatchStreamEvent, when hasActiveStreamListener
  // returns false, the 'end' event is queued for later replay. However,
  // sessionStore.setStreamingForWorkspace(wsId, agentId, false) is called
  // BEFORE dispatchStreamEvent in the complete handler. The issue is that
  // when a ChatService never mounts (no DOM handler), the queued 'end'
  // event is never replayed, and the ChatService's internal isStreaming
  // stays true forever.
  //
  // This test verifies the interaction at the ChatService level:
  // when the sessionUpdatedHandler fires but the 'end' stream event was
  // queued (never delivered), the OR-latch prevents clearing.
  // ═══════════════════════════════════════════════════════════════════════

  describe('Bug 2a: sessionStore streaming state should be cleared when end event has no DOM handler', () => {
    it('sessionUpdatedHandler should clear streaming state even when end event was queued (not delivered)', () => {
      const sessionId = 'session-nodom-2a';

      // Set up session in ChatService store in streaming state
      chatService.getStore().update((s) => ({
        ...s,
        session: makeSession(sessionId, { workspaceId: 'test-workspace' }),
        messages: [
          makeMessage('user-msg-1', 'user', 'Hello'),
          makeMessage('assistant-msg-1', 'assistant', 'Streaming...'),
        ],
        isStreaming: true,
        isProcessing: true,
      }));

      // Mock sessionStore for setupStreaming
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, { isStreaming: false, messages: [] }),
      );

      // Register the sessionUpdatedHandler but then unregister the DOM handler
      // to simulate a panel that was unmounted
      (chatService as any).setupStreaming(sessionId);
      // The setupStreaming call would have registered a DOM handler.
      // Simulate unmount by unregistering it.
      agentService.unregisterDomHandler(sessionId);

      // Verify no DOM handler is registered
      expect(agentService.hasActiveStreamListener(sessionId)).toBe(false);

      // Queue an 'end' event as AgentService would when no DOM handler exists
      (agentService as any)._queueEvent(sessionId, 'end', { type: 'end', message: null });

      // The backend has already called sessionStore.setStreamingForWorkspace(wsId, agentId, false)
      // and then dispatches session-updated. Mock sessionStore to return the final state.
      const finalMessages = [
        makeMessage('user-msg-1', 'user', 'Hello'),
        makeMessage('assistant-msg-1', 'assistant', 'Complete response'),
      ];
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, {
          isStreaming: false,
          messages: finalMessages,
        }),
      );

      // Dispatch session-updated (this is the fallback that AgentService always fires)
      window.dispatchEvent(new CustomEvent(`agent:session-updated:${sessionId}`));

      const stateAfter = get(chatService.getStore());

      // REGRESSION: Due to the OR-latch, isStreaming stays true even though the
      // session says streaming is done and the 'end' event is sitting in the queue.
      // The sessionUpdatedHandler is the ONLY path to clear streaming state in this
      // scenario (since the 'end' event was queued, not delivered).
      expect(stateAfter.isStreaming).toBe(false);
      expect(stateAfter.isProcessing).toBe(false);

      // Also verify that sessionStore.setStreamingForWorkspace would need to be
      // called by the ChatService to propagate the cleared state. Since the OR-latch
      // prevents clearing, any downstream code that checks ChatService state will
      // think streaming is still active.
    });

    it('queued end events should not prevent sessionUpdatedHandler from clearing streaming state', () => {
      const sessionId = 'session-nodom-2b';

      // Set up ChatService in streaming state
      chatService.getStore().update((s) => ({
        ...s,
        session: makeSession(sessionId, { workspaceId: 'test-workspace' }),
        messages: [
          makeMessage('user-msg-1', 'user', 'Test message'),
        ],
        isStreaming: true,
        isProcessing: true,
      }));

      // Set up sessionUpdatedHandler via setupStreaming
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, { isStreaming: false, messages: [] }),
      );
      (chatService as any).setupStreaming(sessionId);

      // Simulate: AgentService processes 'complete' event, calls
      // sessionStore.setStreamingForWorkspace(wsId, agentId, false),
      // then tries to dispatch 'end' event but no DOM handler exists.
      // The end event gets queued instead of delivered.
      agentService.unregisterDomHandler(sessionId);
      (agentService as any)._queueEvent(sessionId, 'end', { type: 'end', message: null });

      // The session-updated event fires as a fallback
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
        makeSession(sessionId, {
          isStreaming: false,
          messages: [makeMessage('user-msg-1', 'user', 'Test message')],
        }),
      );

      window.dispatchEvent(new CustomEvent(`agent:session-updated:${sessionId}`));

      const stateAfter = get(chatService.getStore());

      // REGRESSION: The OR-latch blocks the transition. The sessionUpdatedHandler
      // is the last resort for clearing streaming state when the 'end' event was
      // never delivered, but `false || true === true` keeps it stuck.
      expect(stateAfter.isStreaming).toBe(false);
      expect(stateAfter.isProcessing).toBe(false);
    });
  });
});

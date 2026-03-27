/**
 * Regression test: user message lost during concurrent agent restoration
 *
 * Bug scenario:
 * 1. ChatService has an active session with messages [user1, assistant1]
 * 2. User sends a follow-up message via chatService.sendMessage()
 * 3. The backend processes and adds the user message; sessionUpdatedHandler syncs it
 * 4. CONCURRENTLY, a workspace:updated event causes restoreSessionWithoutBackend
 *    for a DIFFERENT agent, which calls sessionStore.addSessionForWorkspace with
 *    stale session data for the CURRENT agent
 * 5. The stale data triggers sessionUpdatedHandler with fewer messages (no user followup)
 * 6. BUG: safeStateUpdate bypasses monotonicity guards because isStreaming transitions
 *    from true→false, and the non-streaming guard at line ~2648 doesn't fire because
 *    currentState.isStreaming is true
 * 7. The user's follow-up message is lost from ChatService state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock dependencies before importing ChatService (same pattern as chat-force-send-missing-message.test.ts)
vi.mock('../../agent.service', () => ({
  agentService: {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
    activateAgent: vi.fn(),
    getSession: vi.fn(),
    saveSession: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
    unregisterDomHandler: vi.fn(),
    registerDomHandler: vi.fn(),
    replayPendingEvents: vi.fn(),
    clearPendingEvents: vi.fn(),
    restoreSession: vi.fn(),
  },
  AgentService: {
    getInstance: vi.fn(() => ({
      sendMessage: vi.fn(),
      activateAgent: vi.fn(),
      getSession: vi.fn(),
    })),
  },
}));

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

// Capture session-updated handlers registered via memoryManager.registerListener
const capturedSessionUpdatedHandlers = new Map<string, (event: any) => void>();

vi.mock('../memory-manager', () => ({
  memoryManager: {
    registerTimer: vi.fn(() => vi.fn()),
    registerListener: vi.fn((_target: any, eventName: string, handler: (...args: any[]) => void) => {
      if (typeof eventName === 'string' && eventName.startsWith('agent:session-updated:')) {
        const sessionId = eventName.replace('agent:session-updated:', '');
        capturedSessionUpdatedHandlers.set(sessionId, handler);
      }
      const cleanup = vi.fn(() => {
        if (typeof eventName === 'string' && eventName.startsWith('agent:session-updated:')) {
          const sessionId = eventName.replace('agent:session-updated:', '');
          capturedSessionUpdatedHandlers.delete(sessionId);
        }
      });
      return cleanup;
    }),
    registerSubscription: vi.fn(),
    cleanup: vi.fn(),
  },
}));

// Mock window.api for IPC
const originalWindow = globalThis.window;
vi.stubGlobal('window', {
  ...originalWindow,
  api: { on: vi.fn(), off: vi.fn() },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

import { ChatService } from '../chat.service';
import { sessionStore } from '$features/agent/browser';

// Shared test fixtures
const SESSION_ID = 'test-session';
const WORKSPACE_ID = 'test-workspace';

const msg1_user = {
  id: 'msg-1-user',
  role: 'user' as const,
  contentBlocks: [{ type: 'text' as const, text: 'Hello' }],
  timestamp: new Date().toISOString(),
};

const msg2_assistant = {
  id: 'msg-2-assistant',
  role: 'assistant' as const,
  contentBlocks: [{ type: 'text' as const, text: 'Hi there!' }],
  timestamp: new Date().toISOString(),
};

const msg3_user_followup = {
  id: 'msg-3-user-followup',
  role: 'user' as const,
  contentBlocks: [{ type: 'text' as const, text: 'follow-up question' }],
  timestamp: new Date().toISOString(),
};

function makeSessionData(messages: any[], isStreaming = false) {
  return {
    id: SESSION_ID,
    backendSessionId: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Test',
    status: 'active',
    isStreaming,
    messages,
  } as any;
}

describe('Concurrent restore message loss regression', () => {
  let chatService: ChatService;
  let rafCallback: (() => void) | null = null;
  let originalRaf: typeof requestAnimationFrame;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSessionUpdatedHandlers.clear();

    originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallback = () => cb(performance.now());
      return 1;
    }) as unknown as typeof requestAnimationFrame;

    chatService = new ChatService('test-agent');
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    rafCallback = null;
  });

  afterAll(() => {
    vi.stubGlobal('window', originalWindow);
  });

  function setupSessionWithMessages() {
    const store = chatService.getStore();
    store.update((s) => ({
      ...s,
      session: {
        id: SESSION_ID,
        backendSessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        name: 'Test',
        status: 'active',
        messages: [msg1_user, msg2_assistant],
        model: 'test',
        systemPrompt: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      } as any,
      messages: [msg1_user, msg2_assistant],
    }));
    // Pre-register stream handler so sendMessage doesn't fail
    (chatService as any).streamHandlers.set(SESSION_ID, () => {});
  }

  /**
   * REGRESSION TEST: Proves user message is lost during concurrent restoration.
   *
   * Timeline:
   * T0: ChatService has [user1, assistant1], isStreaming=false
   * T1: sendMessage('follow-up') → isStreaming=true, messages unchanged
   * T2: Backend processes, sessionUpdatedHandler syncs [user1, assistant1, user_followup]
   * T3: CONCURRENT: stale restoreSessionWithoutBackend fires sessionUpdatedHandler
   *     with stale data [user1, assistant1], isStreaming=false
   * T4: BUG — safeStateUpdate sees isStreaming true→false transition,
   *     bypasses monotonicity guard, overwrites with 2 messages.
   *     The user's follow-up message is LOST.
   *
   * This test asserts the DESIRED behavior (message preserved) so it FAILS now,
   * proving the bug exists.
   */
  it('should preserve user message when stale sessionUpdatedHandler fires during streaming', async () => {
    // T0: Set up session with existing conversation
    setupSessionWithMessages();

    const workspace = { id: WORKSPACE_ID, name: 'Test Workspace', path: '/test' } as any;

    // T1: User sends follow-up → sets isStreaming: true
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
      makeSessionData([msg1_user, msg2_assistant], false),
    );
    await chatService.sendMessage('follow-up question', workspace);

    // Verify isStreaming is now true
    const stateAfterSend = get(chatService.getStore());
    expect(stateAfterSend.isStreaming).toBe(true);
    expect(capturedSessionUpdatedHandlers.has(SESSION_ID)).toBe(true);

    // T2: Simulate backend adding user message and dispatching session-updated.
    // sessionStore returns fresh data WITH the user's follow-up message.
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
      makeSessionData([msg1_user, msg2_assistant, msg3_user_followup], true),
    );
    const handler = capturedSessionUpdatedHandlers.get(SESSION_ID)!;
    handler({});

    // Verify user message was synced into ChatService state
    const stateAfterSync = get(chatService.getStore());
    expect(stateAfterSync.messages).toHaveLength(3);
    expect(stateAfterSync.messages[2].id).toBe('msg-3-user-followup');

    // T3: CONCURRENT — stale restore fires sessionUpdatedHandler with OLD data.
    // The stale data has only the original 2 messages and isStreaming: false.
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
      makeSessionData([msg1_user, msg2_assistant], false),
    );
    handler({});

    // T4: Assert DESIRED behavior — user message should be preserved.
    // BUG: This assertion FAILS because safeStateUpdate bypasses the monotonicity
    // guard when isStreaming transitions true→false, allowing the stale 2-message
    // payload to overwrite the 3-message state.
    const finalState = get(chatService.getStore());
    expect(finalState.messages).toHaveLength(3); // FAILS: actually 2 (bug!)
    expect(
      finalState.messages.find((m) => m.id === 'msg-3-user-followup'),
    ).toBeDefined(); // FAILS: message lost
  });

  /**
   * Same scenario but the stale data also claims isStreaming: true.
   * This tests the streaming→streaming guard path in safeStateUpdate.
   *
   * safeStateUpdate line ~337: "if (!s.isStreaming || !next.isStreaming) return next"
   * When both are true, it DOES check monotonicity (message count guard).
   * So this variant should be protected by the existing guard — but let's verify.
   */
  it('should preserve user message when stale handler fires with isStreaming: true', async () => {
    setupSessionWithMessages();
    const workspace = { id: WORKSPACE_ID, name: 'Test Workspace', path: '/test' } as any;

    // Send message → isStreaming: true
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
      makeSessionData([msg1_user, msg2_assistant], false),
    );
    await chatService.sendMessage('follow-up question', workspace);

    // Sync user message via sessionUpdatedHandler
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
      makeSessionData([msg1_user, msg2_assistant, msg3_user_followup], true),
    );
    const handler = capturedSessionUpdatedHandlers.get(SESSION_ID)!;
    handler({});

    expect(get(chatService.getStore()).messages).toHaveLength(3);

    // Stale handler fires with isStreaming: true but only 2 messages.
    // safeStateUpdate SHOULD block this since both sides are streaming
    // and message count would decrease.
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(
      makeSessionData([msg1_user, msg2_assistant], true),
    );
    handler({});

    const finalState = get(chatService.getStore());
    // When both old and new are streaming, safeStateUpdate's monotonicity
    // guard (line ~340) prevents message count regression. This should pass.
    expect(finalState.messages).toHaveLength(3);
    expect(
      finalState.messages.find((m) => m.id === 'msg-3-user-followup'),
    ).toBeDefined();
  });
});


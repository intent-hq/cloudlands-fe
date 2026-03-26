/**
 * Regression test for missing user message after force-send ("Send now")
 *
 * Bug scenario:
 * 1. Agent is actively streaming a response
 * 2. User has a message queued
 * 3. User clicks "Send now" on the queued message
 * 4. stopChat() is called to interrupt the current stream
 * 5. sendMessage() is called with the queued message
 * 6. BUG: The user's interrupt message does not appear in the conversation messages
 *
 * The normal flow relies on an event chain:
 *   agentService.sendMessage → addMessageForWorkspace → agent:session-updated event
 *   → sessionUpdatedHandler → state update
 * When stopChat() is called right before sendMessage(), the stream handler cleanup
 * can interfere with the event chain, causing the user message to be lost.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock dependencies before importing ChatService
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
// so tests can simulate the agent:session-updated event dispatch
const capturedSessionUpdatedHandlers = new Map<string, (event: any) => void>();

vi.mock('../memory-manager', () => ({
  memoryManager: {
    registerTimer: vi.fn(() => {
      return vi.fn();
    }),
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

// Mock window.api for IPC — save original so we can restore in afterEach
const originalWindow = globalThis.window;
vi.stubGlobal('window', {
  ...originalWindow,
  api: {
    on: vi.fn(),
    off: vi.fn(),
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

import { ChatService } from '../chat.service';
import { sessionStore } from '$features/agent/browser';

describe('Force-send queued message: missing user message regression', () => {
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

  function simulateStreamEvent(
    sessionId: string,
    data: { type: string; content?: string; data?: any; error?: string; message?: any },
  ) {
    (chatService as any).handleStreamEvent(sessionId, data);
  }

  function setupSession(sessionId: string) {
    const store = chatService.getStore();
    store.update((s) => ({
      ...s,
      session: {
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
      } as any,
      messages: [],
    }));
    (chatService as any).streamHandlers.set(sessionId, () => {});
  }

  /**
   * This test reproduces the exact flow from ChatPanel.svelte handleSendQueuedMessageNow:
   * 1. Agent is streaming → stopChat() → wait for isInterrupting to clear → sendMessage()
   *
   * After the fix, the sessionUpdatedHandler (re-registered by setupStreaming in sendMessage)
   * is the mechanism that syncs the user message into ChatService state when the backend
   * dispatches the agent:session-updated event.
   */
  it('should include the user interrupt message in conversation after force-send', async () => {
    const sessionId = 'test-session';
    setupSession(sessionId);

    // Step 1: Start streaming (agent is actively responding)
    simulateStreamEvent(sessionId, { type: 'start' });
    simulateStreamEvent(sessionId, { type: 'chunk', content: 'I am thinking about' });
    simulateStreamEvent(sessionId, { type: 'chunk', content: ' your question...' });

    // Flush RAF to ensure streaming content is in the store
    if (rafCallback) rafCallback();
    rafCallback = null;

    // Verify streaming is active
    const stateBeforeStop = get(chatService.getStore());
    expect(stateBeforeStop.isStreaming).toBe(true);
    expect((chatService as any).localStreamingContent).toBe('I am thinking about your question...');

    // Step 2: Stop the current stream (simulating handleSendQueuedMessageNow)
    // Mock sessionStore for stopChat flow
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      name: 'Test',
      status: 'active',
      isStreaming: false, // After stop, streaming is false
      messages: stateBeforeStop.messages,
    } as any);

    await chatService.stopChat();

    // Verify streaming is stopped
    const stateAfterStop = get(chatService.getStore());
    expect(stateAfterStop.isStreaming).toBe(false);
    expect(stateAfterStop.isProcessing).toBe(false);
    expect(stateAfterStop.isInterrupting).toBe(false);

    // Record the messages after stop — should have the partial assistant response
    const messagesAfterStop = stateAfterStop.messages;

    // Step 3: Send the queued message (simulating the force-send)
    // sessionStore doesn't have the user message yet (race condition — backend hasn't updated)
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      name: 'Test',
      status: 'active',
      isStreaming: false,
      messages: [...messagesAfterStop],
    } as any);

    const workspace = {
      id: 'test-workspace',
      name: 'Test Workspace',
      path: '/test',
    } as any;

    await chatService.sendMessage('queued user message', workspace);

    // Step 4: Verify the sessionUpdatedHandler was re-registered by setupStreaming
    expect(capturedSessionUpdatedHandlers.has(sessionId)).toBe(true);

    // Step 5: Simulate the backend dispatching agent:session-updated with the user message
    const userMessageFromBackend = {
      id: 'msg_user_interrupt',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'queued user message' }],
      timestamp: new Date().toISOString(),
    };

    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      name: 'Test',
      status: 'active',
      isStreaming: false,
      messages: [...messagesAfterStop, userMessageFromBackend],
    } as any);

    const handler = capturedSessionUpdatedHandlers.get(sessionId);
    handler!({});

    // Step 6: Simulate backend starting to respond to the new message
    if (!(chatService as any).streamHandlers.has(sessionId)) {
      (chatService as any).streamHandlers.set(sessionId, () => {});
    }

    simulateStreamEvent(sessionId, { type: 'start' });
    simulateStreamEvent(sessionId, { type: 'chunk', content: 'Here is my new response' });

    // Flush RAF
    if (rafCallback) rafCallback();
    rafCallback = null;

    simulateStreamEvent(sessionId, {
      type: 'end',
      message: {
        id: 'msg_assistant_new',
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Here is my new response' }],
      },
    });

    // Step 7: Assert the conversation contains all expected messages
    const finalState = get(chatService.getStore());
    const messages = finalState.messages;

    // Find the user's interrupt message
    const userInterruptMessage = messages.find(
      (m) =>
        m.role === 'user' &&
        m.contentBlocks?.some(
          (b: any) => b.type === 'text' && b.text === 'queued user message',
        ),
    );

    expect(userInterruptMessage).toBeDefined();

    // Also verify the conversation ordering makes sense:
    // There should be at least a user message followed by an assistant response
    const userMsgIndex = messages.findIndex((m) => m === userInterruptMessage);
    const newAssistantMsg = messages.find((m) => m.id === 'msg_assistant_new');

    if (userInterruptMessage && newAssistantMsg) {
      const assistantMsgIndex = messages.findIndex((m) => m === newAssistantMsg);
      expect(userMsgIndex).toBeLessThan(assistantMsgIndex);
    }
  });

  /**
   * After the fix, sendMessage() re-registers the sessionUpdatedHandler (via setupStreaming)
   * when it detects the handler was removed by stopChat(). This means the normal event chain
   * (agent:session-updated) is restored, and the user message syncs into state when the
   * backend dispatches the event — even if the safety-net sync fails due to a race condition.
   */
  it('should include the user message after sessionUpdatedHandler is re-registered (safety-net race condition fixed)', async () => {
    const sessionId = 'test-session';
    setupSession(sessionId);

    // Step 1: Start streaming (agent is actively responding)
    simulateStreamEvent(sessionId, { type: 'start' });
    simulateStreamEvent(sessionId, { type: 'chunk', content: 'I am thinking about' });
    simulateStreamEvent(sessionId, { type: 'chunk', content: ' your question...' });

    if (rafCallback) rafCallback();
    rafCallback = null;

    const stateBeforeStop = get(chatService.getStore());
    expect(stateBeforeStop.isStreaming).toBe(true);

    // Step 2: Stop the current stream
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      name: 'Test',
      status: 'active',
      isStreaming: false,
      messages: stateBeforeStop.messages,
    } as any);

    await chatService.stopChat();

    const stateAfterStop = get(chatService.getStore());
    expect(stateAfterStop.isStreaming).toBe(false);
    expect(stateAfterStop.isInterrupting).toBe(false);

    const messagesAfterStop = stateAfterStop.messages;

    // Step 3: Send the queued message. The safety-net won't find the message
    // in sessionStore (race condition), but the fix ensures setupStreaming()
    // re-registers the sessionUpdatedHandler.
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      name: 'Test',
      status: 'active',
      isStreaming: false,
      messages: [...messagesAfterStop],
    } as any);

    const workspace = {
      id: 'test-workspace',
      name: 'Test Workspace',
      path: '/test',
    } as any;

    await chatService.sendMessage('queued user message', workspace);

    // Step 4: Verify the sessionUpdatedHandler was re-registered by the fix
    expect(capturedSessionUpdatedHandlers.has(sessionId)).toBe(true);

    // Step 5: Simulate the backend dispatching agent:session-updated with the user message
    const userMessageFromBackend = {
      id: 'msg_user_interrupt',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'queued user message' }],
      timestamp: new Date().toISOString(),
    };

    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      name: 'Test',
      status: 'active',
      isStreaming: false,
      messages: [...messagesAfterStop, userMessageFromBackend],
    } as any);

    const handler = capturedSessionUpdatedHandlers.get(sessionId);
    handler!({});

    // Step 6: The user message should now be present in the conversation
    const finalState = get(chatService.getStore());
    const userInterruptMessage = finalState.messages.find(
      (m) =>
        m.role === 'user' &&
        m.contentBlocks?.some(
          (b: any) => b.type === 'text' && b.text === 'queued user message',
        ),
    );

    expect(userInterruptMessage).toBeDefined();
  });

  /**
   * Same scenario but sessionStore.getSessionForWorkspace returns undefined entirely.
   * After the fix, the sessionUpdatedHandler is re-registered, so when the backend
   * eventually dispatches the event, the user message syncs into state.
   */
  it('should include the user message after sessionUpdatedHandler is re-registered (sessionStore undefined fixed)', async () => {
    const sessionId = 'test-session';
    setupSession(sessionId);

    // Start streaming
    simulateStreamEvent(sessionId, { type: 'start' });
    simulateStreamEvent(sessionId, { type: 'chunk', content: 'Working on it...' });

    if (rafCallback) rafCallback();
    rafCallback = null;

    const stateBeforeStop = get(chatService.getStore());
    expect(stateBeforeStop.isStreaming).toBe(true);

    // Stop streaming — mock returns a valid session for stopChat
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      name: 'Test',
      status: 'active',
      isStreaming: false,
      messages: stateBeforeStop.messages,
    } as any);

    await chatService.stopChat();

    const stateAfterStop = get(chatService.getStore());
    expect(stateAfterStop.isStreaming).toBe(false);

    const messagesAfterStop = stateAfterStop.messages;

    // Mock sessionStore to return undefined during sendMessage — simulating workspace mismatch
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(undefined as any);

    const workspace = {
      id: 'test-workspace',
      name: 'Test Workspace',
      path: '/test',
    } as any;

    await chatService.sendMessage('important user message', workspace);

    // Verify the sessionUpdatedHandler was re-registered by the fix
    expect(capturedSessionUpdatedHandlers.has(sessionId)).toBe(true);

    // Simulate the backend dispatching agent:session-updated with the user message
    const userMessageFromBackend = {
      id: 'msg_user_important',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'important user message' }],
      timestamp: new Date().toISOString(),
    };

    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      name: 'Test',
      status: 'active',
      isStreaming: false,
      messages: [...messagesAfterStop, userMessageFromBackend],
    } as any);

    const handler = capturedSessionUpdatedHandlers.get(sessionId);
    handler!({});

    // The user message should now be present in the conversation
    const finalState = get(chatService.getStore());
    const userMessage = finalState.messages.find(
      (m) =>
        m.role === 'user' &&
        m.contentBlocks?.some(
          (b: any) => b.type === 'text' && b.text === 'important user message',
        ),
    );

    expect(userMessage).toBeDefined();
  });

  it('should preserve the stopped assistant partial response', async () => {
    const sessionId = 'test-session';
    setupSession(sessionId);

    // Start streaming with some content
    simulateStreamEvent(sessionId, { type: 'start' });
    simulateStreamEvent(sessionId, { type: 'chunk', content: 'Partial response content' });

    if (rafCallback) rafCallback();
    rafCallback = null;

    // Verify the partial response exists in messages
    const stateBeforeStop = get(chatService.getStore());
    const streamingMsg = stateBeforeStop.messages.find((m) => m.role === 'assistant');
    expect(streamingMsg).toBeDefined();

    // Stop the stream
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      id: sessionId,
      backendSessionId: sessionId,
      workspaceId: 'test-workspace',
      status: 'active',
      isStreaming: false,
      messages: stateBeforeStop.messages,
    } as any);

    await chatService.stopChat();

    // After stop, the messages should still contain the partial assistant response
    const stateAfterStop = get(chatService.getStore());
    const partialAssistant = stateAfterStop.messages.find((m) => m.role === 'assistant');
    expect(partialAssistant).toBeDefined();
    expect(
      partialAssistant?.contentBlocks?.some(
        (b: any) => b.type === 'text' && b.text?.includes('Partial response content'),
      ),
    ).toBe(true);
  });
});


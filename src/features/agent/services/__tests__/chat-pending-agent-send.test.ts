/**
 * Regression tests for pending-agent first-send flow.
 *
 * Verifies that when a user sends the first message to a pending agent:
 * 1. The optimistic user message is added to local state BEFORE activateAgent runs
 * 2. sessionStore.addMessageForWorkspace is called BEFORE activateAgent
 * 3. If activation fails, the user message remains visible in state
 *
 * These tests would FAIL on the old behavior where the user message was added
 * after activation, causing the first message to be lost.
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
    registerDomHandler: vi.fn(),
    replayPendingEvents: vi.fn(),
  },
  AgentService: {
    getInstance: vi.fn(() => ({
      sendMessage: vi.fn(),
      activateAgent: vi.fn(),
      getSession: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      registerDomHandler: vi.fn(),
      replayPendingEvents: vi.fn(),
    })),
  },
}));

vi.mock('$features/agent/browser', () => ({
  sessionStore: {
    getSession: vi.fn(),
    getSessionForWorkspace: vi.fn(),
    addSession: vi.fn(),
    addSessionForWorkspace: vi.fn(),
    setActiveSession: vi.fn(),
    updateMessages: vi.fn(),
    updateMessagesForWorkspace: vi.fn(),
    addMessage: vi.fn(),
    addMessageForWorkspace: vi.fn(),
    setStreaming: vi.fn(),
    setStreamingForWorkspace: vi.fn(),
    getStore: vi.fn(),
    getAllSessions: vi.fn(() => []),
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
    registerListener: vi.fn(() => vi.fn()),
    registerSubscription: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.stubGlobal('window', {
  api: { on: vi.fn(), off: vi.fn() },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

import { ChatService } from '../chat.service';
import { sessionStore } from '$features/agent/browser';
import { agentService } from '../../agent.service';

describe('Pending-agent first-send regression', () => {
  let chatService: ChatService;

  const mockWorkspace = {
    id: 'ws-pending-test',
    name: 'Test Workspace',
    path: '/test/workspace',
    worktreePath: '/test/workspace',
    repositoryPath: '/test/workspace',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date(),
    metadata: {},
  } as any;

  function makePendingSession(agentId: string) {
    return {
      id: agentId,
      backendSessionId: null, // pending — no backend session yet
      workspaceId: mockWorkspace.id,
      name: 'Pending Agent',
      status: 'pending',
      messages: [],
      model: 'claude-3-5-sonnet-latest',
      systemPrompt: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      isStreaming: false,
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    chatService = new ChatService('pending-agent-test');
  });


  it('user message is in local state BEFORE activateAgent is called', async () => {
    const agentId = 'pending-ordering';
    const pending = makePendingSession(agentId);
    const activated = { ...pending, backendSessionId: 'backend-1', status: 'active' };

    vi.mocked(sessionStore.getSession).mockReturnValue(pending);

    // Capture local state at the moment activateAgent runs
    let messagesAtActivation: any[] | null = null;
    vi.mocked(agentService.activateAgent).mockImplementation(async () => {
      messagesAtActivation = chatService.getState().messages.slice();
      return activated;
    });

    // Load session then send first message
    chatService['state'].update((s) => ({ ...s, session: pending }));
    await chatService.sendMessage('Hello pending agent', mockWorkspace);

    // The user message MUST already be in local state when activateAgent fires
    expect(messagesAtActivation).not.toBeNull();
    expect(messagesAtActivation!.length).toBeGreaterThanOrEqual(1);
    const userMsg = messagesAtActivation!.find(
      (m: any) =>
        m.role === 'user' &&
        m.contentBlocks?.some((b: any) => b.text === 'Hello pending agent'),
    );
    expect(userMsg).toBeDefined();
  });

  it('sessionStore.addMessageForWorkspace is called BEFORE activateAgent', async () => {
    const agentId = 'pending-order-check';
    const pending = makePendingSession(agentId);
    const activated = { ...pending, backendSessionId: 'backend-2', status: 'active' };

    vi.mocked(sessionStore.getSession).mockReturnValue(pending);

    const callOrder: string[] = [];
    vi.mocked(sessionStore.addMessageForWorkspace).mockImplementation((..._args: any[]) => {
      callOrder.push('addMessageForWorkspace');
    });
    vi.mocked(agentService.activateAgent).mockImplementation(async () => {
      callOrder.push('activateAgent');
      return activated;
    });

    chatService['state'].update((s) => ({ ...s, session: pending }));
    await chatService.sendMessage('Order test', mockWorkspace);

    const addIdx = callOrder.indexOf('addMessageForWorkspace');
    const activateIdx = callOrder.indexOf('activateAgent');
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(activateIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeLessThan(activateIdx);
  });

  it('user message remains visible when activation fails', async () => {
    const agentId = 'pending-fail';
    const pending = makePendingSession(agentId);

    vi.mocked(sessionStore.getSession).mockReturnValue(pending);
    vi.mocked(agentService.activateAgent).mockRejectedValue(
      new Error('Activation failed'),
    );

    chatService['state'].update((s) => ({ ...s, session: pending }));

    await expect(
      chatService.sendMessage('My important message', mockWorkspace),
    ).rejects.toThrow('Activation failed');

    // User message must still be in local state
    const state = chatService.getState();
    const userMsg = state.messages.find(
      (m) =>
        m.role === 'user' &&
        m.contentBlocks?.some((b: any) => b.text === 'My important message'),
    );
    expect(userMsg).toBeDefined();

    // Error state should be set, processing should be off
    expect(state.error).toBeTruthy();
    expect(state.isProcessing).toBe(false);
  });

  it('activation receives the correct agentId and workspaceId', async () => {
    const agentId = 'pending-args';
    const pending = makePendingSession(agentId);
    const activated = { ...pending, backendSessionId: 'backend-3', status: 'active' };

    vi.mocked(sessionStore.getSession).mockReturnValue(pending);
    vi.mocked(agentService.activateAgent).mockResolvedValue(activated);

    chatService['state'].update((s) => ({ ...s, session: pending }));
    await chatService.sendMessage('Check args', mockWorkspace);

    expect(agentService.activateAgent).toHaveBeenCalledTimes(1);
    expect(agentService.activateAgent).toHaveBeenCalledWith(agentId, mockWorkspace.id);
  });

  it('does NOT activate an already-active agent', async () => {
    const agentId = 'active-agent';
    const activeSession = {
      ...makePendingSession(agentId),
      backendSessionId: 'existing-backend',
      status: 'active',
    };

    vi.mocked(sessionStore.getSession).mockReturnValue(activeSession);

    chatService['state'].update((s) => ({ ...s, session: activeSession }));
    await chatService.sendMessage('No activation needed', mockWorkspace);

    expect(agentService.activateAgent).not.toHaveBeenCalled();
    expect(agentService.sendMessage).toHaveBeenCalled();
  });

  it('retryLastMessage does NOT create duplicate user messages after activation failure', async () => {
    const agentId = 'pending-retry-dedup';
    const pending = makePendingSession(agentId);
    const activated = { ...pending, backendSessionId: 'backend-retry', status: 'active' };

    vi.mocked(sessionStore.getSession).mockReturnValue(pending);

    // First call: activation fails
    vi.mocked(agentService.activateAgent).mockRejectedValueOnce(
      new Error('Activation failed'),
    );

    chatService['state'].update((s) => ({ ...s, session: pending }));

    await expect(
      chatService.sendMessage('Retry me', mockWorkspace),
    ).rejects.toThrow('Activation failed');

    // Verify: one user message in local state and lastAttemptedMessage is set
    let state = chatService.getState();
    const userMessages = state.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(state.lastAttemptedMessage).toBeTruthy();
    expect(state.lastAttemptedMessage!.text).toBe('Retry me');

    // Mock getSessionForWorkspace to return a session with the optimistic message
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      ...pending,
      messages: [...userMessages],
    } as any);

    // Second call: activation succeeds on retry
    vi.mocked(agentService.activateAgent).mockResolvedValueOnce(activated);

    // Advance time past the rate limiter (MIN_MESSAGE_SEND_INTERVAL = 100ms)
    // so the retry sendMessage is not silently dropped
    chatService['lastMessageTime'] = 0;

    await chatService.retryLastMessage(mockWorkspace);

    // Verify: still exactly ONE user message (no duplicate)
    state = chatService.getState();
    const retryUserMessages = state.messages.filter((m) => m.role === 'user');
    expect(retryUserMessages).toHaveLength(1);
    expect(
      retryUserMessages[0].contentBlocks?.some((b: any) => b.text === 'Retry me'),
    ).toBe(true);

    // Verify: updateMessagesForWorkspace was called to remove the stale optimistic message
    // from the correct workspace's sessionStore before re-sending
    expect(sessionStore.updateMessagesForWorkspace).toHaveBeenCalledWith(
      mockWorkspace.id,
      agentId,
      expect.any(Array),
    );
  });

  it('retryLastMessage removes stale optimistic message from sessionStore', async () => {
    const agentId = 'pending-retry-store';
    const pending = makePendingSession(agentId);
    const activated = { ...pending, backendSessionId: 'backend-store', status: 'active' };

    vi.mocked(sessionStore.getSession).mockReturnValue(pending);

    // Activation fails on first attempt
    vi.mocked(agentService.activateAgent).mockRejectedValueOnce(
      new Error('Activation failed'),
    );

    chatService['state'].update((s) => ({ ...s, session: pending }));

    await expect(
      chatService.sendMessage('Store cleanup test', mockWorkspace),
    ).rejects.toThrow('Activation failed');

    const state = chatService.getState();
    const staleMessage = state.messages.find((m) => m.role === 'user')!;
    expect(staleMessage).toBeDefined();

    // Mock sessionStore to return the stale message
    vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
      ...pending,
      messages: [staleMessage],
    } as any);

    // Activation succeeds on retry
    vi.mocked(agentService.activateAgent).mockResolvedValueOnce(activated);

    // Advance time past the rate limiter so retry sendMessage is not dropped
    chatService['lastMessageTime'] = 0;

    await chatService.retryLastMessage(mockWorkspace);

    // Verify: updateMessagesForWorkspace was called with the stale message filtered out
    expect(sessionStore.updateMessagesForWorkspace).toHaveBeenCalledWith(
      mockWorkspace.id,
      agentId,
      expect.not.arrayContaining([expect.objectContaining({ id: staleMessage.id })]),
    );
  });

  describe('cross-workspace retry cleanup', () => {
    const otherWorkspace = {
      id: 'ws-other',
      name: 'Other Workspace',
      path: '/other/workspace',
      worktreePath: '/other/workspace',
      repositoryPath: '/other/workspace',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
      metadata: {},
    } as any;

    it('retryLastMessage cleans up stale message from the session workspaceId, not the passed-in workspace', async () => {
      const agentId = 'cross-ws-retry';
      // Session belongs to mockWorkspace (ws-pending-test)
      const pending = makePendingSession(agentId);
      const activated = { ...pending, backendSessionId: 'backend-cross', status: 'active' };

      vi.mocked(sessionStore.getSession).mockReturnValue(pending);
      vi.mocked(agentService.activateAgent).mockRejectedValueOnce(
        new Error('Activation failed'),
      );

      chatService['state'].update((s) => ({ ...s, session: pending }));

      await expect(
        chatService.sendMessage('Cross workspace retry', mockWorkspace),
      ).rejects.toThrow('Activation failed');

      const state = chatService.getState();
      const staleMessage = state.messages.find((m) => m.role === 'user')!;

      // Mock getSessionForWorkspace to return the stale message for the session's workspace
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        ...pending,
        messages: [staleMessage],
      } as any);

      vi.mocked(agentService.activateAgent).mockResolvedValueOnce(activated);
      chatService['lastMessageTime'] = 0;

      // User switched to otherWorkspace, but retry should still clean up from session's workspace
      await chatService.retryLastMessage(otherWorkspace);

      // updateMessagesForWorkspace must target the session's workspaceId (mockWorkspace.id),
      // NOT otherWorkspace.id
      expect(sessionStore.updateMessagesForWorkspace).toHaveBeenCalledWith(
        mockWorkspace.id,
        agentId,
        expect.not.arrayContaining([expect.objectContaining({ id: staleMessage.id })]),
      );
    });

    it('retryWithModel cleans up stale message from the session workspaceId, not the passed-in workspace', async () => {
      const agentId = 'cross-ws-model-retry';
      const pending = makePendingSession(agentId);
      const activated = { ...pending, backendSessionId: 'backend-model-cross', status: 'active' };

      vi.mocked(sessionStore.getSession).mockReturnValue(pending);
      vi.mocked(agentService.activateAgent).mockRejectedValueOnce(
        new Error('Activation failed'),
      );

      chatService['state'].update((s) => ({ ...s, session: pending }));

      await expect(
        chatService.sendMessage('Model retry cross ws', mockWorkspace),
      ).rejects.toThrow('Activation failed');

      const state = chatService.getState();
      const staleMessage = state.messages.find((m) => m.role === 'user')!;

      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        ...pending,
        messages: [staleMessage],
      } as any);

      vi.mocked(agentService.activateAgent).mockResolvedValueOnce(activated);
      chatService['lastMessageTime'] = 0;

      // User switched to otherWorkspace, but retry should still clean up from session's workspace
      await chatService.retryWithModel(otherWorkspace, 'claude-3-opus');

      expect(sessionStore.updateMessagesForWorkspace).toHaveBeenCalledWith(
        mockWorkspace.id,
        agentId,
        expect.not.arrayContaining([expect.objectContaining({ id: staleMessage.id })]),
      );
    });

    it('retryFromConversationHistory persists to the session workspaceId, not the passed-in workspace', async () => {
      const agentId = 'cross-ws-fallback-retry';
      // Session belongs to mockWorkspace (ws-pending-test)
      const activeSession = {
        ...makePendingSession(agentId),
        backendSessionId: 'backend-fallback',
        status: 'active',
      };

      vi.mocked(sessionStore.getSession).mockReturnValue(activeSession);

      // Set up state with messages but NO lastAttemptedMessage (triggers fallback path)
      const userMsg = {
        id: 'user-msg-fallback',
        role: 'user' as const,
        text: 'Fallback retry message',
        contentBlocks: [{ type: 'text', text: 'Fallback retry message' }],
        createdAt: new Date(),
      };
      const errorMsg = {
        id: 'error-msg',
        role: 'assistant' as const,
        text: 'Error occurred',
        contentBlocks: [{ type: 'text', text: 'Error occurred' }],
        createdAt: new Date(),
      };

      chatService['state'].update((s) => ({
        ...s,
        session: activeSession,
        messages: [userMsg, errorMsg] as any[],
        error: 'Something went wrong',
        lastAttemptedMessage: null,
      }));

      // Mock getSessionForWorkspace for the cleanup path
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        ...activeSession,
        messages: [userMsg, errorMsg],
      } as any);

      chatService['lastMessageTime'] = 0;

      // Retry with otherWorkspace — but session belongs to mockWorkspace
      await chatService.retryLastMessage(otherWorkspace);

      // saveSession must target the session's workspaceId (mockWorkspace.id),
      // NOT otherWorkspace.id
      expect(agentService.saveSession).toHaveBeenCalledWith(
        agentId,
        mockWorkspace.id,
        false,
        expect.objectContaining({ allowTruncation: true }),
      );
      // Verify it was NOT called with otherWorkspace.id
      expect(agentService.saveSession).not.toHaveBeenCalledWith(
        agentId,
        otherWorkspace.id,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ─── retry cleanup heuristic safety ───

  describe('retry cleanup does not remove historical messages', () => {
    /**
     * REGRESSION: retryLastMessage removes the last user message assuming it is
     * the stale optimistic message from a failed send. However, when the send
     * error handler already removed the optimistic message (non-activation
     * failures), the "last user message" is actually a legitimate historical
     * message. The fix validates that the last user message text matches
     * lastAttemptedMessage.text before removing it.
     */
    it('retryLastMessage should preserve historical user message when optimistic was already removed', async () => {
      const agentId = 'retry-safe';
      const session = {
        id: agentId,
        backendSessionId: 'backend-1',
        workspaceId: mockWorkspace.id,
        name: 'Test Agent',
        status: 'active',
        messages: [],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      } as any;

      vi.mocked(sessionStore.getSession).mockReturnValue(session);

      // Set up state as if the optimistic message was ALREADY removed by sendMessage
      // error handler (non-activation failure path), but lastAttemptedMessage remains.
      // The conversation has a historical user message with DIFFERENT text.
      chatService['state'].update((s) => ({
        ...s,
        session,
        messages: [
          {
            id: 'historical-user-1',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Previous question' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'historical-assistant-1',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Previous answer' }],
            timestamp: new Date().toISOString(),
          },
        ],
        error: 'Network error',
        lastAttemptedMessage: { text: 'Failed new question' },
      }));

      // Make sendMessage succeed on retry
      vi.mocked(agentService.sendMessage).mockResolvedValue({ messageId: 'retry-msg' } as any);

      await chatService.retryLastMessage(mockWorkspace);

      // The historical message must NOT have been removed
      const state = chatService.getState();
      const historicalMsg = state.messages.find((m: any) => m.id === 'historical-user-1');
      expect(historicalMsg).toBeDefined();
      expect(historicalMsg!.contentBlocks![0]).toEqual(
        expect.objectContaining({ text: 'Previous question' }),
      );
    });

    it('retryWithModel should preserve historical user message when optimistic was already removed', async () => {
      const agentId = 'retry-model-safe';
      const session = {
        id: agentId,
        backendSessionId: 'backend-1',
        workspaceId: mockWorkspace.id,
        name: 'Test Agent',
        status: 'active',
        messages: [],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      } as any;

      vi.mocked(sessionStore.getSession).mockReturnValue(session);

      // Same setup: optimistic message already removed, historical message present
      chatService['state'].update((s) => ({
        ...s,
        session,
        messages: [
          {
            id: 'hist-user-2',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Old conversation' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'hist-assistant-2',
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Old response' }],
            timestamp: new Date().toISOString(),
          },
        ],
        error: 'Model unavailable',
        modelUnavailable: { model: 'claude-3-5-sonnet-latest', message: 'unavailable' },
        lastAttemptedMessage: { text: 'Different message that failed' },
      }));

      vi.mocked(agentService.sendMessage).mockResolvedValue({ messageId: 'retry-model-msg' } as any);

      await chatService.retryWithModel(mockWorkspace, 'claude-3-5-haiku-latest');

      // Historical message must be preserved
      const state = chatService.getState();
      const historicalMsg = state.messages.find((m: any) => m.id === 'hist-user-2');
      expect(historicalMsg).toBeDefined();
      expect(historicalMsg!.contentBlocks![0]).toEqual(
        expect.objectContaining({ text: 'Old conversation' }),
      );
    });

    it('retryLastMessage should still remove the optimistic message when text matches', async () => {
      const agentId = 'retry-removes-optimistic';
      const session = {
        id: agentId,
        backendSessionId: 'backend-1',
        workspaceId: mockWorkspace.id,
        name: 'Test Agent',
        status: 'active',
        messages: [],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      } as any;

      vi.mocked(sessionStore.getSession).mockReturnValue(session);

      // Set up state where the optimistic message is STILL present (activation failure case)
      chatService['state'].update((s) => ({
        ...s,
        session,
        messages: [
          {
            id: 'optimistic-msg-1',
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Hello agent' }],
            timestamp: new Date().toISOString(),
          },
        ],
        error: 'Failed to activate agent',
        lastAttemptedMessage: { text: 'Hello agent' },
      }));

      vi.mocked(agentService.sendMessage).mockResolvedValue({ messageId: 'retry-ok' } as any);

      await chatService.retryLastMessage(mockWorkspace);

      // The optimistic message should have been removed before sendMessage added a new one
      const state = chatService.getState();
      const oldOptimistic = state.messages.find((m: any) => m.id === 'optimistic-msg-1');
      expect(oldOptimistic).toBeUndefined();
    });
  });

  // ─── trim consistency for optimistic-message cleanup ───

  describe('retry cleanup with trailing whitespace/newline input', () => {
    /**
     * REGRESSION: sendMessage trims the message for content blocks but previously
     * stored the untrimmed text in lastAttemptedMessage. Retry cleanup compared
     * content-block text (trimmed) against lastAttemptedMessage.text (untrimmed),
     * so trailing whitespace prevented the match and left a duplicate user message.
     */

    it.each([
      ['trailing newline', 'Hello agent\n'],
      ['trailing spaces', 'Hello agent   '],
      ['trailing mixed whitespace', 'Hello agent \n \t'],
      ['leading and trailing', '  Hello agent\n'],
    ])(
      'lastAttemptedMessage.text is trimmed after sendMessage with %s',
      async (_label, rawMessage) => {
        const agentId = 'trim-store-test';
        const pending = makePendingSession(agentId);

        vi.mocked(sessionStore.getSession).mockReturnValue(pending);
        vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(pending);
        vi.mocked(agentService.activateAgent).mockRejectedValueOnce(
          new Error('Activation failed'),
        );

        chatService['state'].update((s) => ({ ...s, session: pending }));

        await chatService
          .sendMessage(rawMessage, mockWorkspace)
          .catch(() => {});

        const state = chatService.getState();
        // lastAttemptedMessage.text must be trimmed to match content block text
        expect(state.lastAttemptedMessage?.text).toBe(rawMessage.trim());
        // Content block text is trimmed
        const userMsg = state.messages.find((m: any) => m.role === 'user');
        const blockText = userMsg?.contentBlocks?.find(
          (b: any) => b.type === 'text',
        )?.text;
        expect(blockText).toBe(rawMessage.trim());
        // Both must be identical so retry cleanup can match them
        expect(state.lastAttemptedMessage?.text).toBe(blockText);
      },
    );

    it('retryLastMessage removes optimistic message when original input had trailing newline', async () => {
      const agentId = 'trim-retry-dedup';
      const pending = makePendingSession(agentId);
      const activated = { ...pending, backendSessionId: 'backend-trim', status: 'active' };

      vi.mocked(sessionStore.getSession).mockReturnValue(pending);
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(pending);

      // Activation fails on first attempt
      vi.mocked(agentService.activateAgent).mockRejectedValueOnce(
        new Error('Activation failed'),
      );

      chatService['state'].update((s) => ({ ...s, session: pending }));

      await expect(
        chatService.sendMessage('Hello agent\n', mockWorkspace),
      ).rejects.toThrow('Activation failed');

      // Verify optimistic message is present and lastAttemptedMessage is trimmed
      let state = chatService.getState();
      expect(state.messages.filter((m) => m.role === 'user')).toHaveLength(1);
      expect(state.lastAttemptedMessage?.text).toBe('Hello agent');

      // Mock sessionStore for cleanup path
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        ...pending,
        messages: [...state.messages],
      } as any);

      // Activation succeeds on retry
      vi.mocked(agentService.activateAgent).mockResolvedValueOnce(activated);
      chatService['lastMessageTime'] = 0;

      await chatService.retryLastMessage(mockWorkspace);

      // The old optimistic message should have been removed (no duplicate)
      state = chatService.getState();
      const retryUserMessages = state.messages.filter((m) => m.role === 'user');
      expect(retryUserMessages).toHaveLength(1);
      expect(
        retryUserMessages[0].contentBlocks?.some(
          (b: any) => b.text === 'Hello agent',
        ),
      ).toBe(true);
    });

    it('retryWithModel removes optimistic message when original input had trailing whitespace', async () => {
      const agentId = 'trim-model-retry';
      const pending = makePendingSession(agentId);
      const activated = { ...pending, backendSessionId: 'backend-trim-model', status: 'active' };

      vi.mocked(sessionStore.getSession).mockReturnValue(pending);
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(pending);

      // Activation fails on first attempt
      vi.mocked(agentService.activateAgent).mockRejectedValueOnce(
        new Error('Activation failed'),
      );

      chatService['state'].update((s) => ({ ...s, session: pending }));

      await expect(
        chatService.sendMessage('Hello agent   ', mockWorkspace),
      ).rejects.toThrow('Activation failed');

      let state = chatService.getState();
      expect(state.lastAttemptedMessage?.text).toBe('Hello agent');

      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        ...pending,
        messages: [...state.messages],
      } as any);

      vi.mocked(agentService.activateAgent).mockResolvedValueOnce(activated);
      chatService['lastMessageTime'] = 0;

      await chatService.retryWithModel(mockWorkspace, 'claude-3-opus');

      // Old optimistic message removed, fresh one added by sendMessage
      state = chatService.getState();
      const retryUserMessages = state.messages.filter((m) => m.role === 'user');
      expect(retryUserMessages).toHaveLength(1);
    });
  });

  describe('cross-workspace overlap guard and optimistic message targeting', () => {
    const WORKSPACE_A_ID = 'ws-agent-home';
    const WORKSPACE_B_ID = 'ws-user-viewing';

    function makeSessionInWorkspace(agentId: string, workspaceId: string) {
      return {
        id: agentId,
        backendSessionId: 'backend-x',
        workspaceId,
        name: 'Cross-WS Agent',
        status: 'active',
        messages: [],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      } as any;
    }

    it('overlap guard uses workspace-aware lookup so a wrong-workspace stale isStreaming=true does not block sends', async () => {
      const agentId = 'cross-ws-overlap';
      const correctSession = makeSessionInWorkspace(agentId, WORKSPACE_A_ID);
      // A stale session in the "wrong" workspace that is streaming
      const staleSession = { ...correctSession, isStreaming: true };

      // getSession (current-workspace-dependent) would return the stale streaming session
      vi.mocked(sessionStore.getSession).mockReturnValue(staleSession);
      // getSessionForWorkspace with the correct workspace returns the real non-streaming session
      vi.mocked(sessionStore.getSessionForWorkspace).mockImplementation(
        (wsId: string, _agentId: string) => {
          if (wsId === WORKSPACE_A_ID) return correctSession;
          return staleSession;
        },
      );

      vi.mocked(agentService.sendMessage).mockResolvedValue({ messageId: 'msg-1' } as any);

      chatService['state'].update((s) => ({
        ...s,
        session: correctSession,
        messages: [],
      }));
      chatService['lastMessageTime'] = 0;

      // Should NOT throw "already streaming" because workspace-aware lookup returns non-streaming session
      await expect(
        chatService.sendMessage('Hello', { id: WORKSPACE_A_ID } as any),
      ).resolves.not.toThrow();

      // Verify workspace-aware lookup was called (not just getSession)
      expect(sessionStore.getSessionForWorkspace).toHaveBeenCalledWith(WORKSPACE_A_ID, agentId);
    });

    it('optimistic message is written to the session workspace, not the UI workspace', async () => {
      const agentId = 'cross-ws-optimistic';
      const session = makeSessionInWorkspace(agentId, WORKSPACE_A_ID);

      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(session);
      vi.mocked(agentService.sendMessage).mockResolvedValue({ messageId: 'msg-2' } as any);

      chatService['state'].update((s) => ({
        ...s,
        session,
        messages: [],
      }));
      chatService['lastMessageTime'] = 0;

      // Pass a workspace object whose id differs from the session's workspaceId
      const uiWorkspace = { id: WORKSPACE_B_ID } as any;
      await chatService.sendMessage('Hi from wrong workspace', uiWorkspace);

      // The optimistic message should be written to WORKSPACE_A (session home), NOT WORKSPACE_B (UI)
      expect(sessionStore.addMessageForWorkspace).toHaveBeenCalledWith(
        WORKSPACE_A_ID,
        agentId,
        expect.objectContaining({ role: 'user' }),
      );
      // Should NOT have been called with the UI workspace
      const calls = vi.mocked(sessionStore.addMessageForWorkspace).mock.calls;
      const wrongWorkspaceCalls = calls.filter(([wsId]) => wsId === WORKSPACE_B_ID);
      expect(wrongWorkspaceCalls).toHaveLength(0);
    });
  });

  // ─── ID-based retry cleanup safety ───

  describe('retry cleanup uses optimisticMessageId for precise matching', () => {
    /**
     * REGRESSION: When multiple user messages share identical text, text-based
     * matching could delete a legitimate historical message instead of the
     * optimistic one. The fix stores optimisticMessageId in lastAttemptedMessage
     * and uses it for precise ID-based cleanup.
     */
    it('retryLastMessage removes only the optimistic message when historical messages have same text', async () => {
      const agentId = 'id-retry-safe';
      const session = {
        id: agentId,
        backendSessionId: 'backend-1',
        workspaceId: mockWorkspace.id,
        name: 'Test Agent',
        status: 'active',
        messages: [],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      vi.mocked(sessionStore.getSession).mockReturnValue(session);

      // Set up state with a historical message AND an optimistic message with SAME text
      const historicalMsg = {
        id: 'historical-same-text',
        role: 'user' as const,
        text: 'Hello agent',
        contentBlocks: [{ type: 'text', text: 'Hello agent' }],
        createdAt: new Date(Date.now() - 10000),
      };
      const optimisticMsg = {
        id: 'optimistic-same-text',
        role: 'user' as const,
        text: 'Hello agent',
        contentBlocks: [{ type: 'text', text: 'Hello agent' }],
        createdAt: new Date(),
      };

      chatService['state'].set({
        ...chatService.getState(),
        session,
        messages: [historicalMsg, optimisticMsg] as any[],
        lastAttemptedMessage: {
          text: 'Hello agent',
          optimisticMessageId: 'optimistic-same-text',
        },
        error: 'Send failed',
      });

      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        ...session,
        messages: [historicalMsg, optimisticMsg],
      } as any);

      vi.mocked(agentService.sendMessage).mockResolvedValue({ messageId: 'retry-msg' } as any);
      chatService['lastMessageTime'] = 0;

      await chatService.retryLastMessage(mockWorkspace);

      const state = chatService.getState();
      // Historical message with same text must be preserved
      const historical = state.messages.find((m: any) => m.id === 'historical-same-text');
      expect(historical).toBeDefined();
      // Optimistic message must have been removed
      const optimistic = state.messages.find((m: any) => m.id === 'optimistic-same-text');
      expect(optimistic).toBeUndefined();
    });

    it('retryWithModel removes only the optimistic message by ID, preserving same-text history', async () => {
      const agentId = 'id-model-retry-safe';
      const session = {
        id: agentId,
        backendSessionId: 'backend-1',
        workspaceId: mockWorkspace.id,
        name: 'Test Agent',
        status: 'active',
        messages: [],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      vi.mocked(sessionStore.getSession).mockReturnValue(session);

      const historicalMsg = {
        id: 'hist-same-text-model',
        role: 'user' as const,
        text: 'Duplicate text',
        contentBlocks: [{ type: 'text', text: 'Duplicate text' }],
        createdAt: new Date(Date.now() - 10000),
      };
      const optimisticMsg = {
        id: 'opt-same-text-model',
        role: 'user' as const,
        text: 'Duplicate text',
        contentBlocks: [{ type: 'text', text: 'Duplicate text' }],
        createdAt: new Date(),
      };

      chatService['state'].set({
        ...chatService.getState(),
        session,
        messages: [historicalMsg, optimisticMsg] as any[],
        lastAttemptedMessage: {
          text: 'Duplicate text',
          optimisticMessageId: 'opt-same-text-model',
        },
        error: 'Send failed',
      });

      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        ...session,
        messages: [historicalMsg, optimisticMsg],
      } as any);

      vi.mocked(agentService.sendMessage).mockResolvedValue({ messageId: 'model-retry-msg' } as any);
      chatService['lastMessageTime'] = 0;

      await chatService.retryWithModel(mockWorkspace, 'claude-3-opus');

      const state = chatService.getState();
      expect(state.messages.find((m: any) => m.id === 'hist-same-text-model')).toBeDefined();
      expect(state.messages.find((m: any) => m.id === 'opt-same-text-model')).toBeUndefined();
    });
  });

  // ─── deferred session handler race guard ───

  describe('initializeChat deferred-session race guard', () => {
    /**
     * REGRESSION: When initializeChat is called twice rapidly (e.g., workspace
     * switch), the deferred-session handler from the first call could overwrite
     * the session set by the second call. The generation guard ensures stale
     * handlers are no-ops.
     */
    it('generation counter increments on each initializeChat call', async () => {
      const agent1 = 'agent-first';
      const agent2 = 'agent-second';

      // Neither agent has a session in the store — both will hit the deferred path
      vi.mocked(sessionStore.getSession).mockReturnValue(undefined as any);
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(undefined as any);

      // Mock restoreSession to return null (no persisted session)
      vi.mocked(agentService as any).restoreSession = vi.fn().mockResolvedValue(null);

      const genBefore = (chatService as any)._initGeneration;

      // First initializeChat — will register deferred handler
      await chatService.initializeChat(mockWorkspace, agent1);
      const genAfterFirst = (chatService as any)._initGeneration;
      expect(genAfterFirst).toBe(genBefore + 1);

      // Second initializeChat — supersedes the first
      await chatService.initializeChat(mockWorkspace, agent2);
      const genAfterSecond = (chatService as any)._initGeneration;
      expect(genAfterSecond).toBe(genBefore + 2);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

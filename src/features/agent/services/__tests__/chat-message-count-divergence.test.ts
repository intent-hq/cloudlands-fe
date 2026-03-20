/**
 * Regression tests for large message-count divergence during streaming.
 *
 * This file tests the fix for the issue where content-blocks or session-sync
 * updates arrive with fewer messages than the already-visible history, potentially
 * causing message loss.
 *
 * The fix: ChatService now merges incoming updates with existing state instead of
 * overwriting when the incoming update has fewer messages. This preserves:
 * - Optimistic user messages that haven't been persisted yet
 * - Streaming assistant content that the backend hasn't acknowledged
 * - Message history during workspace switches or cross-session restores
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
    getSession: vi.fn(),
    getSessionForWorkspace: vi.fn(),
    addSession: vi.fn(),
    addSessionForWorkspace: vi.fn(),
    setActiveSession: vi.fn(),
    updateMessages: vi.fn(),
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
  api: {
    on: vi.fn(),
    off: vi.fn(),
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

import { ChatService } from '../chat.service';
import { sessionStore } from '$features/agent/browser';

describe('ChatService Message-Count Divergence Protection', () => {
  let chatService: ChatService;
  let rafCallback: (() => void) | null = null;
  let originalRaf: typeof requestAnimationFrame;

  beforeEach(() => {
    vi.clearAllMocks();
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

  function simulateStreamEvent(
    sessionId: string,
    data: { type: string; content?: string; data?: any; error?: string; message?: any },
  ) {
    (chatService as any).handleStreamEvent(sessionId, data);
  }

  function setupSession(sessionId: string, initialMessages: any[] = []) {
    const store = chatService.getStore();
    store.update((s) => ({
      ...s,
      session: {
        id: sessionId,
        backendSessionId: sessionId,
        workspaceId: 'test-workspace',
        name: 'Test',
        status: 'active',
        messages: initialMessages,
        model: 'test',
        systemPrompt: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      } as any,
      messages: initialMessages,
    }));
    (chatService as any).streamHandlers.set(sessionId, () => {});
  }

  // Helper to create test messages
  function createMessage(id: string, role: 'user' | 'assistant', text: string, isStreaming = false) {
    return {
      id,
      role,
      contentBlocks: [{ type: 'text', text }],
      timestamp: new Date().toISOString(),
      isStreaming,
    };
  }

  describe('content-blocks update with strict subset of visible history', () => {
    /**
     * REGRESSION: content-blocks arriving with fewer messages than local state.
     *
     * Scenario: User sends a message (optimistic), streaming starts, but the backend's
     * sessionStore snapshot doesn't include the optimistic message yet. The content-blocks
     * handler would previously overwrite local state, losing the user message.
     */
    it('should preserve optimistic user messages when content-blocks arrives with fewer messages', () => {
      const sessionId = 'test-content-blocks-subset';
      const userMsg = createMessage('msg_user_1', 'user', 'Hello');
      const assistantMsg = createMessage('msg_asst_1', 'assistant', '', true);

      // Set up with user message + streaming assistant
      setupSession(sessionId, [userMsg, assistantMsg]);

      // Simulate: sessionStore only knows about a subset (backend hasn't synced user message yet)
      // FIX: Use getSessionForWorkspace — the content-blocks handler now uses workspace-aware
      // lookup via currentState.session.workspaceId ('test-workspace' from setupSession).
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        id: sessionId,
        messages: [assistantMsg], // Only assistant, missing user message!
      } as any);

      // Start streaming and receive content-blocks
      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'content-blocks',
        data: [{ type: 'tool_use', id: 'tool_1', name: 'search', input: {} }],
      });

      // CRITICAL: User message must still be present
      const state = get(chatService.getStore());
      expect(state.messages.length).toBeGreaterThanOrEqual(2);
      const userMessages = state.messages.filter(m => m.role === 'user');
      expect(userMessages.length).toBe(1);
      expect(userMessages[0].id).toBe('msg_user_1');
    });

    it('should update streaming assistant content even when merging due to count mismatch', () => {
      const sessionId = 'test-content-blocks-merge';
      const userMsg = createMessage('msg_user_1', 'user', 'Hello');
      const assistantMsgLocal = {
        ...createMessage('msg_asst_1', 'assistant', 'Partial response', true),
        contentBlocks: [{ type: 'text', text: 'Partial response' }],
      };

      // Local state has user + assistant with partial content
      setupSession(sessionId, [userMsg, assistantMsgLocal]);

      // sessionStore has only assistant with tool_use block (no user message)
      const assistantMsgFromStore = {
        ...createMessage('msg_asst_1', 'assistant', '', true),
        contentBlocks: [
          { type: 'text', text: 'Partial response' },
          { type: 'tool_use', id: 'tool_1', name: 'search', input: {} },
        ],
      };
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        id: sessionId,
        messages: [assistantMsgFromStore],
      } as any);

      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'content-blocks',
        data: [{ type: 'tool_use', id: 'tool_1', name: 'search', input: {} }],
      });

      const state = get(chatService.getStore());

      // User message preserved
      expect(state.messages.filter(m => m.role === 'user').length).toBe(1);

      // Assistant message updated with tool_use block
      const assistantMsgs = state.messages.filter(m => m.role === 'assistant');
      expect(assistantMsgs.length).toBe(1);
      const toolBlocks = assistantMsgs[0].contentBlocks?.filter(
        (b: any) => b.type === 'tool_use'
      );
      expect(toolBlocks?.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle large divergence (many more local messages than incoming)', () => {
      const sessionId = 'test-large-divergence';

      // Local state has a long conversation history
      const localMessages = [
        createMessage('msg_user_1', 'user', 'First question'),
        createMessage('msg_asst_1', 'assistant', 'First answer'),
        createMessage('msg_user_2', 'user', 'Second question'),
        createMessage('msg_asst_2', 'assistant', 'Second answer'),
        createMessage('msg_user_3', 'user', 'Third question'),
        createMessage('msg_asst_3', 'assistant', '', true), // Currently streaming
      ];
      setupSession(sessionId, localMessages);

      // sessionStore returns only the last streaming message (extreme mismatch)
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        id: sessionId,
        messages: [createMessage('msg_asst_3', 'assistant', '', true)],
      } as any);

      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'content-blocks',
        data: [{ type: 'tool_use', id: 'tool_x', name: 'execute', input: {} }],
      });

      const state = get(chatService.getStore());

      // All 6 messages should be preserved
      expect(state.messages.length).toBe(6);

      // Verify history integrity
      const userMsgs = state.messages.filter(m => m.role === 'user');
      expect(userMsgs.length).toBe(3);
      expect(userMsgs.map(m => m.id)).toEqual(['msg_user_1', 'msg_user_2', 'msg_user_3']);
    });
  });

  describe('stream completion with message-count divergence', () => {
    it('should preserve user messages during stream finalization when backend has fewer', () => {
      const sessionId = 'test-end-fewer';
      const userMsg = createMessage('msg_user_1', 'user', 'Hello');
      const assistantMsgLocal = createMessage('msg_asst_1', 'assistant', 'Response', true);

      setupSession(sessionId, [userMsg, assistantMsgLocal]);

      vi.mocked(sessionStore.getSession).mockReturnValue({
        id: sessionId,
        messages: [
          {
            ...createMessage('msg_asst_1', 'assistant', 'Final response'),
            isStreaming: false,
          },
        ],
      } as any);

      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'end',
        message: {
          id: 'msg_asst_1',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Final response' }],
        },
      });

      const state = get(chatService.getStore());

      // User message must be preserved
      expect(state.messages.filter(m => m.role === 'user').length).toBe(1);
      expect(state.messages.find(m => m.id === 'msg_user_1')).toBeDefined();

      // Streaming should be cleared
      expect(state.isStreaming).toBe(false);
      expect(state.isProcessing).toBe(false);
    });

    it('should maintain message order by timestamp after merging user messages', () => {
      const sessionId = 'test-end-order';
      const now = Date.now();

      const userMsg1 = {
        ...createMessage('msg_user_1', 'user', 'First'),
        timestamp: new Date(now - 3000).toISOString(),
      };
      const userMsg2 = {
        ...createMessage('msg_user_2', 'user', 'Second'),
        timestamp: new Date(now - 1000).toISOString(),
      };
      const assistantMsg = {
        ...createMessage('msg_asst_1', 'assistant', '', true),
        timestamp: new Date(now).toISOString(),
      };

      // Local state has 2 user messages + streaming assistant
      setupSession(sessionId, [userMsg1, userMsg2, assistantMsg]);

      // Backend only has the final assistant message (both user messages missing)
      vi.mocked(sessionStore.getSession).mockReturnValue({
        id: sessionId,
        messages: [{
          id: 'msg_asst_1',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Final' }],
          timestamp: new Date(now).toISOString(),
        }],
      } as any);

      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'end',
        message: {
          id: 'msg_asst_1',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Final' }],
        },
      });

      const state = get(chatService.getStore());

      // User messages preserved and in correct order by timestamp
      expect(state.messages.length).toBe(3);
      const userMsgs = state.messages.filter(m => m.role === 'user');
      expect(userMsgs.length).toBe(2);
      expect(userMsgs.map(m => m.id)).toEqual(['msg_user_1', 'msg_user_2']);

      // Assistant message finalized (isStreaming should be falsy - either false or undefined)
      const assistantMsgs = state.messages.filter(m => m.role === 'assistant');
      expect(assistantMsgs.length).toBe(1);
      expect(assistantMsgs[0].isStreaming).toBeFalsy();
    });
  });

  describe('workspace-switch / cross-session restore scenarios', () => {
    /**
     * REGRESSION: Returning to a conversation after workspace switch.
     *
     * When user switches away and back, sessionStore may have a stale/shorter
     * snapshot of the conversation. The ChatService must not lose messages
     * that were visible before the switch.
     */
    it('should preserve visible history when sessionStore returns stale data after restore', () => {
      const sessionId = 'test-workspace-restore';

      // Full conversation history that was visible before switch
      const fullHistory = [
        createMessage('msg_user_1', 'user', 'Question 1'),
        createMessage('msg_asst_1', 'assistant', 'Answer 1'),
        createMessage('msg_user_2', 'user', 'Question 2'),
        createMessage('msg_asst_2', 'assistant', 'Answer 2'),
        createMessage('msg_user_3', 'user', 'Question 3'),
        createMessage('msg_asst_3', 'assistant', '', true), // Active streaming
      ];
      setupSession(sessionId, fullHistory);

      // Simulate workspace restore: sessionStore has outdated snapshot (only 2 messages)
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        id: sessionId,
        messages: [
          createMessage('msg_user_1', 'user', 'Question 1'),
          createMessage('msg_asst_1', 'assistant', 'Answer 1'),
        ],
      } as any);

      // Streaming continues with content-blocks after restore
      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'content-blocks',
        data: [{ type: 'tool_use', id: 'tool_restore', name: 'check', input: {} }],
      });

      const state = get(chatService.getStore());

      // All 6 messages must be preserved
      expect(state.messages.length).toBe(6);
      expect(state.messages.filter(m => m.role === 'user').length).toBe(3);
      expect(state.messages.filter(m => m.role === 'assistant').length).toBe(3);
    });

    it('should handle sessionStore returning undefined gracefully', () => {
      const sessionId = 'test-undefined-session';
      const messages = [
        createMessage('msg_user_1', 'user', 'Hello'),
        createMessage('msg_asst_1', 'assistant', '', true),
      ];
      setupSession(sessionId, messages);

      // sessionStore.getSessionForWorkspace returns undefined (session not found)
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue(undefined as any);

      // Should use instance messages as fallback
      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'content-blocks',
        data: [{ type: 'tool_use', id: 'tool_fallback', name: 'action', input: {} }],
      });

      const state = get(chatService.getStore());

      // Messages should be preserved from instance state
      expect(state.messages.length).toBeGreaterThanOrEqual(2);
      expect(state.messages.find(m => m.id === 'msg_user_1')).toBeDefined();
    });

    it('should preserve streaming assistant content during count mismatch merge', () => {
      const sessionId = 'test-streaming-content-preserve';
      const userMsg = createMessage('msg_user_1', 'user', 'Hello');
      const assistantMsg = {
        ...createMessage('msg_asst_1', 'assistant', '', true),
        contentBlocks: [
          { type: 'text', text: 'I am thinking about your question...' },
        ],
      };

      setupSession(sessionId, [userMsg, assistantMsg]);

      // Start streaming and accumulate content
      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, { type: 'chunk', content: 'More content here' });

      // Fire RAF to flush chunks
      if (rafCallback) rafCallback();

      // Now sessionStore returns stale data (no user message)
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        id: sessionId,
        messages: [{
          id: 'msg_asst_1',
          role: 'assistant',
          contentBlocks: [{ type: 'text', text: '' }], // Stale - empty
          isStreaming: true,
        }],
      } as any);

      // Receive tool_use block
      simulateStreamEvent(sessionId, {
        type: 'content-blocks',
        data: [{ type: 'tool_use', id: 'tool_content', name: 'search', input: {} }],
      });

      const state = get(chatService.getStore());

      // User message preserved
      const userMsgs = state.messages.filter(m => m.role === 'user');
      expect(userMsgs.length).toBe(1);

      // Streaming content should be preserved (not overwritten with empty)
      // The localStreamingContent accumulator tracks this independently
      expect((chatService as any).localStreamingContent).toBe('');
      // Note: localStreamingContent resets on tool_use, but text blocks should be in message

      // Verify the assistant message itself retains accumulated streaming content
      // (not overwritten by the stale empty snapshot from sessionStore)
      const assistantMsgs = state.messages.filter(m => m.role === 'assistant');
      expect(assistantMsgs.length).toBe(1);
      const finalAssistantMsg = assistantMsgs[0];
      // The assistant message should have contentBlocks (text + tool_use)
      expect(finalAssistantMsg.contentBlocks).toBeDefined();
      expect(finalAssistantMsg.contentBlocks!.length).toBeGreaterThanOrEqual(1);
      // The text block should contain the streamed chunk text, NOT the stale
      // empty string from the sessionStore snapshot
      const textBlocks = finalAssistantMsg.contentBlocks!.filter((b: any) => b.type === 'text');
      expect(textBlocks.length).toBeGreaterThanOrEqual(1);
      expect(textBlocks[0].text).toBe('More content here');
      expect(textBlocks[0].text).not.toBe(''); // Explicitly verify not overwritten with empty
    });
  });

  describe('edge cases and boundary conditions', () => {
    it('should handle empty incoming messages during streaming', () => {
      const sessionId = 'test-empty-incoming';
      const messages = [
        createMessage('msg_user_1', 'user', 'Hello'),
        createMessage('msg_asst_1', 'assistant', 'Response', true),
      ];
      setupSession(sessionId, messages);

      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        id: sessionId,
        messages: [], // Empty!
      } as any);

      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'content-blocks',
        data: [{ type: 'tool_use', id: 'tool_empty', name: 'action', input: {} }],
      });

      const state = get(chatService.getStore());

      // Original messages should be preserved
      expect(state.messages.length).toBe(2);
    });

    it('should allow normal updates when incoming has equal or more messages', () => {
      const sessionId = 'test-normal-update';
      const messages = [
        createMessage('msg_user_1', 'user', 'Hello'),
      ];
      setupSession(sessionId, messages);

      // sessionStore has same + more messages (normal case)
      vi.mocked(sessionStore.getSessionForWorkspace).mockReturnValue({
        id: sessionId,
        messages: [
          createMessage('msg_user_1', 'user', 'Hello'),
          createMessage('msg_asst_1', 'assistant', '', true),
        ],
      } as any);

      simulateStreamEvent(sessionId, { type: 'start' });
      simulateStreamEvent(sessionId, {
        type: 'content-blocks',
        data: [{ type: 'tool_use', id: 'tool_normal', name: 'action', input: {} }],
      });

      const state = get(chatService.getStore());

      // Should accept the update with 2 messages
      expect(state.messages.length).toBe(2);
    });
  });
});


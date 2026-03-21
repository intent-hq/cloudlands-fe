/**
 * Regression tests for pending-agent first-send flow.
 *
 * Verifies that when a user sends the first message to a pending agent:
 * 1. activateAgent is called with the correct arguments
 * 2. Already-active agents skip activation
 * 3. Cross-workspace retry targets the correct workspace
 * 4. initializeChat deferred-session race guard works correctly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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


  describe('cross-workspace overlap guard', () => {
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

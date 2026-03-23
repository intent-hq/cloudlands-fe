import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChatService } from '../chat.service';
import { AgentService } from '../../agent.service';
import { sessionStore } from '../session-store';
import type { AgentSession } from '../../../shared/types/agent-session';
import type { Workspace } from '../../../shared/types/workspace.types';
import { AgentStatus } from '../../../shared/types/agent.types';

// Mock dependencies
vi.mock('../../agent.service');
vi.mock('../session-store');
vi.mock('../../../shared/utils/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Chat Session Resume', () => {
  let chatService: ChatService;
  let mockAgentService: any;
  let mockSessionStore: any;

  const mockWorkspace: Workspace = {
    id: 'workspace-123' as any,
    name: 'Test Workspace',
    path: '/test/workspace',
    worktreePath: '/test/workspace',
    repositoryPath: '/test/workspace',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date(),
    metadata: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock agent service
    mockAgentService = {
      restoreSession: vi.fn(),
      activateAgent: vi.fn(),
      sendMessage: vi.fn(),
    };
    vi.mocked(AgentService).getInstance = vi.fn().mockReturnValue(mockAgentService);

    // Mock session store
    mockSessionStore = {
      getSessionForWorkspace: vi.fn(),
      addSessionForWorkspace: vi.fn(),
      setActiveSessionForWorkspace: vi.fn(),
    };
    Object.assign(sessionStore, mockSessionStore);

    // Create a fresh per-agent ChatService instance for each test
    chatService = new ChatService('test-agent');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadSession with existing messages', () => {
    it('should resume session with 2+ messages without creating new thread', async () => {
      const agentId = 'agent-with-messages';

      // Mock session with multiple messages
      const existingSession: AgentSession = {
        id: agentId as any,
        backendSessionId: 'backend-123' as any,
        workspaceId: mockWorkspace.id,
        name: 'Test Agent',
        status: 'active' as AgentStatus,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Hello' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-2' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Hi there!' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-3' as any,
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'How are you?' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-4' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: "I'm doing well, thanks!" }],
            timestamp: new Date().toISOString(),
          },
        ],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: 'You are a helpful assistant',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      };

      // Mock sessionStore returns the session
      mockSessionStore.getSessionForWorkspace.mockReturnValue(existingSession);

      // Load the session
      await chatService.loadSession(agentId, mockWorkspace);

      // Get the current state
      const state = chatService.getState();

      // Verify session was loaded correctly
      expect(state.session).toBeDefined();
      expect(state.session?.id).toBe(agentId);
      expect(state.session?.backendSessionId).toBe('backend-123');

      // CRITICAL: Verify all messages were loaded
      expect(state.messages).toHaveLength(4);
      expect(state.messages[0].contentBlocks[0].text).toBe('Hello');
      expect(state.messages[3].contentBlocks[0].text).toBe("I'm doing well, thanks!");

      // Verify agent was NOT activated (it's already active)
      expect(mockAgentService.activateAgent).not.toHaveBeenCalled();
    });

    it('should NOT activate agent when sending message if already has backendSessionId', async () => {
      const agentId = 'active-agent';

      // Mock active session with backend session ID
      const activeSession: AgentSession = {
        id: agentId as any,
        backendSessionId: 'existing-backend-456' as any,
        workspaceId: mockWorkspace.id,
        name: 'Active Agent',
        status: 'active' as AgentStatus,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Previous message' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-2' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Previous response' }],
            timestamp: new Date().toISOString(),
          },
        ],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: 'You are a helpful assistant',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      };

      // Set up the session in chat service
      mockSessionStore.getSessionForWorkspace.mockReturnValue(activeSession);
      await chatService.loadSession(agentId, mockWorkspace);

      // Send a new message
      await chatService.sendMessage('Continue our conversation', mockWorkspace);

      // CRITICAL: Verify agent was NOT activated (it already has backendSessionId)
      expect(mockAgentService.activateAgent).not.toHaveBeenCalled();

      // Verify message was sent with existing session
      expect(mockAgentService.sendMessage).toHaveBeenCalledWith(
        agentId,
        'Continue our conversation',
        mockWorkspace,
        expect.any(Object),
      );
    });

    it('should activate pending agent only once when resuming with messages', async () => {
      const agentId = 'pending-agent';

      // Mock pending session WITHOUT backend session ID
      const pendingSession: AgentSession = {
        id: agentId as any,
        backendSessionId: null, // No backend session yet
        workspaceId: mockWorkspace.id,
        name: 'Pending Agent',
        status: 'pending' as AgentStatus,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'First message' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-2' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'First response' }],
            timestamp: new Date().toISOString(),
          },
        ],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: 'You are a helpful assistant',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      };

      // Mock activated session (what activateAgent returns)
      const activatedSession: AgentSession = {
        ...pendingSession,
        backendSessionId: 'new-backend-789' as any,
        status: 'active' as AgentStatus,
      };

      // Set up mocks
      mockSessionStore.getSessionForWorkspace.mockReturnValue(pendingSession);
      mockAgentService.activateAgent.mockResolvedValue(activatedSession);

      // Load the session
      await chatService.loadSession(agentId, mockWorkspace);

      // Send a new message (this should trigger activation)
      await chatService.sendMessage('Continue conversation', mockWorkspace);

      // CRITICAL: Verify agent was activated ONCE
      expect(mockAgentService.activateAgent).toHaveBeenCalledTimes(1);
      expect(mockAgentService.activateAgent).toHaveBeenCalledWith(agentId, mockWorkspace.id);

      // Verify the message was sent after activation
      expect(mockAgentService.sendMessage).toHaveBeenCalledWith(
        agentId,
        'Continue conversation',
        mockWorkspace,
        expect.any(Object),
      );
    });

    it('should set processing state BEFORE activateAgent is called', async () => {
      // Verify that isProcessing/isStreaming are set before activation starts,
      // so the UI shows a loading state immediately.
      const agentId = 'pending-ordering';

      const pendingSession: AgentSession = {
        id: agentId as any,
        backendSessionId: null,
        workspaceId: mockWorkspace.id,
        name: 'Pending Ordering Agent',
        status: 'pending' as AgentStatus,
        messages: [],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: 'You are a helpful assistant',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      };

      const activatedSession: AgentSession = {
        ...pendingSession,
        backendSessionId: 'backend-ordering' as any,
        status: 'active' as AgentStatus,
      };

      mockSessionStore.getSession.mockReturnValue(pendingSession);

      // Capture processing state at the moment activateAgent is invoked.
      let isProcessingAtActivation = false;

      mockAgentService.activateAgent.mockImplementation(async () => {
        isProcessingAtActivation = chatService.getState().isProcessing;
        return activatedSession;
      });

      await chatService.loadSession(agentId, mockWorkspace);
      await chatService.sendMessage('First message ever', mockWorkspace);

      // CRITICAL: isProcessing must be true when activateAgent is called
      expect(isProcessingAtActivation).toBe(true);
    });

    it('should set error state when activation fails', async () => {
      // When activateAgent throws, error state should be set and processing cleared.
      const agentId = 'pending-fail';

      const pendingSession: AgentSession = {
        id: agentId as any,
        backendSessionId: null,
        workspaceId: mockWorkspace.id,
        name: 'Failing Pending Agent',
        status: 'pending' as AgentStatus,
        messages: [],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: 'You are a helpful assistant',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      };

      mockSessionStore.getSession.mockReturnValue(pendingSession);
      mockAgentService.activateAgent.mockRejectedValue(new Error('Activation failed'));

      await chatService.loadSession(agentId, mockWorkspace);

      // sendMessage should throw because activation failed
      await expect(
        chatService.sendMessage('My important message', mockWorkspace),
      ).rejects.toThrow('Activation failed');

      // Error state should be set and processing cleared
      const state = chatService.getState();
      expect(state.error).toBeTruthy();
      expect(state.isProcessing).toBe(false);
    });

    it('should preserve message history when activating pending agent', async () => {
      const agentId = 'pending-with-history';

      // Mock pending session with message history
      const pendingSession: AgentSession = {
        id: agentId as any,
        backendSessionId: null,
        workspaceId: mockWorkspace.id,
        name: 'Agent with History',
        status: 'pending' as AgentStatus,
        messages: [
          {
            id: 'msg-1' as any,
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Message 1' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-2' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Response 1' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-3' as any,
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Message 2' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-4' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Response 2' }],
            timestamp: new Date().toISOString(),
          },
        ],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: 'You are a helpful assistant',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      };

      // Mock activated session should preserve messages
      const activatedSession: AgentSession = {
        ...pendingSession,
        backendSessionId: 'activated-backend' as any,
        status: 'active' as AgentStatus,
        messages: pendingSession.messages, // CRITICAL: Messages must be preserved
      };

      // Set up mocks
      mockSessionStore.getSessionForWorkspace.mockReturnValue(pendingSession);
      mockAgentService.activateAgent.mockResolvedValue(activatedSession);

      // Load the session
      await chatService.loadSession(agentId, mockWorkspace);

      // Verify initial messages are loaded
      let state = chatService.getState();
      expect(state.messages).toHaveLength(4);

      // Send a new message
      await chatService.sendMessage('Continue with message 3', mockWorkspace);

      // Get updated state
      state = chatService.getState();

      // CRITICAL: Verify all messages are preserved (4 original + 1 new user message)
      expect(state.messages).toHaveLength(5);
      expect(state.messages[0].contentBlocks[0].text).toBe('Message 1');
      expect(state.messages[1].contentBlocks[0].text).toBe('Response 1');
      expect(state.messages[2].contentBlocks[0].text).toBe('Message 2');
      expect(state.messages[3].contentBlocks[0].text).toBe('Response 2');
      expect(state.messages[4].contentBlocks[0].text).toBe('Continue with message 3');
    });
  });
});

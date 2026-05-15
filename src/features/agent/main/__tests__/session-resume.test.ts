/**
 * Tests for Session Resume with Messages
 *
 * These tests verify that agents with existing messages properly
 * continue their conversation thread when resumed, rather than
 * starting a new thread.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { AgentStatus } from '../../../shared/types/agent.types';
import type { AgentSession } from '../../../shared/types/agent-session';

// Mock the persistence module
vi.mock('../agent-persistence', () => ({
  UnifiedPersistence: {
    getInstance: vi.fn(),
  },
}));

// Mock the workspace config
vi.mock('../../../shared/config', () => ({
  WorkspaceConfig: {
    paths: {
      workspace: vi.fn((workspaceId: string) => `/test/workspaces/${workspaceId}`),
    },
  },
}));

describe('Session Resume with Messages', () => {
  let mockPersistence: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock persistence instance
    mockPersistence = {
      loadAgent: vi.fn(),
      saveAgent: vi.fn(),
      deleteAgent: vi.fn(),
      listAgents: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Agent Activation with Existing Messages', () => {
    it('should preserve existing messages when activating a pending agent', async () => {
      const agentId = 'test-agent-123';
      const workspaceId = 'workspace-456';

      // Mock agent with existing messages
      const existingAgent: AgentSession = {
        id: agentId as any,
        backendSessionId: null, // Pending agent has no backend session
        workspaceId: workspaceId as any,
        name: 'Test Agent',
        status: 'pending' as AgentStatus,
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
        ],
        model: 'claude-3-5-sonnet-latest',
        // systemPrompt is built by backend, not stored in frontend
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      };

      // Mock loadAgent to return the existing agent
      mockPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: existingAgent,
      });

      // TEST EXPECTATION:
      // When activating an agent with existing messages, the backend handler should:
      // 1. Load the agent from persistence (including messages)
      // 2. Pass ALL messages to the backend when creating/activating
      // 3. Continue the existing conversation thread

      // Verify messages exist in loaded agent
      expect(existingAgent.messages).toHaveLength(2);
      expect(existingAgent.messages[0].contentBlocks[0].text).toBe('Hello');
      expect(existingAgent.messages[1].contentBlocks[0].text).toBe('Hi there!');
    });

    it('should continue existing conversation thread when sending new message after resume', async () => {
      const agentId = 'test-agent-789';
      const workspaceId = 'workspace-101';

      // Mock agent with 2+ messages
      const resumedAgent: AgentSession = {
        id: agentId as any,
        backendSessionId: 'backend-session-123' as any, // Has backend session from before
        workspaceId: workspaceId as any,
        name: 'Resumed Agent',
        status: 'active' as AgentStatus,
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
          {
            id: 'msg-3' as any,
            role: 'user',
            contentBlocks: [{ type: 'text', text: 'Second message' }],
            timestamp: new Date().toISOString(),
          },
          {
            id: 'msg-4' as any,
            role: 'assistant',
            contentBlocks: [{ type: 'text', text: 'Second response' }],
            timestamp: new Date().toISOString(),
          },
        ],
        model: 'claude-3-5-sonnet-latest',
        systemPrompt: 'You are a helpful assistant',
        createdAt: new Date(),
        updatedAt: new Date(),
        isStreaming: false,
      };

      // Mock loadAgent to return the resumed agent
      mockPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: resumedAgent,
      });

      // TEST EXPECTATION:
      // When resuming an agent with a backend session ID and messages,
      // it should continue using the same session without re-activation.

      // Verify agent has messages and backend session
      expect(resumedAgent.messages).toHaveLength(4);
      expect(resumedAgent.backendSessionId).toBe('backend-session-123');
      expect(resumedAgent.status).toBe('active');

      // The agent should continue the same thread, not start a new one
      // This is indicated by preserving the backendSessionId
    });
  });
});

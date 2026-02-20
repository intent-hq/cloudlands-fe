/**
 * Unified Agent State Store Tests
 *
 * Comprehensive tests for the unified agent state management system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { agentState } from '../src/features/agent/services/agent-state.svelte';
import type { AgentSession, AgentMessage, ContentBlock } from '../src/shared/types';
import { AgentStatus } from '../src/shared/types';

// Mock session cleanup service
vi.mock('../src/features/agent/services/session-cleanup.service', () => ({
  sessionCleanupService: {
    registerSession: vi.fn(),
    updateActivity: vi.fn(),
  },
}));

describe('ConsolidatedAgentState', () => {
  beforeEach(() => {
    // Clear state before each test
    agentState.clearAll?.();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Agent Management', () => {
    it('should create and retrieve agent state', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);

      const retrieved = agentState.getAgent(agentId);
      expect(retrieved).toEqual(state);
      expect(agentState.hasAgent(agentId)).toBe(true);
    });

    it('should auto-activate first agent', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      expect(agentState.activeAgent).toBeNull();

      agentState.setAgent(agentId, state);

      expect(agentState.activeAgent).toEqual(state);
    });

    it('should update agent state partially', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);

      // Update UI state
      agentState.updateUIState(agentId, {
        scrollPosition: 100,
        searchQuery: 'test',
      });

      const updated = agentState.getAgent(agentId);
      expect(updated?.ui.scrollPosition).toBe(100);
      expect(updated?.ui.searchQuery).toBe('test');
      expect(updated?.ui.isExpanded).toBe(false); // Unchanged
    });

    it('should remove agent and update active agent', () => {
      const agent1 = 'test-agent-1';
      const agent2 = 'test-agent-2';

      agentState.setAgent(agent1, createMockAgentState(createMockSession(agent1)));
      agentState.setAgent(agent2, createMockAgentState(createMockSession(agent2)));

      expect(agentState.agentCount).toBe(2);

      agentState.removeAgent(agent1);

      expect(agentState.agentCount).toBe(1);
      expect(agentState.hasAgent(agent1)).toBe(false);
      expect(agentState.activeAgent?.session.id).toBe(agent2);
    });
  });

  describe('Message Management', () => {
    it('should add messages to agent session', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);

      const message: AgentMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Test message',
        timestamp: new Date(),
      };

      agentState.addMessage(agentId, message);

      const updated = agentState.getAgent(agentId);
      expect(updated?.session.messages).toHaveLength(1);
      expect(updated?.session.messages[0]).toEqual(message);
    });

    it('should handle multiple messages', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);

      const messages: AgentMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Question', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant', content: 'Answer', timestamp: new Date() },
      ];

      messages.forEach((msg) => agentState.addMessage(agentId, msg));

      const updated = agentState.getAgent(agentId);
      expect(updated?.session.messages).toHaveLength(2);
      expect(updated?.session.messages[0].role).toBe('user');
      expect(updated?.session.messages[1].role).toBe('assistant');
    });
  });

  describe('Streaming Management', () => {
    it('should start and stop streaming', () => {
      const agentId = 'test-agent-1';
      const sessionId = 'stream-123';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);

      // Start streaming
      agentState.startStreaming(agentId, sessionId);

      let updated = agentState.getAgent(agentId);
      expect(updated?.streaming.active).toBe(true);
      expect(updated?.streaming.sessionId).toBe(sessionId);
      expect(updated?.streaming.startTime).toBeDefined();

      // Stop streaming
      agentState.stopStreaming(agentId);

      updated = agentState.getAgent(agentId);
      expect(updated?.streaming.active).toBe(false);
      expect(updated?.streaming.buffer).toBe('');
    });

    it('should handle stream chunks', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);
      agentState.startStreaming(agentId, 'stream-123');

      // Add chunks
      agentState.appendToStream(agentId, 'Hello ');
      agentState.appendToStream(agentId, 'world!');

      const updated = agentState.getAgent(agentId);
      expect(updated?.streaming.buffer).toBe('Hello world!');
    });

    it('should handle content blocks', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);
      agentState.startStreaming(agentId, 'stream-123');

      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Processing...' },
        { type: 'tool_use', id: 'tool-1', name: 'calculator', input: { a: 1, b: 2 } },
      ];

      agentState.addContentBlocks(agentId, blocks);

      const updated = agentState.getAgent(agentId);
      expect(updated?.streaming.contentBlocks).toHaveLength(2);
      expect(updated?.streaming.contentBlocks[0].type).toBe('text');
      expect(updated?.streaming.contentBlocks[1].type).toBe('tool_use');
    });

    it('should merge content blocks intelligently', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);
      agentState.startStreaming(agentId, 'stream-123');

      // Add initial text block
      agentState.addContentBlocks(agentId, [{ type: 'text', text: 'Hello ' }]);

      // Add more text (should append)
      agentState.addContentBlocks(agentId, [{ type: 'text', text: 'world!' }]);

      const updated = agentState.getAgent(agentId);
      expect(updated?.streaming.contentBlocks).toHaveLength(1);
      expect(updated?.streaming.contentBlocks[0].text).toBe('Hello world!');
    });

    it('should stop streaming with final message', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);
      agentState.startStreaming(agentId, 'stream-123');
      agentState.appendToStream(agentId, 'Test response');

      const finalMessage: AgentMessage = {
        id: 'msg-final',
        role: 'assistant',
        content: 'Test response',
        timestamp: new Date(),
      };

      agentState.stopStreaming(agentId);

      const updated = agentState.getAgent(agentId);
      expect(updated?.streaming.active).toBe(false);
    });
  });

  describe('Error Management', () => {
    it('should add and clear errors', () => {
      const agentId = 'test-agent-1';
      const session = createMockSession(agentId);
      const state = createMockAgentState(session);

      agentState.setAgent(agentId, state);

      const error1 = new Error('Test error 1');
      const error2 = new Error('Test error 2');

      agentState.addError(agentId, error1);
      agentState.addError(agentId, error2);

      let updated = agentState.getAgent(agentId);
      expect(updated?.errors).toHaveLength(2);
      expect(updated?.errors[0].message).toBe('Test error 1');

      agentState.clearErrors(agentId);

      updated = agentState.getAgent(agentId);
      expect(updated?.errors).toHaveLength(0);
    });
  });

  describe('Workspace Filtering', () => {
    it('should get agents for specific workspace', () => {
      const workspace1 = 'workspace-1';
      const workspace2 = 'workspace-2';

      const agent1 = createMockSession('agent-1', workspace1);
      const agent2 = createMockSession('agent-2', workspace1);
      const agent3 = createMockSession('agent-3', workspace2);

      agentState.setAgent('agent-1', createMockAgentState(agent1));
      agentState.setAgent('agent-2', createMockAgentState(agent2));
      agentState.setAgent('agent-3', createMockAgentState(agent3));

      const workspace1Agents = agentState.findSessions((s) => s.workspaceId === workspace1);
      expect(workspace1Agents).toHaveLength(2);
      expect(workspace1Agents[0].workspaceId).toBe(workspace1);
      expect(workspace1Agents[1].workspaceId).toBe(workspace1);

      const workspace2Agents = agentState.findSessions((s) => s.workspaceId === workspace2);
      expect(workspace2Agents).toHaveLength(1);
      expect(workspace2Agents[0].workspaceId).toBe(workspace2);
    });
  });

  describe('State Export', () => {
    it('should export state for debugging', () => {
      const agent1 = createMockSession('agent-1');
      const agent2 = createMockSession('agent-2');

      agentState.setAgent('agent-1', createMockAgentState(agent1));
      agentState.setAgent('agent-2', createMockAgentState(agent2));
      agentState.startStreaming('agent-1', 'stream-123');

      const stats = agentState.getStats();

      expect(stats.totalAgents).toBe(2);
      expect(stats.totalMessages).toBe(0);
    });
  });
});

// Helper functions
function createMockSession(agentId: string, workspaceId: string = 'workspace-1'): AgentSession {
  return {
    id: agentId,
    sessionId: `session-${agentId}`,
    workspaceId,
    name: `Agent ${agentId}`,
    status: AgentStatus.Idle,
    messages: [],
    startedAt: new Date().toISOString(),
    lastActivity: new Date(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fileChanges: [],
    metadata: {},
    currentTurnNumber: 0,
    model: 'sonnet4.5',
  };
}

function createMockAgentState(session: AgentSession) {
  return {
    session,
    streaming: {
      active: false,
      buffer: '',
      contentBlocks: [],
    },
    ui: {
      isExpanded: false,
      scrollPosition: 0,
      searchQuery: '',
      isAtTop: true,
      isAtBottom: true,
      showScrollToBottom: false,
    },
    errors: [],
    metadata: {},
  };
}

/**
 * Tests for Agent Interaction Tools
 * Verifies agent-to-agent communication via MCP tools
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ToolCall } from '../protocol';

// Mock instances - need to be hoisted
const mockBackendHandler = {
  createAgent: vi.fn(),
  sendBackendInitiatedMessage: vi.fn(),
  listAgents: vi.fn(),
  listAllAgents: vi.fn(),
  getAgent: vi.fn(),
};

const mockAgentPersistence = {
  loadAgent: vi.fn(),
};

const mockEventBus = {
  emitEvent: vi.fn(),
};

const mockSubscriptionService = {
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  setAgentStatus: vi.fn(),
  getAgentStatus: vi.fn(),
  hasPendingEvents: vi.fn(),
  getPendingEventCount: vi.fn(),
};

// Mock the dependencies before importing the tools
vi.mock('$features/agent/main/agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: () => mockBackendHandler,
  },
}));

vi.mock('$features/events/main/workspace-event-bus', () => ({
  getWorkspaceEventBus: () => mockEventBus,
}));

vi.mock('$features/events/main/unified-event-bus', () => ({
  unifiedEventBus: mockEventBus,
}));

vi.mock('$features/events/main/agent-event-subscription.service', () => ({
  getAgentEventSubscriptionService: () => mockSubscriptionService,
}));

vi.mock('$features/events/types', () => ({
  createWorkspaceEvent: vi.fn((type, workspaceId, actor, data) => ({
    id: 'event-123',
    type,
    workspaceId,
    actor,
    data,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('$features/protocol/main/protocol-adapter', () => ({
  protocolAdapter: {
    createNote: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { id: 'created-note-id', title: 'Test Note' } }),
    markAsTask: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    assignAgentToTask: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  },
}));

vi.mock('$features/agent/main/agent-persistence', () => ({
  agentPersistence: mockAgentPersistence,
}));

vi.mock('$shared/types/branded-ids', () => ({
  AgentId: (id: string) => id,
  WorkspaceId: (id: string) => id,
  NoteId: (id: string) => id,
}));

vi.mock('$features/agent/main/specialists.service', () => ({
  resolveSpecialistForAgent: vi.fn((id: string) => {
    const specialists: Record<string, any> = {
      implementor: {
        specialistId: 'implementor',
        specialistName: 'Implementor',
        model: 'gpt5.4',
        behaviorPrompt: 'You are an implementor agent. Focus on the specific task.',
        roleReminder: '',
      },
      verifier: {
        specialistId: 'verifier',
        specialistName: 'Verifier',
        model: 'opus4.5',
        behaviorPrompt: 'You are a verifier agent. Review work thoroughly.',
        roleReminder: '',
      },
    };
    return specialists[id] || null;
  }),
}));

// Import after mocks are set up
import {
  CreateAgentTool,
  SendMessageToAgentTool,
  SubscribeToEventsTool,
  UnsubscribeFromEventsTool,
  ListAgentsTool,
  GetAgentStatusTool,
  ReadAgentConversationTool,
  GetAgentSummaryTool,
} from '../agent-interaction-tools';
import { protocolAdapter } from '$features/protocol/main/protocol-adapter';

describe('Agent Interaction Tools', () => {
  const workspaceId = 'test-workspace-id';
  const workspacePath = '/test/workspace/path';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset protocol adapter mocks after clearAllMocks
    vi.mocked(protocolAdapter.createNote).mockResolvedValue({
      ok: true,
      data: { id: 'created-note-id', title: 'Test Note' },
    });
    vi.mocked(protocolAdapter.markAsTask).mockResolvedValue({ ok: true, data: {} });
    vi.mocked(protocolAdapter.assignAgentToTask).mockResolvedValue({ ok: true, data: {} });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('CreateAgentTool', () => {
    it('should create an agent with required parameters', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
          initialMessage: 'Hello, new agent!',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({
          initialMessage: expect.stringContaining('Hello, new agent!'),
          // createLinkedNote defaults to false, so no taskNoteId is created
          // unless explicitly requested
          metadata: expect.objectContaining({
            createdByAgentId: 'parent-agent-id',
            isBackground: true,
          }),
        }),
      );
    });

    it('should handle creation failure', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      // Return null to indicate failure
      mockBackendHandler.createAgent.mockResolvedValue(null);

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
    });

    it('should require context', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
        },
        // No context provided
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('context');
    });
  });

  describe('SendMessageToAgentTool', () => {
    it('should send a message to another agent', async () => {
      const tool = new SendMessageToAgentTool(workspaceId);

      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: true,
      });

      const call: ToolCall = {
        name: 'send_message_to_agent',
        arguments: {
          agentId: 'target-agent-id',
          message: 'Hello from another agent!',
        },
        context: {
          workspaceId,
          agentId: 'sender-agent-id',
          agentName: 'Sender Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
    });

    it('should emit agent:message:sent event', async () => {
      const tool = new SendMessageToAgentTool(workspaceId);

      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: true,
      });

      const call: ToolCall = {
        name: 'send_message_to_agent',
        arguments: {
          agentId: 'target-agent-id',
          message: 'Test message',
          priority: 'high',
        },
        context: {
          workspaceId,
          agentId: 'sender-agent-id',
          agentName: 'Sender Agent',
          sessionId: 'session-123',
        },
      };

      await tool.execute(call);

      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:message:sent',
          workspaceId,
        }),
      );
    });
  });

  describe('SubscribeToEventsTool', () => {
    it('should subscribe an agent to events', async () => {
      const tool = new SubscribeToEventsTool(workspaceId);

      mockSubscriptionService.subscribe.mockReturnValue('sub-123');

      const call: ToolCall = {
        name: 'subscribe_to_events',
        arguments: {
          eventTypes: ['agent:idle', 'agent:created'],
        },
        context: {
          workspaceId,
          agentId: 'subscriber-agent-id',
          agentName: 'Subscriber Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith(
        'subscriber-agent-id',
        'Subscriber Agent',
        expect.objectContaining({
          eventTypes: ['agent:idle', 'agent:created'],
        }),
      );
    });
  });

  describe('UnsubscribeFromEventsTool', () => {
    it('should unsubscribe an agent from events', async () => {
      const tool = new UnsubscribeFromEventsTool(workspaceId);

      mockSubscriptionService.unsubscribe.mockReturnValue(true);

      const call: ToolCall = {
        name: 'unsubscribe_from_events',
        arguments: {
          subscriptionId: 'sub-123',
        },
        context: {
          workspaceId,
          agentId: 'subscriber-agent-id',
          agentName: 'Subscriber Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockSubscriptionService.unsubscribe).toHaveBeenCalledWith('sub-123');
    });
  });

  describe('ListAgentsTool', () => {
    it('should list all agents in workspace (in-memory + persisted)', async () => {
      const tool = new ListAgentsTool(workspaceId);

      mockBackendHandler.listAllAgents.mockResolvedValue([
        {
          id: 'agent-1',
          name: 'Agent One',
          status: 'idle',
          messages: [{ role: 'user' }, { role: 'assistant' }],
          createdAt: new Date('2025-01-01'),
          lastActivity: new Date('2025-01-02'),
        },
        {
          id: 'agent-2',
          name: 'Agent Two',
          status: 'responding',
          messages: [],
          createdAt: new Date('2025-01-01'),
        },
      ]);

      const call: ToolCall = {
        name: 'list_agents',
        arguments: {},
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;
      expect(text).toContain('Agent One');
      expect(text).toContain('Agent Two');
      expect(mockBackendHandler.listAllAgents).toHaveBeenCalledWith(workspaceId);
    });
  });

  describe('GetAgentStatusTool', () => {
    it('should get status of a specific agent', async () => {
      const tool = new GetAgentStatusTool(workspaceId);

      mockBackendHandler.getAgent.mockResolvedValue({
        id: 'target-agent',
        name: 'Target Agent',
        status: 'idle',
        messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }],
        createdAt: new Date('2025-01-01'),
        lastActivity: new Date('2025-01-02'),
      });

      mockSubscriptionService.hasPendingEvents.mockReturnValue(true);
      mockSubscriptionService.getPendingEventCount.mockReturnValue(5);

      const call: ToolCall = {
        name: 'get_agent_status',
        arguments: {
          agentId: 'target-agent',
        },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;
      expect(text).toContain('Target Agent');
      expect(text).toContain('idle');
    });

    it('should handle non-existent agent', async () => {
      const tool = new GetAgentStatusTool(workspaceId);

      mockBackendHandler.getAgent.mockResolvedValue(null);

      const call: ToolCall = {
        name: 'get_agent_status',
        arguments: {
          agentId: 'non-existent-agent',
        },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
    });
  });

  describe('ReadAgentConversationTool', () => {
    it('should read full conversation history', async () => {
      const tool = new ReadAgentConversationTool(workspaceId);

      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: {
          id: 'target-agent',
          name: 'Target Agent',
          status: 'idle',
          messages: [
            {
              role: 'user',
              timestamp: new Date('2025-01-01').toISOString(),
              contentBlocks: [{ type: 'text', text: 'Hello agent' }],
            },
            {
              role: 'assistant',
              timestamp: new Date('2025-01-01').toISOString(),
              contentBlocks: [{ type: 'text', text: 'Hello! How can I help?' }],
            },
          ],
          metadata: { taskNoteId: 'task-note-123' },
        },
      });

      const call: ToolCall = {
        name: 'read_agent_conversation',
        arguments: {
          agentId: 'target-agent',
        },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;
      expect(text).toContain('Target Agent');
      expect(text).toContain('Hello agent');
      expect(text).toContain('Hello! How can I help?');
      expect(text).toContain('task-note-123');
    });

    it('should read last N messages', async () => {
      const tool = new ReadAgentConversationTool(workspaceId);

      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: {
          id: 'target-agent',
          name: 'Target Agent',
          status: 'idle',
          messages: [
            {
              role: 'user',
              timestamp: new Date('2025-01-01').toISOString(),
              contentBlocks: [{ type: 'text', text: 'First message' }],
            },
            {
              role: 'assistant',
              timestamp: new Date('2025-01-01').toISOString(),
              contentBlocks: [{ type: 'text', text: 'Second message' }],
            },
            {
              role: 'user',
              timestamp: new Date('2025-01-01').toISOString(),
              contentBlocks: [{ type: 'text', text: 'Third message' }],
            },
          ],
        },
      });

      const call: ToolCall = {
        name: 'read_agent_conversation',
        arguments: {
          agentId: 'target-agent',
          lastN: 1,
        },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;
      expect(text).toContain('Third message');
      expect(text).not.toContain('First message');
      expect(text).toContain('Showing: 1 messages');
    });

    it('should handle non-existent agent', async () => {
      const tool = new ReadAgentConversationTool(workspaceId);

      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: false,
        data: null,
      });

      const call: ToolCall = {
        name: 'read_agent_conversation',
        arguments: {
          agentId: 'non-existent-agent',
        },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('not found');
    });
  });

  describe('GetAgentSummaryTool', () => {
    it('should get agent summary with tool calls', async () => {
      const tool = new GetAgentSummaryTool(workspaceId);

      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: {
          id: 'target-agent',
          name: 'Target Agent',
          status: 'idle',
          createdAt: new Date('2025-01-01').toISOString(),
          updatedAt: new Date('2025-01-02').toISOString(),
          messages: [
            {
              role: 'user',
              timestamp: new Date('2025-01-01').toISOString(),
              contentBlocks: [{ type: 'text', text: 'Do something' }],
            },
            {
              role: 'assistant',
              timestamp: new Date('2025-01-01').toISOString(),
              contentBlocks: [
                { type: 'tool_use', name: 'read_file', input: { path: 'test.txt' } },
                { type: 'tool_use', name: 'read_file', input: { path: 'other.txt' } },
                { type: 'tool_use', name: 'write_file', input: { path: 'out.txt' } },
                { type: 'text', text: 'Done! I read files and wrote output.' },
              ],
            },
          ],
          metadata: { taskNoteId: 'task-note-456' },
        },
      });

      const call: ToolCall = {
        name: 'get_agent_summary',
        arguments: {
          agentId: 'target-agent',
        },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;
      expect(text).toContain('Target Agent');
      expect(text).toContain('idle');
      expect(text).toContain('task-note-456');
      expect(text).toContain('read_file: 2 calls');
      expect(text).toContain('write_file: 1 calls');
      expect(text).toContain('Done! I read files and wrote output.');
    });

    it('should handle agent with no messages', async () => {
      const tool = new GetAgentSummaryTool(workspaceId);

      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: {
          id: 'target-agent',
          name: 'Empty Agent',
          status: 'idle',
          messages: [],
        },
      });

      const call: ToolCall = {
        name: 'get_agent_summary',
        arguments: {
          agentId: 'target-agent',
        },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;
      expect(text).toContain('Empty Agent');
      expect(text).toContain('Messages:** 0');
    });

    it('should handle non-existent agent', async () => {
      const tool = new GetAgentSummaryTool(workspaceId);

      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: false,
        data: null,
      });

      const call: ToolCall = {
        name: 'get_agent_summary',
        arguments: {
          agentId: 'non-existent-agent',
        },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('not found');
    });
  });

  describe('CreateAgentTool with Specialists', () => {
    it('should default to implementor specialist when no specialist is specified', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Implementation Agent',
          initialMessage: 'Implement the feature',
          taskNoteId: 'existing-task-note', // Use existing task note to skip note creation
          // No specialist specified - should default to implementor
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      // Should use implementor's model (gpt5.4) and behavior prompt
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Implementation Agent',
        expect.objectContaining({
          model: 'gpt5.4',
          behaviorPrompt: expect.stringContaining('implementor'),
        }),
      );
    });

    it('should use explicitly specified specialist', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Verifier Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Verifier Agent',
          initialMessage: 'Review the implementation',
          specialist: 'verifier',
          taskNoteId: 'existing-task-note', // Use existing task note to skip note creation
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Verifier Agent',
        expect.objectContaining({
          model: 'opus4.5',
          behaviorPrompt: expect.stringContaining('verifier'),
        }),
      );
    });

    it('should allow model override while using specialist behavior prompt', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Custom Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Custom Agent',
          initialMessage: 'Do the work',
          specialist: 'implementor',
          model: 'opus4.5', // Override the model
          taskNoteId: 'existing-task-note', // Use existing task note to skip note creation
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Custom Agent',
        expect.objectContaining({
          model: 'opus4.5', // Override takes precedence
          behaviorPrompt: expect.stringContaining('implementor'),
        }),
      );
    });
  });

  describe('ReportToParentTool', () => {
    // Import the tool for this describe block
    let ReportToParentTool: typeof import('../agent-interaction-tools').ReportToParentTool;

    beforeEach(async () => {
      const module = await import('../agent-interaction-tools');
      ReportToParentTool = module.ReportToParentTool;
    });

    it('should save completion report for delegated agent', async () => {
      const tool = new ReportToParentTool(workspaceId);

      // Mock agent with parent (delegated agent)
      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: {
          id: 'child-agent-id',
          name: 'Child Agent',
          workspaceId,
          metadata: {
            createdByAgentId: 'parent-agent-id',
          },
          messages: [],
        },
      });

      // Mock successful save
      mockAgentPersistence.saveAgent = vi.fn().mockResolvedValue({ success: true });

      const call: ToolCall = {
        name: 'report_to_parent',
        arguments: {
          report: 'I completed the task successfully. All tests pass.',
        },
        context: {
          workspaceId,
          agentId: 'child-agent-id',
          agentName: 'Child Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      const text = (result.content[0] as any).text;
      expect(text).toContain('Completion report saved');
      expect(text).toContain('parent-agent-id');
    });

    it('should reject report from non-delegated agent', async () => {
      const tool = new ReportToParentTool(workspaceId);

      // Mock agent without parent (not delegated)
      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: {
          id: 'standalone-agent-id',
          name: 'Standalone Agent',
          workspaceId,
          metadata: {
            // No createdByAgentId - not a delegated agent
          },
          messages: [],
        },
      });

      const call: ToolCall = {
        name: 'report_to_parent',
        arguments: {
          report: 'This should fail because I have no parent.',
        },
        context: {
          workspaceId,
          agentId: 'standalone-agent-id',
          agentName: 'Standalone Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      const text = (result.content[0] as any).text;
      expect(text).toContain('only available for delegated agents');
    });

    it('should reject empty report', async () => {
      const tool = new ReportToParentTool(workspaceId);

      const call: ToolCall = {
        name: 'report_to_parent',
        arguments: {
          report: '',
        },
        context: {
          workspaceId,
          agentId: 'child-agent-id',
          agentName: 'Child Agent',
          sessionId: 'session-123',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      const text = (result.content[0] as any).text;
      expect(text).toContain('cannot be empty');
    });
  });
});

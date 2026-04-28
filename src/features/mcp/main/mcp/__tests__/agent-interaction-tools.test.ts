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
  getAgentResumability: vi.fn(),
};

const mockNotesService = {
  getNote: vi.fn(),
  assignAgentToTask: vi.fn(),
};

const mockIsAutoCommitEnabled = vi.fn();

const mockAgentPersistence = {
  loadAgent: vi.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// workspace-event-bus and unified-event-bus were deleted; events now dispatched via Redux

vi.mock('$features/events/main/agent-subscription-ops', () => ({
  agentSubscribe: (wsId: string, agentId: string, agentName: string, filter: any) =>
    mockSubscriptionService.subscribe(agentId, agentName, filter),
  agentSubscribeToGroup: (wsId: string, ...rest: any[]) =>
    mockSubscriptionService.subscribeToGroup(...rest),
  agentUnsubscribe: (wsId: string, subscriptionId: string) =>
    mockSubscriptionService.unsubscribe(subscriptionId),
  agentUnsubscribeAll: (wsId: string, agentId: string) =>
    mockSubscriptionService.unsubscribeAll(agentId),
  updateAgentStatus: (wsId: string, agentId: string, status: string) =>
    mockSubscriptionService.setAgentStatus(agentId, status),
  markAgentAsDeleted: (wsId: string, agentId: string) =>
    mockSubscriptionService.markAgentDeleted(agentId),
}));

// Also mock the selectors/store bridge for direct Redux access in list_agents/get_agent_status
vi.mock('../../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
   
  selectAgentStatus: { select: (_state: any, _wsId: string, _agentId: string) => 'idle' },
}));

const mockMainDispatch = vi.fn();
vi.mock('../../../../../store/main/redux-store-bridge', () => ({
  getMainState: () => ({}),
  mainDispatch: (...args: any[]) => mockMainDispatch(...args),
}));

vi.mock('../../../../../store/main/slices/workspace-events/workspace-events-slice', () => ({
  emitWorkspaceEvent: vi.fn((event: any) => ({ type: 'workspace-events/emitWorkspaceEvent', payload: event })),
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
    getNote: vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 'task-note-id', title: 'Task Note', content: 'Do the task' },
    }),
    markAsTask: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    assignAgentToTask: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  },
}));

vi.mock('$features/agent/main/agent-persistence', () => ({
  agentPersistence: mockAgentPersistence,
}));

vi.mock('$features/notes/main/notes.service', () => ({
  notesService: mockNotesService,
}));

vi.mock('$features/workspace/main/workspace-settings.service', () => ({
  isAutoCommitEnabled: (...args: any[]) => mockIsAutoCommitEnabled(...args),
}));

// Fake in-memory backend for ReportToParentTool defense-in-depth sync tests.
const mockBackendSessions = new Map<string, any>();
const mockConsolidatedBackend = {
  getSession: vi.fn((agentId: string) => mockBackendSessions.get(agentId)),
};
vi.mock('$features/agent/main/consolidated-backend.service', () => ({
  ConsolidatedBackendService: {
    getInstance: () => mockConsolidatedBackend,
  },
}));

vi.mock('$shared/types/branded-ids', () => ({
  AgentId: (id: string) => id,
  WorkspaceId: (id: string) => id,
  NoteId: (id: string) => id,
}));

// Controllable stub for the main-side model-pool dispatcher. Tests can override
// the per-provider live model list by calling
// `mockGetCachedModelsForProvider.mockImplementation(...)`; by default each
// provider reports `null` (unavailable), which exercises the cold-cache path.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockGetCachedModelsForProvider = vi.fn(async (_providerId: string) => null as string[] | null);
vi.mock('../../../../../main/utils/model-pool', () => ({
  getCachedModelsForProvider: (providerId: string) => mockGetCachedModelsForProvider(providerId),
}));

vi.mock('$features/agent/main/specialists.service', () => ({
  resolveSpecialistForAgent: vi.fn((id: string) => {
    const specialists: Record<string, any> = {
      implementor: {
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'codex',
        model: 'gpt-5-codex',
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

import { resolveSpecialistForAgent } from '$features/agent/main/specialists.service';

// Import after mocks are set up
import {
  CreateAgentTool,
  DelegateTaskTool,
  SendMessageToAgentTool,
  SubscribeToEventsTool,
  UnsubscribeFromEventsTool,
  ListAgentsTool,
  GetAgentStatusTool,
  ReadAgentConversationTool,
  GetAgentSummaryTool,
  WakeOrCreateTaskAgentTool,
  validateModelOverride,
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
    vi.mocked(protocolAdapter.getNote).mockResolvedValue({
      ok: true,
      data: { id: 'task-note-id', title: 'Task Note', content: 'Do the task' },
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

    it('should propagate specialist provider and preserve a valid override', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
          specialist: 'implementor',
          model: 'codex:gpt-5-codex',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'auggie:gpt5.4',
          provider: 'auggie',
        },
      };

      await tool.execute(call);

      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({
          model: 'codex:gpt-5-codex',
          provider: 'codex',
        }),
      );
    });

    it('should fuzzy-normalize a bare model name to provider:alias before delegating', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
          specialist: 'implementor',
          // Bare alias without provider prefix — matches a codex tier model via
          // fuzzy normalization, so the override should be honored (not dropped).
          model: 'gpt-5.3-codex/high',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          provider: 'auggie',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({
          model: 'codex:gpt-5.3-codex/high',
          provider: 'codex',
        }),
      );
      // Successful fuzzy-normalization is informational, not a warning.
      expect(result.metadata?.modelOverrideWarning).toBeUndefined();
    });

    it('returns a structured warning when a model override cannot be normalized', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
          specialist: 'implementor', // target provider resolves to 'codex'
          // Unknown alias that cannot be normalized to any codex tier model.
          model: 'bogus-model-name',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          provider: 'auggie',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      // The delegating agent must see that its override was rejected.
      expect(result.metadata?.modelOverrideWarning).toMatchObject({
        requested: 'bogus-model-name',
        targetProvider: 'codex',
        reason: 'provider_mismatch',
      });
      const text = (result.content[0] as any).text as string;
      expect(text).toContain('Model override warning');
      expect(text).toContain('bogus-model-name');
      expect(text).toContain('codex');
      expect(text).toContain('specialist config');

      // The child agent still starts — falling back to the specialist's model.
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({
          model: 'gpt-5-codex',
          provider: 'codex',
        }),
      );
    });

    // Regression: bare-string overrides targeting the default provider
    // (auggie) must still be fuzzy-normalized. parseCompoundModelId falls
    // back to the default provider for bare names, so isModelValidForProvider
    // used to short-circuit and return the bare string unchanged, producing
    // an invalid --model value for the child agent.
    const bareNameCases: Array<[string, string]> = [
      ['sonnet', 'auggie:sonnet4.5'],
      ['sonnet-4.5', 'auggie:sonnet4.5'],
      ['claude-sonnet-4-5', 'auggie:sonnet4.5'],
    ];
    for (const [bare, expected] of bareNameCases) {
      it(`fuzzy-normalizes bare "${bare}" to "${expected}" on the default provider`, async () => {
        const tool = new CreateAgentTool(workspaceId, workspacePath);
        vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
          specialistId: 'implementor',
          specialistName: 'Implementor',
          codingAgent: 'auggie',
          model: 'auggie:sonnet4.5',
          behaviorPrompt: 'You are an implementor agent.',
          roleReminder: '',
        });

        mockBackendHandler.createAgent.mockResolvedValue({
          id: 'new-agent-id',
          name: 'Test Agent',
        });

        const call: ToolCall = {
          name: 'create_agent',
          arguments: {
            name: 'Test Agent',
            specialist: 'implementor',
            model: bare,
          },
          context: {
            workspaceId,
            agentId: 'parent-agent-id',
            agentName: 'Parent Agent',
            sessionId: 'session-123',
            provider: 'auggie',
          },
        };

        const result = await tool.execute(call);

        expect(result.isError).toBe(false);
        expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
          workspaceId,
          'Test Agent',
          expect.objectContaining({
            model: expected,
            provider: 'auggie',
          }),
        );
        expect(result.metadata?.modelOverrideWarning).toBeUndefined();
      });
    }

    it('warns and falls back to the specialist default when a bare name cannot be resolved for the default provider', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'auggie:sonnet4.5',
        behaviorPrompt: 'You are an implementor agent.',
        roleReminder: '',
      });

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
          specialist: 'implementor',
          model: 'definitely-not-a-model',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          provider: 'auggie',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(result.metadata?.modelOverrideWarning).toMatchObject({
        requested: 'definitely-not-a-model',
        targetProvider: 'auggie',
        reason: 'provider_mismatch',
      });
      const text = (result.content[0] as any).text as string;
      expect(text).toContain('Model override warning');
      expect(text).toContain('definitely-not-a-model');
      expect(text).toContain('auggie');
      expect(text).toContain('specialist config');
      // Child agent still starts with the specialist's own model.
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({
          model: 'auggie:sonnet4.5',
          provider: 'auggie',
        }),
      );
    });

    // An explicit registered provider prefix in `model` must win over the
    // specialist's configured codingAgent. Here the implementor specialist
    // defaults to codex/gpt-5-codex, but the caller qualifies the override
    // for auggie — the child must spawn on auggie.
    it('honors an explicit registered provider prefix over the specialist codingAgent', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
          specialist: 'implementor', // codingAgent=codex in mock
          model: 'auggie:sonnet4.5',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'auggie:gpt5.4',
          provider: 'auggie',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({
          model: 'auggie:sonnet4.5',
          provider: 'auggie',
        }),
      );
      expect(result.metadata?.modelOverrideWarning).toBeUndefined();
    });

    // An unknown provider prefix must surface a structured
    // `unknown-provider` warning and fall back to the specialist's default
    // model — we never silently rewrite the prefix to a registered provider.
    it('warns with unknown-provider and falls back when the prefix is not a registered provider', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
          specialist: 'implementor', // codingAgent=codex, model=gpt-5-codex
          model: 'coded:gpt-5-codex', // typo'd prefix, not in getAllProviderIds()
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'auggie:gpt5.4',
          provider: 'auggie',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      // Child falls back to the specialist's default provider+model —
      // the unknown prefix is NOT silently treated as a registered provider.
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({
          model: 'gpt-5-codex',
          provider: 'codex',
        }),
      );
      const warning = result.metadata?.modelOverrideWarning as any;
      expect(warning).toMatchObject({
        requested: 'coded:gpt-5-codex',
        targetProvider: 'codex',
        reason: 'unknown-provider',
        unknownProvider: 'coded',
      });
      expect(warning.message).toContain('Unknown provider: coded');
      // The warning text must not enumerate known providers.
      expect(warning.message).not.toContain('codex');
      expect(warning.message).not.toContain('auggie');
      expect(warning.message).not.toContain('opencode');
    });
  });

  describe('DelegateTaskTool', () => {
    it('should propagate specialist provider when delegating by task note', async () => {
      const tool = new DelegateTaskTool(workspaceId, workspacePath);

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'delegated-agent-id',
        name: 'Task Note',
      });

      const call: ToolCall = {
        name: 'delegate_task',
        arguments: {
          taskNoteId: 'task-note-id',
          specialist: 'implementor',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'auggie:gpt5.4',
          provider: 'auggie',
        },
      };

      await tool.execute(call);

      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Task Note',
        expect.objectContaining({
          model: 'gpt-5-codex',
          provider: 'codex',
        }),
      );
    });

    it('should preserve a mapped provider specialist model when delegating', async () => {
      const tool = new DelegateTaskTool(workspaceId, workspacePath);
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'codex',
        model: 'gpt-5-codex',
        modelTier: 'fast',
        behaviorPrompt: 'You are an implementor agent. Focus on the specific task.',
        roleReminder: '',
        defaultAgentType: undefined,
      });

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'delegated-agent-id',
        name: 'Task Note',
      });

      const call: ToolCall = {
        name: 'delegate_task',
        arguments: {
          taskNoteId: 'task-note-id',
          specialist: 'implementor',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'auggie:gpt5.4',
          provider: 'auggie',
        },
      };

      await tool.execute(call);

      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Task Note',
        expect.objectContaining({
          model: 'gpt-5-codex',
          provider: 'codex',
        }),
      );
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

      expect(mockMainDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workspace-events/emitWorkspaceEvent',
          payload: expect.objectContaining({
            type: 'agent:message:sent',
            workspaceId,
          }),
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
      // Should use the current implementor defaults and behavior prompt
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Implementation Agent',
        expect.objectContaining({
          model: 'gpt-5-codex',
          provider: 'codex',
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

    it('should use the effective specialist provider returned by the resolver', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'verifier',
        specialistName: 'Verifier',
        codingAgent: 'codex',
        model: 'codex:gpt-5-codex',
        behaviorPrompt: 'You are a verifier agent. Review work thoroughly.',
        roleReminder: '',
        defaultAgentType: undefined,
      });

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
          taskNoteId: 'existing-task-note',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          provider: 'auggie',
          model: 'auggie:gpt5.4',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Verifier Agent',
        expect.objectContaining({
          provider: 'codex',
          model: 'codex:gpt-5-codex',
        }),
      );
    });

    it('should fall back to the provider default when a dynamic-provider specialist has no concrete model', async () => {
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'opencode',
        model: '',
        modelTier: 'fast',
        behaviorPrompt: 'You are an implementor agent. Focus on the specific task.',
        roleReminder: '',
        defaultAgentType: undefined,
      });

      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'OpenCode Agent',
      });

      const call: ToolCall = {
        name: 'create_agent',
        arguments: {
          name: 'OpenCode Agent',
          initialMessage: 'Implement the fix',
          specialist: 'implementor',
          taskNoteId: 'existing-task-note',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          provider: 'opencode',
          model: 'opencode:claude-sonnet-4.5',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'OpenCode Agent',
        expect.objectContaining({
          provider: 'opencode',
          model: 'default',
        }),
      );
    });

    it('should allow a same-provider model override while using specialist behavior prompt', async () => {
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
          model: 'codex:gpt-5-codex',
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
          model: 'codex:gpt-5-codex',
          provider: 'codex',
          behaviorPrompt: expect.stringContaining('implementor'),
        }),
      );
    });
  });

  describe('CreateAgentTool with live model-list validation', () => {
    // Every test in this block exercises the delegate_task / create_agent path
    // with a controlled live model list supplied via the model-pool dispatcher
    // stub. Together they verify the four branches of validateModelOverride
    // plus the cold-cache fallback.

    beforeEach(() => {
      mockIsAutoCommitEnabled.mockReturnValue(true);
      mockAgentPersistence.loadAgent.mockResolvedValue({ success: false });
      vi.mocked(protocolAdapter.getNote).mockResolvedValue({
        ok: true,
        data: { id: 'existing-task-note', title: 'Existing Task', content: 'x' },
      });
      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-agent-id',
        name: 'Test Agent',
      });
    });

    const baseCall = (modelArg: string): ToolCall => ({
      name: 'create_agent',
      arguments: {
        name: 'Test Agent',
        initialMessage: 'Do the work',
        specialist: 'implementor',
        model: modelArg,
        taskNoteId: 'existing-task-note',
      },
      context: {
        workspaceId,
        agentId: 'parent-agent-id',
        agentName: 'Parent Agent',
        sessionId: 'session-123',
      },
    });

    it('accepts a qualified model already in the live list unchanged', async () => {
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'codex' ? ['gpt-5-codex', 'gpt-5.3-codex/high'] : null,
      );
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('codex:gpt-5-codex'));
      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({ provider: 'codex', model: 'codex:gpt-5-codex' }),
      );
      expect((result.metadata as any)?.modelOverrideWarning).toBeUndefined();
    });

    it('fuzzy-matches a qualified override against the live list', async () => {
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'codex' ? ['gpt-5-codex', 'gpt-5.3-codex/high'] : null,
      );
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      // A prefix that uniquely matches one live-list entry ('gpt-5-cod' only
      // prefix-matches 'gpt-5-codex', not 'gpt-5.3-codex/high') — verifies
      // the fuzzy matcher does the rewrite rather than returning the exact
      // candidate.
      const result = await tool.execute(baseCall('codex:gpt-5-cod'));
      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({ provider: 'codex', model: 'codex:gpt-5-codex' }),
      );
      expect((result.metadata as any)?.modelOverrideWarning).toBeUndefined();
    });

    it('emits unknown_model when a qualified model is not in the live list', async () => {
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'codex' ? ['gpt-5-codex', 'gpt-5.3-codex/high'] : null,
      );
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('codex:gpt-99-unreleased'));
      expect(result.isError).toBe(false);
      // Falls back to the specialist-provided model since the override was discarded.
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({ provider: 'codex', model: 'gpt-5-codex' }),
      );
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toBeDefined();
      expect(warning.reason).toBe('unknown_model');
      expect(warning.requested).toBe('codex:gpt-99-unreleased');
      expect(warning.targetProvider).toBe('codex');
      expect(warning.message).toContain('not in the current model list');
      expect(warning.message).toContain('gpt-5-codex');
    });

    it('fuzzy-matches a bare override against the live list', async () => {
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'codex' ? ['gpt-5-codex', 'gpt-5.3-codex/high'] : null,
      );
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('gpt-5-cod'));
      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({ provider: 'codex', model: 'codex:gpt-5-codex' }),
      );
      expect((result.metadata as any)?.modelOverrideWarning).toBeUndefined();
    });

    it('emits unknown_model when a bare override misses a non-empty live model list', async () => {
      // When the provider reported an authoritative live list, a bare miss
      // must reject with `unknown_model` rather than falling through to the
      // tier table (which would silently accept tier aliases the provider
      // doesn't actually expose).
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'codex' ? ['gpt-5-codex', 'gpt-5.3-codex/high'] : null,
      );
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('definitely-not-a-model'));
      expect(result.isError).toBe(false);
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toBeDefined();
      expect(warning.reason).toBe('unknown_model');
      expect(warning.requested).toBe('definitely-not-a-model');
      expect(warning.targetProvider).toBe('codex');
    });

    it('accepts a qualified override for a non-tier provider when it is in the live list', async () => {
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'opencode' ? ['openai/gpt-5.2', 'anthropic/claude-sonnet-4'] : null,
      );
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'opencode',
        model: 'default',
        behaviorPrompt: 'implementor prompt',
        roleReminder: '',
      });
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('opencode:openai/gpt-5.2'));
      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({ provider: 'opencode', model: 'opencode:openai/gpt-5.2' }),
      );
      expect((result.metadata as any)?.modelOverrideWarning).toBeUndefined();
    });

    it('flags an unknown model for a non-tier provider', async () => {
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'opencode' ? ['openai/gpt-5.2'] : null,
      );
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'opencode',
        model: 'default',
        behaviorPrompt: 'implementor prompt',
        roleReminder: '',
      });
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('opencode:made/up-model'));
      expect(result.isError).toBe(false);
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toBeDefined();
      expect(warning.reason).toBe('unknown_model');
      expect(warning.targetProvider).toBe('opencode');
      expect(warning.message).toContain('openai/gpt-5.2');
    });

    it('passes cold-cache overrides through tier-table validation without spurious warnings', async () => {
      // Default mock already returns `null` for every provider — exercises the
      // cold-cache path. Pre-Wave-6 behavior must be preserved: a qualified
      // same-provider override is accepted as-is and no warning is emitted.
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('codex:gpt-99-unreleased'));
      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({ provider: 'codex', model: 'codex:gpt-99-unreleased' }),
      );
      expect((result.metadata as any)?.modelOverrideWarning).toBeUndefined();
    });

    it('falls through to tier-table normalization for a bare auggie alias when the live list is unavailable', async () => {
      // Regression: when the auggie CLI is uninstalled or its model list
      // can't be parsed, `getCachedModelsForProvider('auggie')` must return
      // `null` (not `[]`) so the validator treats the list as unavailable
      // and falls back to tier-table normalization. The bare alias
      // `sonnet4.5` is then accepted and normalized to `auggie:sonnet4.5`
      // with no spurious warning.
      mockGetCachedModelsForProvider.mockImplementation(async () => null);
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'auggie:sonnet4.5',
        behaviorPrompt: 'implementor prompt',
        roleReminder: '',
      });
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('sonnet4.5'));
      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({ provider: 'auggie', model: 'auggie:sonnet4.5' }),
      );
      expect((result.metadata as any)?.modelOverrideWarning).toBeUndefined();
    });

    it('rejects a qualified override when the provider returns an empty live model list', async () => {
      // An empty array (as opposed to `null`) means the provider answered
      // successfully with zero usable models — every candidate must be
      // rejected with `unknown_model` rather than falling through to the
      // tier table.
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'opencode' ? [] : null,
      );
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'opencode',
        model: 'default',
        behaviorPrompt: 'implementor prompt',
        roleReminder: '',
      });
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('opencode:openai/gpt-5.2'));
      expect(result.isError).toBe(false);
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toBeDefined();
      expect(warning.reason).toBe('unknown_model');
      expect(warning.requested).toBe('opencode:openai/gpt-5.2');
      expect(warning.targetProvider).toBe('opencode');
      // Falls back to the specialist-provided model (`default`) since the
      // override was discarded.
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Test Agent',
        expect.objectContaining({ provider: 'opencode', model: 'default' }),
      );
    });

    it('rejects a bare override when the non-empty live list has no match (no tier-table pass-through)', async () => {
      // Non-empty live list is authoritative: a bare alias that would have
      // resolved via the tier table (e.g. `sonnet4.5` → auggie balanced)
      // must be rejected outright when the live list lacks a match.
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'auggie' ? ['sonnet4.6', 'opus4.7'] : null,
      );
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'haiku4.5',
        behaviorPrompt: 'implementor prompt',
        roleReminder: '',
      });
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute(baseCall('sonnet4.5'));
      expect(result.isError).toBe(false);
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toBeDefined();
      expect(warning.reason).toBe('unknown_model');
      expect(warning.requested).toBe('sonnet4.5');
      expect(warning.targetProvider).toBe('auggie');
      // Result should NOT contain the tier-table pass-through (`sonnet4.5`);
      // instead the discarded override falls back to the specialist model.
      const createArgs = mockBackendHandler.createAgent.mock.calls[0]?.[2];
      expect(createArgs.model).not.toBe('sonnet4.5');
      expect(createArgs.model).not.toBe('auggie:sonnet4.5');
      expect(createArgs).toEqual(
        expect.objectContaining({ provider: 'auggie', model: 'haiku4.5' }),
      );
    });

    it('spawns the child on the explicit-prefix provider with its default — never the parent provider model — when the override is rejected', async () => {
      // Parent runs on auggie with `auggie:sonnet4.6`. Delegation sets
      // `model='opencode:typo'` (explicit opencode prefix). The live list for
      // opencode rejects `typo`, so the validator produces `unknown_model`.
      // The child must spawn on opencode with a provider-appropriate default
      // (`'default'` for dynamic providers), NOT inherit the auggie parent
      // model ID.
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'opencode' ? ['anthropic/claude-sonnet-4'] : null,
      );
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'auggie:sonnet4.6',
        behaviorPrompt: 'implementor prompt',
        roleReminder: '',
      });
      const tool = new CreateAgentTool(workspaceId, workspacePath);
      const result = await tool.execute({
        name: 'create_agent',
        arguments: {
          name: 'Test Agent',
          initialMessage: 'Do the work',
          specialist: 'implementor',
          model: 'opencode:typo',
          taskNoteId: 'existing-task-note',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'auggie:sonnet4.6',
          provider: 'auggie',
        } as any,
      });
      expect(result.isError).toBe(false);
      const createArgs = mockBackendHandler.createAgent.mock.calls[0]?.[2];
      expect(createArgs.provider).toBe('opencode');
      // Critical assertion: the child must NOT have been spawned with the
      // parent's auggie model ID despite the validator rejection.
      expect(createArgs.model).not.toBe('auggie:sonnet4.6');
      expect(createArgs.model).toBe('default');
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toBeDefined();
      expect(warning.reason).toBe('unknown_model');
      expect(warning.targetProvider).toBe('opencode');
      expect(warning.requested).toBe('opencode:typo');
    });
  });

  describe('validateModelOverride synthetic default alias', () => {
    // Guards the `getCachedClaudeCodeModels` merge: the claude-code ACP probe
    // does not report the curated `default` alias, so the dispatcher must
    // merge it into the live list before the validator sees it. The mock
    // below mirrors what the post-fix dispatcher returns for a raw live
    // list of `['claude-sonnet-4-5-20250929', 'claude-haiku-4-5']` — the
    // two real model IDs plus the synthetic `default` alias appended by
    // `getCachedClaudeCodeModels`. Without the merge, this path rejects
    // `claude-code:default` with `unknown_model` whenever ACP listing
    // succeeds with a non-empty live list.
    it('accepts claude-code:default when the dispatcher surfaces the merged alias', async () => {
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'claude-code'
          ? ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5', 'default']
          : null,
      );
      const result = await validateModelOverride('claude-code:default', 'claude-code');
      expect(result).toEqual({ model: 'claude-code:default' });
      expect(result.warning).toBeUndefined();
    });
  });

  describe('ReportToParentTool', () => {
    // Import the tool for this describe block
    let ReportToParentTool: typeof import('../agent-interaction-tools').ReportToParentTool;

    beforeEach(async () => {
      const module = await import('../agent-interaction-tools');
      ReportToParentTool = module.ReportToParentTool;
      mockBackendSessions.clear();
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

    it('should persist to disk AND sync the in-memory backend session', async () => {
      const tool = new ReportToParentTool(workspaceId);

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

      const saveAgentMock = vi.fn().mockResolvedValue({ success: true });
      mockAgentPersistence.saveAgent = saveAgentMock;

      // Seed an in-memory session so the tool's sync path has something to update.
      mockBackendSessions.clear();
      mockConsolidatedBackend.getSession.mockClear();
      const fakeSession: { metadata?: Record<string, unknown> } = {
        metadata: { specialist: 'implementor' },
      };
      mockBackendSessions.set('child-agent-id', fakeSession);

      const call: ToolCall = {
        name: 'report_to_parent',
        arguments: {
          report: '  Finished the work. Tests pass.  ',
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

      // (a) disk save happened with trimmed report + timestamp
      expect(saveAgentMock).toHaveBeenCalledTimes(1);
      const savedAgent = saveAgentMock.mock.calls[0][0];
      expect(savedAgent.metadata.completionReport).toBe('Finished the work. Tests pass.');
      expect(typeof savedAgent.metadata.completionReportTimestamp).toBe('string');

      // (b) in-memory session now has both fields (and preserves prior metadata)
      expect(mockConsolidatedBackend.getSession).toHaveBeenCalledWith('child-agent-id');
      expect(fakeSession.metadata).toMatchObject({
        specialist: 'implementor',
        completionReport: 'Finished the work. Tests pass.',
        completionReportTimestamp: savedAgent.metadata.completionReportTimestamp,
      });
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

  describe('WakeOrCreateTaskAgentTool model validation against wakeProvider', () => {
    beforeEach(() => {
      mockIsAutoCommitEnabled.mockReturnValue(true);
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-note-id',
          title: 'Do the thing',
          metadata: {
            task: {
              assignedAgentIds: ['previous-agent-id'],
            },
          },
        },
      });
      mockNotesService.assignAgentToTask.mockResolvedValue({ ok: true });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        status: 'not_found',
        canWake: false,
        agentData: {
          metadata: { specialist: 'implementor' },
        },
      });
      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-task-agent-id',
        name: 'Task: Do the thing',
      });
    });

    it('normalizes a bare model against the wake provider (specialist codingAgent)', async () => {
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'auggie:opus4.7',
        behaviorPrompt: '',
        roleReminder: '',
      });

      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);
      const call: ToolCall = {
        name: 'wake_or_create_task_agent',
        arguments: {
          taskNoteId: 'task-note-id',
          contextMessage: 'Dependencies ready, please proceed.',
          model: 'sonnet-4.5',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'claude-code:sonnet',
          provider: 'claude-code',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        expect.any(String),
        expect.objectContaining({
          provider: 'auggie',
          model: 'auggie:sonnet4.5',
        }),
      );
      expect((result.metadata as any)?.modelOverrideWarning).toBeUndefined();
    });

    it('emits a provider_mismatch warning when the override cannot be normalized for the wake provider', async () => {
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'auggie:opus4.7',
        behaviorPrompt: '',
        roleReminder: '',
      });

      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);
      const call: ToolCall = {
        name: 'wake_or_create_task_agent',
        arguments: {
          taskNoteId: 'task-note-id',
          contextMessage: 'Dependencies ready, please proceed.',
          model: 'definitely-not-a-model',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'claude-code:sonnet',
          provider: 'claude-code',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        expect.any(String),
        expect.objectContaining({
          provider: 'auggie',
          model: 'auggie:opus4.7',
        }),
      );
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toBeDefined();
      expect(warning.requested).toBe('definitely-not-a-model');
      expect(warning.targetProvider).toBe('auggie');
      expect(warning.reason).toBe('provider_mismatch');
      const text = (result.content[0] as any).text as string;
      expect(text).toContain('Model override warning');
      expect(text).toContain('definitely-not-a-model');
      expect(text).toContain('auggie');
      expect(text).toContain('specialist config');
    });

    it('emits an unknown_model warning when a qualified override is missing from the wake provider live list', async () => {
      // Live list for auggie explicitly excludes the requested model, so the
      // wake path must discard the override and surface the unknown_model
      // reason — this closes the prior silent-acceptance path.
      mockGetCachedModelsForProvider.mockImplementation(async (provider) =>
        provider === 'auggie' ? ['sonnet4.6', 'haiku4.5', 'opus4.7'] : null,
      );
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'auggie:opus4.7',
        behaviorPrompt: '',
        roleReminder: '',
      });

      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);
      const call: ToolCall = {
        name: 'wake_or_create_task_agent',
        arguments: {
          taskNoteId: 'task-note-id',
          contextMessage: 'Dependencies ready, please proceed.',
          model: 'auggie:sonnet-9000',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'claude-code:sonnet',
          provider: 'claude-code',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      // Override discarded → fall back to previous specialist's model.
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        expect.any(String),
        expect.objectContaining({ provider: 'auggie', model: 'auggie:opus4.7' }),
      );
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toBeDefined();
      expect(warning.reason).toBe('unknown_model');
      expect(warning.requested).toBe('auggie:sonnet-9000');
      expect(warning.targetProvider).toBe('auggie');
      expect(warning.message).toContain('not in the current model list');
      expect(warning.message).toContain('sonnet4.6');
      const text = (result.content[0] as any).text as string;
      expect(text).toContain('Model override warning');
      expect(text).toContain('auggie:sonnet-9000');
    });

    // An explicit registered provider prefix in the `model` argument must
    // override the previous specialist's codingAgent when computing the wake
    // provider, and validation must run against the explicit provider.
    it('honors an explicit registered provider prefix over the previous specialist codingAgent', async () => {
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'auggie:opus4.7',
        behaviorPrompt: '',
        roleReminder: '',
      });

      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);
      const call: ToolCall = {
        name: 'wake_or_create_task_agent',
        arguments: {
          taskNoteId: 'task-note-id',
          contextMessage: 'Dependencies ready, please proceed.',
          model: 'codex:gpt-5-codex',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'claude-code:sonnet',
          provider: 'claude-code',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        expect.any(String),
        expect.objectContaining({
          provider: 'codex',
          model: 'codex:gpt-5-codex',
        }),
      );
      expect((result.metadata as any)?.modelOverrideWarning).toBeUndefined();
    });

    // An unknown prefix in the wake path must surface the structured
    // `unknown-provider` warning and fall back to the previous specialist's
    // model on the previous specialist's provider.
    it('warns with unknown-provider and falls back when the wake-path prefix is not registered', async () => {
      vi.mocked(resolveSpecialistForAgent).mockReturnValueOnce({
        specialistId: 'implementor',
        specialistName: 'Implementor',
        codingAgent: 'auggie',
        model: 'auggie:opus4.7',
        behaviorPrompt: '',
        roleReminder: '',
      });

      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);
      const call: ToolCall = {
        name: 'wake_or_create_task_agent',
        arguments: {
          taskNoteId: 'task-note-id',
          contextMessage: 'Dependencies ready, please proceed.',
          model: 'coded:gpt-5-codex',
        },
        context: {
          workspaceId,
          agentId: 'parent-agent-id',
          agentName: 'Parent Agent',
          sessionId: 'session-123',
          model: 'claude-code:sonnet',
          provider: 'claude-code',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        expect.any(String),
        expect.objectContaining({ provider: 'auggie', model: 'auggie:opus4.7' }),
      );
      const warning = (result.metadata as any)?.modelOverrideWarning;
      expect(warning).toMatchObject({
        requested: 'coded:gpt-5-codex',
        targetProvider: 'auggie',
        reason: 'unknown-provider',
        unknownProvider: 'coded',
      });
      expect(warning.message).toContain('Unknown provider: coded');
      expect(warning.message).not.toContain('auggie');
      expect(warning.message).not.toContain('codex');
    });
  });
});

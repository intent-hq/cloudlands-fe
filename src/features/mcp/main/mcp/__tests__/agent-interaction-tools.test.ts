/**
 * Tests for Agent Interaction Tools
 * Verifies agent-to-agent communication via MCP tools
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
} from 'vitest';
import type { ToolCall } from '../protocol';

// Mock instances - need to be hoisted.
//
// C1d-6: `agent-interaction-tools.ts` no longer imports the FE
// `AgentBackendHandler`; its write/wake paths hit the daemon directly via
// `agent.create` / `agent.sendMessage` / `agent.getSession` (PROTOCOL.md
// §5.5). These per-method spies remain the seam every test asserts against —
// the `installWriteWakeWireCompat()` helper below wires them into
// `mockRequest` so existing `mockBackendHandler.createAgent.mockResolvedValue`
// style fixtures keep describing the same behaviour without hand-editing 80+
// legacy assertions.
const mockBackendHandler = {
  createAgent: vi.fn(),
  sendBackendInitiatedMessage: vi.fn(),
  handleQueueMessage: vi.fn(),
  listAgents: vi.fn(),
  listAllAgents: vi.fn(),
  getAgent: vi.fn(),
  getAgentResumability: vi.fn(),
};

const mockNotesService = vi.hoisted(() => ({
  getNote: vi.fn(),
  assignAgentToTask: vi.fn(),
  removeAgentFromAllTasks: vi.fn(),
}));

const mockIsAutoCommitEnabled = vi.fn();

// P3-1: the mcp agent-session tools call the daemon via getBackendClient()
// (PROTOCOL.md §5.5) instead of agentPersistence.*. `mockRequest` is the
// wire-contract seam every test asserts against below.
const mockRequest = vi.hoisted(() => vi.fn());

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockEventBus = {
  emitEvent: vi.fn(),
};

const mockSubscriptionService = {
  subscribe: vi.fn(),
  subscribeToGroup: vi.fn(),
  unsubscribe: vi.fn(),
  unsubscribeAll: vi.fn(),
  markAgentDeleted: vi.fn(),
  setAgentStatus: vi.fn(),
  getAgentStatus: vi.fn(),
  hasPendingEvents: vi.fn(),
  getPendingEventCount: vi.fn(),
};

const makeEmptyWorkspaceSubscriptionState = () => ({
  subscriptions: {},
  agentQueues: {},
  agentStatuses: {},
  delegationGroups: {},
  firedOneShotSubscriptions: [],
  deliveryStats: {
    totalDeliveries: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    timeoutDeliveries: 0,
    droppedEvents: 0,
    lastDeliveryTime: null,
    lastFailureTime: null,
  },
  deletedAgents: {},
});

const mockSelectorState = vi.hoisted(() => ({
  workspaceSubscriptionState: {
    subscriptions: {},
    agentQueues: {},
    agentStatuses: {},
    delegationGroups: {},
    firedOneShotSubscriptions: [],
    deliveryStats: {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      timeoutDeliveries: 0,
      droppedEvents: 0,
      lastDeliveryTime: null,
      lastFailureTime: null,
    },
    deletedAgents: {},
  } as any,
}));

// C1d-6: `agent-interaction-tools.ts` no longer imports the FE
// `AgentBackendHandler`, so the previous `vi.mock('$features/agent/main/
// agent-backend-handler.service', ...)` binding is gone. The write/wake seam
// is now the daemon wire (`getBackendClient().request`), which
// `installWriteWakeWireCompat()` below wires onto the `mockBackendHandler.*`
// spies.

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
  getDelegationGroupCompletionSummary: (group: any) => {
    const expectedIds = new Set(group.expectedAgentIds);
    const doneIds = new Set<string>();
    for (const agentId of group.completedAgentIds) {
      if (expectedIds.has(agentId)) doneIds.add(agentId);
    }
    for (const agentId of group.deletedAgentIds) {
      if (expectedIds.has(agentId)) doneIds.add(agentId);
    }
    const expectedCount = expectedIds.size;
    const doneCount = doneIds.size;
    return {
      doneCount,
      expectedCount,
      isComplete:
        expectedCount > 0 && (group.awaitMode === 'any' ? doneCount >= 1 : doneCount >= expectedCount),
    };
  },
  selectWorkspaceSubscriptionState: {
    select: () => mockSelectorState.workspaceSubscriptionState,
  },
  selectAgentStatus: {
    select: (_state: any, _wsId: string, agentId: string) =>
      mockSelectorState.workspaceSubscriptionState.agentStatuses[agentId] ?? 'idle',
  },
}));

const mockMainDispatch = vi.fn();
vi.mock('../../../../../store/main/redux-store-bridge', () => ({
  getMainState: () => ({}),
  mainDispatch: (...args: any[]) => mockMainDispatch(...args),
}));

vi.mock('../../../../../store/main/slices/workspace-events/workspace-events-slice', () => ({
  emitWorkspaceEvent: vi.fn((event: any) => ({ type: 'workspace-events/emitWorkspaceEvent', payload: event })),
  workspaceEventAccepted: vi.fn((event: any) => ({
    type: 'workspace-events/workspaceEventAccepted',
    payload: event,
  })),
  workspaceEventsReducer: vi.fn((state = { byWorkspaceId: {} }) => state),
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

vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
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
  createAgentId: (id: string) => id,
  createWorkspaceId: (id: string) => id,
  isValidAgentId: (id: string) => typeof id === 'string' && id.length > 0,
  isValidWorkspaceId: (id: string) => typeof id === 'string' && id.length > 0,
  isValidNoteId: (id: string) => typeof id === 'string' && id.length > 0,
  CHIEF_WORKSPACE_ID: 'chief',
}));

// Controllable stub for the main-side model-pool dispatcher. Tests can override
// the per-provider live model list by calling
// `mockGetCachedModelsForProvider.mockImplementation(...)`; by default each
// provider reports `null` (unavailable), which exercises the cold-cache path.
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
  SendMessageToTaskAgentTool,
  SubscribeToEventsTool,
  UnsubscribeFromEventsTool,
  ListAgentsTool,
  GetAgentStatusTool,
  GetAgentDiagnosticsTool,
  ReadAgentConversationTool,
  GetAgentSummaryTool,
  WakeOrCreateTaskAgentTool,
  validateModelOverride,
} from '../agent-interaction-tools';
import { protocolAdapter } from '$features/protocol/main/protocol-adapter';

// Translate the pre-rewire { success, data } shape into wire responses for
// `agent.get` / `agent.getConversation` so the individual test bodies stay
// legible. Tests that need to assert the exact JSON-RPC method + params
// still inspect `mockRequest` directly.
function stubDaemonAgentLoad(response: {
  success: boolean;
  data?: any;
  error?: string;
}) {
  mockRequest.mockImplementation(async (method: string, params: any) => {
    if (method === 'agent.get') {
      if (!response.success || !response.data) {
        throw new Error(response.error || 'agent not found');
      }
      return { agent: response.data };
    }
    if (method === 'agent.getConversation') {
      const messages = response.success ? response.data?.messages ?? [] : [];
      return { messages };
    }
    if (method === 'agent.reportToParent') {
      // Daemon persists the child completion report and emits `agent:updated`;
      // the stub just acknowledges (PROTOCOL.md §5.5).
      return { success: true };
    }
    // C1d-6: write/wake methods (`agent.create` / `agent.sendMessage` /
    // `agent.getSession`) fall through to the mockBackendHandler-bridged
    // compat so tests that use this stub still exercise create/wake paths.
    const compat = await invokeWriteWakeWireCompat(method, params);
    if (compat !== undefined) return compat;
    throw new Error(`unhandled RPC in stubDaemonAgentLoad: ${method}`);
  });
}

// C1d-5: `list_agents` / `get_agent_diagnostics` read via daemon-primary
// `agent.list` (PROTOCOL.md §5.5); the diagnostics tool additionally falls back
// to `agent.get` for a focused non-active agent. This helper stubs both in one
// mockImplementation so tests describe the daemon wire contract directly.
function stubDaemonAgentList(agents: any[], agentDetails: Record<string, any> = {}) {
  mockRequest.mockImplementation(async (method: string, params: any) => {
    if (method === 'agent.list') {
      return { agents };
    }
    if (method === 'agent.get') {
      const agent = agentDetails[params?.agentId as string];
      if (!agent) {
        throw new Error('agent not found');
      }
      return { agent };
    }
    // C1d-6: same write/wake fall-through as `stubDaemonAgentLoad`.
    const compat = await invokeWriteWakeWireCompat(method, params);
    if (compat !== undefined) return compat;
    throw new Error(`unhandled RPC in stubDaemonAgentList: ${method}`);
  });
}

// C1d-6: bridge the `mockBackendHandler.*` spies onto the daemon wire seam
// (`getBackendClient().request`). Each translation mirrors the request/response
// contract in PROTOCOL.md §5.5 so the pre-C1d-6 test bodies keep asserting
// their original request shapes and configuring their original response
// fixtures — the write/wake seam simply moves from an FE handler singleton to
// the JSON-RPC transport.
//
// - `agent.create`: unwraps the wire params, invokes `mockBackendHandler.
//   createAgent(workspaceId, name, legacyOptions)` (hoisting metadata fields
//   the retired handler used to accept at the top level), and wraps the
//   `{ id, name }` return in `{ agent }`.
// - `agent.sendMessage`: routes through `mockBackendHandler.
//   sendBackendInitiatedMessage`. `ALREADY_STREAMING` collapses onto the new
//   `{ queued: true, messageId }` wire response (the daemon auto-queues), so
//   the queued-branch scenario also invokes `mockBackendHandler.
//   handleQueueMessage` for its `queuedMessage.id`. `AGENT_DELETED` /
//   `AGENT_NOT_FOUND` / other legacy errorCodes surface as JSON-RPC errors
//   with matching text.
// - `agent.getSession`: routes through `mockBackendHandler.
//   getAgentResumability`. `status: 'not_found'` throws; `running` returns a
//   session with `isStreaming: true`, `resumable` returns a session with idle
//   flags — matching `daemonGetResumability`'s derivation in
//   `agent-interaction-tools.ts`.
async function invokeWriteWakeWireCompat(
  method: string,
  params: any,
): Promise<any | undefined> {
  if (method === 'agent.create') {
    const md = params?.metadata ?? {};
    const legacyOptions = {
      workspacePath: params?.workspacePath,
      model: params?.model,
      provider: params?.provider,
      agentType: params?.agentType,
      initialMessage: md.initialMessage,
      behaviorPrompt: md.behaviorPrompt,
      specialistName: md.specialistName,
      roleReminder: md.roleReminder,
      contextReferences: md.contextReferences,
      imageBlocks: md.imageBlocks,
      metadata: md,
    };
    const agent = await mockBackendHandler.createAgent(
      params?.workspaceId,
      params?.name,
      legacyOptions,
    );
    return { agent: agent ?? null };
  }
  if (method === 'agent.sendMessage') {
    const legacyRes = await mockBackendHandler.sendBackendInitiatedMessage({
      sessionId: params?.agentId,
      workspaceId: params?.workspaceId,
      message: params?.content,
      messageMetadata: params?.messageMetadata,
    });
    if (legacyRes?.success) {
      return { success: true, queued: false };
    }
    if (legacyRes?.errorCode === 'ALREADY_STREAMING') {
      const queueRes = await mockBackendHandler.handleQueueMessage(null, {
        agentId: params?.agentId,
        content: params?.content,
        workspaceId: params?.workspaceId,
      });
      if (queueRes?.success) {
        return {
          success: true,
          queued: true,
          messageId: queueRes.queuedMessage?.id,
        };
      }
      throw new Error(queueRes?.error || 'queue unavailable');
    }
    if (legacyRes?.errorCode === 'AGENT_DELETED') {
      throw new Error(legacyRes.error || 'agent has been deleted');
    }
    if (legacyRes?.errorCode === 'AGENT_NOT_FOUND') {
      throw new Error(legacyRes.error || 'agent not found');
    }
    throw new Error(legacyRes?.error || 'send failed');
  }
  if (method === 'agent.getSession') {
    const res = await mockBackendHandler.getAgentResumability(
      params?.agentId,
      params?.workspaceId,
    );
    if (!res || res.status === 'not_found') {
      throw new Error('agent not found');
    }
    return {
      session: {
        ...(res.agentData || {}),
        isStreaming: res.status === 'running',
        isResponding: false,
      },
    };
  }
  return undefined;
}

describe('Agent Interaction Tools', () => {
  const workspaceId = 'test-workspace-id';
  const workspacePath = '/test/workspace/path';

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockReset();
    // Default wire routing: forward daemon write/wake calls through the
    // `mockBackendHandler.*` spies (see `invokeWriteWakeWireCompat`). Reads
    // like `agent.get` / `agent.getConversation` / `agent.reportToParent` are
    // still resolved through individual test helpers (e.g. `stubDaemonAgentLoad`)
    // or the per-describe-block `mockRequest.mockImplementation` overrides.
    mockRequest.mockImplementation(async (method: string, params: any) => {
      const compat = await invokeWriteWakeWireCompat(method, params);
      if (compat !== undefined) return compat;
      if (method === 'agent.get') return { agent: null };
      return {};
    });
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
    mockSelectorState.workspaceSubscriptionState = makeEmptyWorkspaceSubscriptionState();
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
    it('issues agent.list({ workspaceId }) and projects AgentLite entries', async () => {
      const tool = new ListAgentsTool(workspaceId);

      // C1d-5: `list_agents` reads daemon-primary (PROTOCOL.md §5.5
      // `agent.list`); AgentLite entries carry messageCount + activity flags.
      mockRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.list') {
          return {
            agents: [
              {
                id: 'agent-1',
                name: 'Agent One',
                status: 'idle',
                messageCount: 2,
                isStreaming: false,
                isResponding: false,
                createdAt: '2025-01-01T00:00:00.000Z',
                lastActivity: '2025-01-02T00:00:00.000Z',
              },
              {
                id: 'agent-2',
                name: 'Agent Two',
                status: 'responding',
                messageCount: 0,
                isStreaming: false,
                isResponding: true,
                createdAt: '2025-01-01T00:00:00.000Z',
              },
            ],
          };
        }
        throw new Error(`unexpected ${method}`);
      });

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
      expect(mockRequest).toHaveBeenCalledWith('agent.list', { workspaceId });
      const infos = result.metadata?.agents as any[];
      expect(infos.find((a) => a.id === 'agent-1')).toMatchObject({
        messageCount: 2,
        presentInBackend: false,
      });
      expect(infos.find((a) => a.id === 'agent-2')).toMatchObject({
        messageCount: 0,
        presentInBackend: true,
      });
    });
  });

  describe('GetAgentStatusTool', () => {
    // C1d-5: `get_agent_status` reads daemon-primary (PROTOCOL.md §5.5
    // `agent.getSession`); a single full-AgentSession call replaces the
    // handler-first fallback chain and derives `presentInBackend` from the
    // persisted `isStreaming`/`isResponding` flags.
    it('issues agent.getSession({ agentId, workspaceId }) and returns active session details', async () => {
      const tool = new GetAgentStatusTool(workspaceId);

      mockRequest.mockImplementation(async (method: string, params: any) => {
        if (method === 'agent.getSession') {
          expect(params).toEqual({ agentId: 'target-agent', workspaceId });
          return {
            session: {
              id: 'target-agent',
              name: 'Target Agent',
              status: 'idle',
              messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }],
              isStreaming: false,
              isResponding: true,
              createdAt: '2025-01-01T00:00:00.000Z',
              lastActivity: '2025-01-02T00:00:00.000Z',
            },
          };
        }
        throw new Error(`unexpected ${method}`);
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
      expect(text).toContain('Backend session: active');
      expect(result.metadata?.agent).toMatchObject({
        id: 'target-agent',
        presentInBackend: true,
        messageCount: 3,
      });
      expect(mockRequest).toHaveBeenCalledWith('agent.getSession', {
        agentId: 'target-agent',
        workspaceId,
      });
    });

    it('returns an error when agent.getSession yields no session', async () => {
      const tool = new GetAgentStatusTool(workspaceId);

      mockRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.getSession') {
          throw new Error('agent not found');
        }
        throw new Error(`unexpected ${method}`);
      });

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
      expect((result.content[0] as any).text).toContain('non-existent-agent');
    });

    it('reports persisted-only when session flags are false', async () => {
      const tool = new GetAgentStatusTool(workspaceId);

      mockRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.getSession') {
          return {
            session: {
              id: 'persisted-agent',
              name: 'Persisted Agent',
              status: 'idle',
              messages: [{ role: 'user' }],
              isStreaming: false,
              isResponding: false,
              createdAt: '2026-06-19T04:00:00.000Z',
            },
          };
        }
        throw new Error(`unexpected ${method}`);
      });

      const result = await tool.execute({
        name: 'get_agent_status',
        arguments: { agentId: 'persisted-agent' },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain('Backend session: persisted only');
      expect(result.metadata?.agent).toMatchObject({
        id: 'persisted-agent',
        presentInBackend: false,
        messageCount: 1,
      });
    });

    it('derives messageCount from metadata when messages array is absent', async () => {
      const tool = new GetAgentStatusTool(workspaceId);

      mockRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.getSession') {
          return {
            session: {
              id: 'summary-only-agent',
              name: 'Summary Only Agent',
              status: 'idle',
              metadata: { messageCount: 1 },
              isStreaming: false,
              isResponding: false,
              createdAt: '2026-06-19T04:00:00.000Z',
            },
          };
        }
        throw new Error(`unexpected ${method}`);
      });

      const result = await tool.execute({
        name: 'get_agent_status',
        arguments: { agentId: 'summary-only-agent' },
        context: {
          workspaceId,
          agentId: 'requester-agent-id',
          agentName: 'Requester Agent',
          sessionId: 'session-123',
        },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect((result.content[0] as any).text).toContain('Backend session: persisted only');
      expect(result.metadata?.agent).toMatchObject({
        id: 'summary-only-agent',
        presentInBackend: false,
        messageCount: 1,
      });
    });
  });

  describe('ReadAgentConversationTool', () => {
    it('should read full conversation history', async () => {
      const tool = new ReadAgentConversationTool(workspaceId);

      stubDaemonAgentLoad({
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

      stubDaemonAgentLoad({
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

      stubDaemonAgentLoad({
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

      stubDaemonAgentLoad({
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

      stubDaemonAgentLoad({
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

      stubDaemonAgentLoad({
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
      stubDaemonAgentLoad({ success: false });
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
      stubDaemonAgentLoad({
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

      stubDaemonAgentLoad({
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

      // (a) The daemon persist happened via agent.reportToParent with the
      // trimmed report (PROTOCOL.md §5.5). The daemon owns the timestamp.
      const rtpCall = mockRequest.mock.calls.find(
        (call) => call[0] === 'agent.reportToParent',
      );
      expect(rtpCall).toBeDefined();
      expect(rtpCall?.[1]).toEqual({ report: 'Finished the work. Tests pass.' });

      // (b) in-memory session now has both fields (and preserves prior metadata)
      expect(mockConsolidatedBackend.getSession).toHaveBeenCalledWith('child-agent-id');
      expect(fakeSession.metadata).toMatchObject({
        specialist: 'implementor',
        completionReport: 'Finished the work. Tests pass.',
        completionReportTimestamp: expect.any(String),
      });
    });

    it('should reject report from non-delegated agent', async () => {
      const tool = new ReportToParentTool(workspaceId);

      // Mock agent without parent (not delegated)
      stubDaemonAgentLoad({
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

  describe('GetAgentDiagnosticsTool', () => {
    const makeEvent = (id: string, type = 'agent:idle') => ({
      id,
      type,
      workspaceId,
      timestamp: '2026-06-19T04:00:00.000Z',
      actor: { type: 'agent', id: 'child-agent' },
      data: { ignoredSecret: 'SHOULD_NOT_LEAK' },
    });

    // C1d-5: `get_agent_diagnostics` reads daemon-primary (PROTOCOL.md §5.5
    // `agent.list`); the active-set previously served by `handler.listAgents`
    // collapses onto AgentLite's `isStreaming`/`isResponding` flags, and the
    // per-agent detail lookup routes through `agent.get`.
    it('returns an empty sanitized snapshot', async () => {
      stubDaemonAgentList([]);
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: {},
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect(result.metadata?.diagnostics.summary).toMatchObject({
        agents: 0,
        subscriptions: 0,
        queuedEvents: 0,
        stuckRisks: 0,
      });
    });

    it('reports normal agent, subscription, queue, delegation, and delivery counts', async () => {
      stubDaemonAgentList([
        {
          id: 'parent-agent',
          name: 'Parent',
          status: 'idle',
          metadata: { taskNoteId: 'task-1' },
          messageCount: 1,
          isStreaming: false,
          isResponding: false,
          lastActivity: '2026-06-19T04:00:00.000Z',
        },
        {
          id: 'child-agent',
          name: 'Child',
          status: 'completed',
          metadata: { taskNoteId: 'task-2' },
          isStreaming: false,
          isResponding: false,
        },
      ]);
      mockSelectorState.workspaceSubscriptionState = {
        ...makeEmptyWorkspaceSubscriptionState(),
        subscriptions: {
          'sub-1': {
            id: 'sub-1',
            agentId: 'parent-agent',
            agentName: 'Parent',
            workspaceId,
            createdAt: '2026-06-19T04:00:00.000Z',
            filter: { eventTypes: ['agent:idle'], actorIds: ['child-agent'], priority: 'high' },
          },
        },
        agentQueues: {
          'parent-agent': [
            {
              event: makeEvent('event-1'),
              queuedAt: '2026-06-19T04:01:00.000Z',
              priority: 'high',
              subscriptionId: 'sub-1',
            },
          ],
        },
        delegationGroups: {
          'group-1': {
            groupId: 'group-1',
            parentAgentId: 'parent-agent',
            parentAgentName: 'Parent',
            awaitMode: 'all',
            expectedAgentIds: ['child-agent'],
            completedAgentIds: ['child-agent'],
            deletedAgentIds: [],
            events: [makeEvent('event-2')],
            subscriptionId: 'sub-1',
            delivered: true,
          },
        },
        deliveryStats: {
          totalDeliveries: 1,
          successfulDeliveries: 1,
          failedDeliveries: 0,
          timeoutDeliveries: 0,
          droppedEvents: 0,
          lastDeliveryTime: '2026-06-19T04:02:00.000Z',
          lastFailureTime: null,
        },
      };
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: {},
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect(result.metadata?.diagnostics.summary).toMatchObject({
        agents: 2,
        subscriptions: 1,
        queuedEvents: 1,
        delegationGroups: 1,
      });
      expect(result.metadata?.diagnostics.subscriptions[0]).toEqual(
        expect.objectContaining({ id: 'sub-1', eventTypes: ['agent:idle'], orphaned: false }),
      );
      expect(JSON.stringify(result.metadata?.diagnostics)).not.toContain('SHOULD_NOT_LEAK');
    });

    it('surfaces stuck-risk signals and keeps output sanitized', async () => {
      stubDaemonAgentList([
        {
          id: 'parent-agent',
          name: 'Parent',
          status: 'responding',
          metadata: { taskNoteId: 'task-1', env: 'SECRET_ENV_VALUE' },
          messages: [{ content: 'SECRET_MESSAGE_VALUE' }],
          isStreaming: false,
          isResponding: false,
          lastActivity: '2026-06-19T03:00:00.000Z',
        },
      ]);
      mockSelectorState.workspaceSubscriptionState = {
        ...makeEmptyWorkspaceSubscriptionState(),
        subscriptions: {
          'sub-missing': {
            id: 'sub-missing',
            agentId: 'missing-agent',
            agentName: 'Missing Agent',
            workspaceId,
            createdAt: '2026-06-19T03:50:00.000Z',
            filter: { eventTypes: ['agent:idle'], actorIds: ['parent-agent'], oneShot: true },
          },
        },
        agentStatuses: { 'parent-agent': 'responding' },
        agentQueues: {
          'parent-agent': [
            { event: makeEvent('queued-old'), queuedAt: '2026-06-19T03:30:00.000Z', priority: 'normal' },
          ],
        },
        delegationGroups: {
          'group-stuck': {
            groupId: 'group-stuck',
            parentAgentId: 'parent-agent',
            parentAgentName: 'Parent',
            awaitMode: 'all',
            expectedAgentIds: ['child-agent'],
            completedAgentIds: [],
            deletedAgentIds: [],
            events: [],
            subscriptionId: 'missing-subscription',
            delivered: false,
          },
        },
        deliveryStats: {
          totalDeliveries: 3,
          successfulDeliveries: 1,
          failedDeliveries: 1,
          timeoutDeliveries: 1,
          droppedEvents: 0,
          lastDeliveryTime: null,
          lastFailureTime: '2026-06-19T03:45:00.000Z',
        },
      };
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: { staleRespondingAfterMs: 1000 },
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      const diagnostics = result.metadata?.diagnostics;
      expect(diagnostics.stuckRisks.map((risk: any) => risk.type)).toEqual(
        expect.arrayContaining([
          'queued-events',
          'stale-responding-status',
          'orphaned-subscription',
          'incomplete-delegation-group',
          'delivery-failures',
          'delivery-timeouts',
        ]),
      );
      const serialized = JSON.stringify(diagnostics);
      expect(serialized).not.toContain('SECRET_ENV_VALUE');
      expect(serialized).not.toContain('SECRET_MESSAGE_VALUE');
      expect(serialized).not.toContain('SHOULD_NOT_LEAK');
    });

    it('keeps historical delivery timeout counters out of active stuck risks when queues are clear', async () => {
      stubDaemonAgentList([
        {
          id: 'parent-agent',
          name: 'Parent',
          status: 'idle',
          isStreaming: false,
          isResponding: false,
          lastActivity: '2026-06-19T04:00:00.000Z',
        },
      ]);
      mockSelectorState.workspaceSubscriptionState = {
        ...makeEmptyWorkspaceSubscriptionState(),
        deliveryStats: {
          totalDeliveries: 1,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          timeoutDeliveries: 1,
          droppedEvents: 0,
          lastDeliveryTime: null,
          lastFailureTime: '2026-06-19T03:00:00.000Z',
        },
      };
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: {},
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      const diagnostics = result.metadata?.diagnostics;
      expect(diagnostics.deliveryStats.timeoutDeliveries).toBe(1);
      expect(diagnostics.summary).toMatchObject({
        subscriptions: 0,
        queuedEvents: 0,
        delegationGroups: 0,
        stuckRisks: 0,
      });
      expect(diagnostics.stuckRisks.map((risk: any) => risk.type)).not.toContain('delivery-timeouts');
    });

    it('surfaces recent delivery timeout counters while they are still operationally relevant', async () => {
      stubDaemonAgentList([
        {
          id: 'parent-agent',
          name: 'Parent',
          status: 'idle',
          isStreaming: false,
          isResponding: false,
          lastActivity: '2026-06-19T04:00:00.000Z',
        },
      ]);
      mockSelectorState.workspaceSubscriptionState = {
        ...makeEmptyWorkspaceSubscriptionState(),
        deliveryStats: {
          totalDeliveries: 1,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          timeoutDeliveries: 1,
          droppedEvents: 0,
          lastDeliveryTime: null,
          lastFailureTime: new Date().toISOString(),
        },
      };
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: {},
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect(result.metadata?.diagnostics.stuckRisks).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'delivery-timeouts', ageMs: expect.any(Number) })]),
      );
    });

    it('flags persisted-only agents that have an initial prompt but no response', async () => {
      // No `agentId` filter, so `agent.get` fallback is not triggered; the
      // AgentLite entry from `agent.list` carries `metadata.messageCount: 1`
      // and no `messages`, which drives `pendingInitialResponse: true`.
      stubDaemonAgentList([
        {
          id: 'stuck-created-agent',
          name: 'Stuck Created Agent',
          status: 'idle',
          metadata: { messageCount: 1 },
          isStreaming: false,
          isResponding: false,
          createdAt: '2026-06-19T04:00:00.000Z',
          updatedAt: '2026-06-19T04:00:00.000Z',
        },
      ]);
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: { staleRespondingAfterMs: 1 },
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect(result.metadata?.diagnostics.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'stuck-created-agent',
            presentInBackend: false,
            pendingInitialResponse: true,
          }),
        ]),
      );
      expect(result.metadata?.diagnostics.stuckRisks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'initial-prompt-not-running',
            agentId: 'stuck-created-agent',
          }),
        ]),
      );
    });

    it('flags active idle agents that have an initial prompt but no response', async () => {
      // `isResponding: true` on the AgentLite marks the agent as active, so
      // `presentInBackend` is true and the stuck-risk message omits the
      // "no active backend session" clause.
      stubDaemonAgentList([
        {
          id: 'active-never-started-agent',
          name: 'Active Never Started Agent',
          status: 'idle',
          messages: [{ role: 'user' }],
          messageCount: 1,
          isStreaming: false,
          isResponding: true,
          createdAt: '2026-06-19T04:00:00.000Z',
          updatedAt: '2026-06-19T04:00:00.000Z',
        },
      ]);
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: { staleRespondingAfterMs: 1 },
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect(result.metadata?.diagnostics.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'active-never-started-agent',
            presentInBackend: true,
            pendingInitialResponse: true,
          }),
        ]),
      );
      expect(result.metadata?.diagnostics.stuckRisks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'initial-prompt-not-running',
            agentId: 'active-never-started-agent',
            message: expect.not.stringContaining('no active backend session'),
          }),
        ]),
      );
    });

    it('does not flag persisted-only agents that already have an assistant response', async () => {
      // `agentId` filter is set and the AgentLite entry is not active, so the
      // tool falls back to `agent.get` per PROTOCOL.md §5.5 for the fuller
      // messages payload; the composite mock returns both shapes.
      stubDaemonAgentList(
        [
          {
            id: 'answered-persisted-agent',
            name: 'Answered Persisted Agent',
            status: 'idle',
            metadata: { messageCount: 2 },
            isStreaming: false,
            isResponding: false,
            createdAt: '2026-06-19T04:00:00.000Z',
            updatedAt: '2026-06-19T04:01:00.000Z',
          },
        ],
        {
          'answered-persisted-agent': {
            id: 'answered-persisted-agent',
            name: 'Answered Persisted Agent',
            status: 'idle',
            messages: [{ role: 'user' }, { role: 'assistant' }],
            createdAt: '2026-06-19T04:00:00.000Z',
            updatedAt: '2026-06-19T04:01:00.000Z',
          },
        },
      );
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: { agentId: 'answered-persisted-agent', staleRespondingAfterMs: 1 },
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect(result.metadata?.diagnostics.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'answered-persisted-agent',
            presentInBackend: false,
            pendingInitialResponse: false,
          }),
        ]),
      );
      expect(result.metadata?.diagnostics.stuckRisks.map((risk: any) => risk.type)).not.toContain(
        'initial-prompt-not-running',
      );
    });

    it('uses canonical delegation completion for any-mode terminal ids', async () => {
      stubDaemonAgentList([
        { id: 'parent-agent', name: 'Parent', status: 'idle', isStreaming: false, isResponding: false },
        { id: 'expected-a', name: 'Expected A', status: 'idle', isStreaming: false, isResponding: false },
        { id: 'expected-b', name: 'Expected B', status: 'idle', isStreaming: false, isResponding: false },
      ]);
      mockSelectorState.workspaceSubscriptionState = {
        ...makeEmptyWorkspaceSubscriptionState(),
        subscriptions: {
          'sub-any': {
            id: 'sub-any',
            agentId: 'parent-agent',
            agentName: 'Parent',
            workspaceId,
            createdAt: '2026-06-19T04:00:00.000Z',
            filter: { eventTypes: ['agent:idle'], actorIds: ['expected-a', 'expected-b'] },
          },
        },
        delegationGroups: {
          'group-any-non-expected': {
            groupId: 'group-any-non-expected',
            parentAgentId: 'parent-agent',
            parentAgentName: 'Parent',
            awaitMode: 'any',
            expectedAgentIds: ['expected-a', 'expected-b'],
            completedAgentIds: ['unexpected-agent', 'unexpected-agent'],
            deletedAgentIds: ['deleted-unexpected'],
            events: [],
            subscriptionId: 'sub-any',
            delivered: false,
          },
          'group-any-duplicate-expected': {
            groupId: 'group-any-duplicate-expected',
            parentAgentId: 'parent-agent',
            parentAgentName: 'Parent',
            awaitMode: 'any',
            expectedAgentIds: ['expected-a', 'expected-b'],
            completedAgentIds: ['expected-a', 'expected-a', 'unexpected-agent'],
            deletedAgentIds: [],
            events: [],
            subscriptionId: 'sub-any',
            delivered: false,
          },
          'group-any-empty-expected': {
            groupId: 'group-any-empty-expected',
            parentAgentId: 'parent-agent',
            parentAgentName: 'Parent',
            awaitMode: 'any',
            expectedAgentIds: [],
            completedAgentIds: ['unexpected-agent'],
            deletedAgentIds: [],
            events: [],
            subscriptionId: 'sub-any',
            delivered: false,
          },
        },
      };
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: {},
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      const diagnostics = result.metadata?.diagnostics;
      expect(diagnostics.delegationGroups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            groupId: 'group-any-non-expected',
            complete: false,
            pendingAgentIds: ['expected-a', 'expected-b'],
          }),
          expect.objectContaining({
            groupId: 'group-any-duplicate-expected',
            complete: true,
            pendingAgentIds: ['expected-b'],
          }),
          expect.objectContaining({
            groupId: 'group-any-empty-expected',
            complete: false,
            pendingAgentIds: [],
          }),
        ]),
      );
      expect(
        diagnostics.stuckRisks
          .filter((risk: any) => risk.type === 'incomplete-delegation-group')
          .map((risk: any) => risk.groupId),
      ).toEqual(
        expect.arrayContaining(['group-any-non-expected', 'group-any-empty-expected']),
      );
      expect(diagnostics.stuckRisks.map((risk: any) => risk.groupId)).not.toContain(
        'group-any-duplicate-expected',
      );
    });

    it('reports deleted-agent references', async () => {
      stubDaemonAgentList([]);
      mockSelectorState.workspaceSubscriptionState = {
        ...makeEmptyWorkspaceSubscriptionState(),
        subscriptions: {
          'sub-deleted': {
            id: 'sub-deleted',
            agentId: 'deleted-agent',
            agentName: 'Deleted',
            workspaceId,
            createdAt: '2026-06-19T04:00:00.000Z',
            filter: { eventTypes: ['agent:*'], actorIds: ['deleted-agent'] },
          },
        },
        agentQueues: {
          'deleted-agent': [
            { event: makeEvent('deleted-queue'), queuedAt: '2026-06-19T04:00:00.000Z', priority: 'normal' },
          ],
        },
        deletedAgents: { 'deleted-agent': Date.parse('2026-06-19T04:05:00.000Z') },
      };
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const result = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: {},
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(result.isError).toBe(false);
      expect(result.metadata?.diagnostics.deletedAgentReferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'subscription-owner', agentId: 'deleted-agent' }),
          expect.objectContaining({ kind: 'subscription-actor', agentId: 'deleted-agent' }),
          expect.objectContaining({ kind: 'queue-owner', agentId: 'deleted-agent' }),
        ]),
      );
      expect(result.metadata?.diagnostics.stuckRisks.map((risk: any) => risk.type)).toContain(
        'deleted-agent-reference',
      );
    });

    it('focuses diagnostics by task note or agent id', async () => {
      // The `byAgent` call passes `agentId: 'agent-b'`, so the tool falls
      // back to `agent.get`; the composite mock returns the same agent shape
      // so the focused diagnostic is stable.
      stubDaemonAgentList(
        [
          {
            id: 'agent-a',
            name: 'A',
            status: 'idle',
            metadata: { taskNoteId: 'task-a' },
            isStreaming: false,
            isResponding: false,
          },
          {
            id: 'agent-b',
            name: 'B',
            status: 'idle',
            metadata: { taskNoteId: 'task-b' },
            isStreaming: false,
            isResponding: false,
          },
        ],
        {
          'agent-b': {
            id: 'agent-b',
            name: 'B',
            status: 'idle',
            metadata: { taskNoteId: 'task-b' },
          },
        },
      );
      mockSelectorState.workspaceSubscriptionState = {
        ...makeEmptyWorkspaceSubscriptionState(),
        subscriptions: {
          'sub-a': {
            id: 'sub-a',
            agentId: 'agent-a',
            agentName: 'A',
            workspaceId,
            createdAt: '2026-06-19T04:00:00.000Z',
            filter: { eventTypes: ['agent:idle'] },
          },
          'sub-b': {
            id: 'sub-b',
            agentId: 'agent-b',
            agentName: 'B',
            workspaceId,
            createdAt: '2026-06-19T04:00:00.000Z',
            filter: { eventTypes: ['agent:idle'] },
          },
        },
      };
      const tool = new GetAgentDiagnosticsTool(workspaceId);

      const byTask = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: { taskNoteId: 'task-a' },
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);
      const byAgent = await tool.execute({
        name: 'get_agent_diagnostics',
        arguments: { agentId: 'agent-b' },
        context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
      } as ToolCall);

      expect(byTask.metadata?.diagnostics.agents.map((agent: any) => agent.id)).toEqual(['agent-a']);
      expect(byTask.metadata?.diagnostics.subscriptions.map((sub: any) => sub.id)).toEqual(['sub-a']);
      expect(byAgent.metadata?.diagnostics.agents.map((agent: any) => agent.id)).toEqual(['agent-b']);
      expect(byAgent.metadata?.diagnostics.subscriptions.map((sub: any) => sub.id)).toEqual(['sub-b']);
    });
  });

  describe('Deterministic end-to-end orchestration scenarios', () => {
    const parentAgentId = 'parent-agent-id';
    const parentAgentName = 'Parent Agent';

    const makeContext = (overrides: Record<string, any> = {}) => {
      const { metadata, ...rest } = overrides;
      return {
        workspaceId,
        agentId: parentAgentId,
        agentName: parentAgentName,
        sessionId: 'session-123',
        ...rest,
        metadata: {
          model: 'programmatic-test:programmatic-test-model',
          provider: 'programmatic-test',
          ...metadata,
        },
      };
    };

    const expectToolSuccess = (result: ToolResult, scenario: string) => {
      const text = (result.content[0] as any)?.text ?? '<no text>';
      expect(result.isError, `${scenario} failed unexpectedly: ${text}`).toBe(false);
    };

    const useDeterministicAgentCreation = (agentIds: string[]) => {
      const remaining = [...agentIds];
      mockBackendHandler.createAgent.mockImplementation(
        async (_workspaceId: string, name: string, options: any) => {
          const id = remaining.shift();
          if (!id) throw new Error(`No deterministic agent id remaining for ${name}`);
          await options?.onBeforeStart?.(id);
          return { id, name, status: 'started' };
        },
      );
    };

    const installSubscriptionScenarioMocks = () => {
      mockSubscriptionService.subscribe.mockImplementation(
        (agentId: string, agentName: string, filter: any) => {
          const actorKey = filter.actorIds?.join('-') || 'workspace';
          const id = `sub-${agentId}-${actorKey}`;
          mockSelectorState.workspaceSubscriptionState.subscriptions[id] = {
            id,
            agentId,
            agentName,
            workspaceId,
            filter,
            createdAt: '2026-06-19T04:00:00.000Z',
          };
          return id;
        },
      );
      mockSubscriptionService.subscribeToGroup.mockImplementation(
        (agentId: string, agentName: string, groupId: string, delegatedAgentId: string) => {
          const existing = Object.values(
            mockSelectorState.workspaceSubscriptionState.subscriptions,
          ).find((sub: any) => sub.filter.delegationGroup?.groupId === groupId) as any;
          if (existing) {
            existing.filter.actorIds = Array.from(
              new Set([...(existing.filter.actorIds ?? []), delegatedAgentId]),
            );
            existing.filter.delegationGroup.expectedAgentIds = Array.from(
              new Set([
                ...existing.filter.delegationGroup.expectedAgentIds,
                delegatedAgentId,
              ]),
            );
            return existing.id;
          }

          const id = `sub-${groupId}`;
          mockSelectorState.workspaceSubscriptionState.subscriptions[id] = {
            id,
            agentId,
            agentName,
            workspaceId,
            filter: {
              eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
              actorIds: [delegatedAgentId],
              priority: 'high',
              delegationGroup: {
                groupId,
                awaitMode: 'all',
                expectedAgentIds: [delegatedAgentId],
              },
            },
            createdAt: '2026-06-19T04:00:00.000Z',
          };
          mockSelectorState.workspaceSubscriptionState.delegationGroups[groupId] = {
            groupId,
            parentAgentId: agentId,
            parentAgentName: agentName,
            awaitMode: 'all',
            expectedAgentIds: [delegatedAgentId],
            completedAgentIds: [],
            deletedAgentIds: [],
            events: [],
            subscriptionId: id,
            delivered: false,
          };
          return id;
        },
      );
    };

    beforeEach(() => {
      installSubscriptionScenarioMocks();
      mockIsAutoCommitEnabled.mockReturnValue(true);
      DelegateTaskTool.clearDelegationGroup(workspaceId, parentAgentId);
      // P3-D4: MCP tools now hit the daemon directly for note.get/task.*
      // (PROTOCOL.md §5.2, §5.4). Delegate to the legacy mockNotesService so
      // existing per-test expectations keep working. C1d-6: write/wake
      // (`agent.create` / `agent.sendMessage` / `agent.getSession`) fall
      // through to `invokeWriteWakeWireCompat` so the same
      // `mockBackendHandler.*` spies keep configuring behaviour.
      mockRequest.mockImplementation(async (method: string, params: any) => {
        if (method === 'note.get') {
          const res = await mockNotesService.getNote(params?.workspaceId, params?.noteId);
          if (!res || !res.ok) {
            throw new Error(res?.error || 'note.get failed');
          }
          return { note: res.data };
        }
        if (method === 'task.assignAgent') {
          const res = await mockNotesService.assignAgentToTask(
            params?.workspaceId,
            params?.noteId,
            params?.agentId,
          );
          if (!res || !res.ok) {
            throw new Error(res?.error || 'task.assignAgent failed');
          }
          return { ok: true, noteId: params?.noteId, agentId: params?.agentId };
        }
        if (method === 'task.removeAgentFromAllTasks') {
          const res = await mockNotesService.removeAgentFromAllTasks(
            params?.workspaceId,
            params?.agentId,
          );
          if (!res || !res.ok) {
            throw new Error(res?.error || 'task.removeAgentFromAllTasks failed');
          }
          return { ok: true, updatedCount: res.data ?? 0 };
        }
        const compat = await invokeWriteWakeWireCompat(method, params);
        if (compat !== undefined) return compat;
        if (method === 'agent.get') {
          return { agent: null };
        }
        return {};
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      DelegateTaskTool.clearDelegationGroup(workspaceId, parentAgentId);
    });

    it('creates an agent with a pre-start completion subscription and task-note assignment', async () => {
      useDeterministicAgentCreation(['agent-created-1']);
      const tool = new CreateAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'create_agent',
        arguments: {
          name: 'Programmatic Child',
          initialMessage: 'Run the deterministic script.',
          createLinkedNote: true,
          noteContent: 'Scripted child note',
          parentNoteId: 'parent-note-id',
        },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'create_agent subscription scenario');
      expect(result.metadata).toMatchObject({
        agentId: 'agent-created-1',
        linkedNoteId: 'created-note-id',
        subscriptionId: 'sub-parent-agent-id-agent-created-1',
      });
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith(
        parentAgentId,
        parentAgentName,
        expect.objectContaining({
          actorIds: ['agent-created-1'],
          eventTypes: expect.arrayContaining(['agent:idle', 'agent:failed', 'agent:deleted']),
        }),
      );
      expect(protocolAdapter.assignAgentToTask).toHaveBeenCalledWith(
        expect.objectContaining({ noteId: 'created-note-id', agentId: 'agent-created-1' }),
      );
    });

    it('delegates immediate work with failed/deleted completion events in the wake subscription', async () => {
      useDeterministicAgentCreation(['agent-immediate-1']);
      vi.mocked(protocolAdapter.getNote).mockResolvedValue({
        ok: true,
        data: { id: 'task-immediate', title: 'Immediate task', content: 'Do immediate work' },
      });
      const tool = new DelegateTaskTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'delegate_task',
        arguments: { taskNoteId: 'task-immediate', wait_mode: 'immediate' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'delegate_task immediate scenario');
      expect(result.metadata).toMatchObject({
        agentId: 'agent-immediate-1',
        taskNoteId: 'task-immediate',
        subscriptionId: 'sub-parent-agent-id-agent-immediate-1',
        waitMode: 'immediate',
      });
      const subscriptionFilter = mockSubscriptionService.subscribe.mock.calls[0]?.[2];
      expect(
        subscriptionFilter,
        'immediate subscription filter for agent-immediate-1/sub-parent-agent-id-agent-immediate-1',
      ).toEqual(
        expect.objectContaining({
          actorIds: ['agent-immediate-1'],
          oneShot: true,
          eventTypes: expect.arrayContaining(['agent:failed', 'agent:deleted']),
        }),
      );
    });

    it('groups same-turn and duplicate after_all delegations under one subscription', async () => {
      useDeterministicAgentCreation(['agent-after-all-a', 'agent-after-all-b', 'agent-after-all-c']);
      vi.mocked(protocolAdapter.getNote).mockImplementation(async ({ noteId }: any) => ({
        ok: true,
        data: { id: noteId, title: `Task ${noteId}`, content: `Content ${noteId}` },
      }));
      const tool = new DelegateTaskTool(workspaceId, workspacePath);
      const makeDelegateCall = (taskNoteId: string): ToolCall => ({
        name: 'delegate_task',
        arguments: { taskNoteId, wait_mode: 'after_all' },
        context: makeContext(),
      });

      const first = await tool.execute(makeDelegateCall('task-after-all-a'));
      const second = await tool.execute(makeDelegateCall('task-after-all-b'));
      const duplicate = await tool.execute(makeDelegateCall('task-after-all-a'));

      for (const [label, result] of [
        ['first after_all', first],
        ['second after_all', second],
        ['duplicate after_all', duplicate],
      ] as const) {
        expectToolSuccess(result, label);
      }
      const groupIds = [first, second, duplicate].map((result) => result.metadata?.groupId);
      const subscriptionIds = [first, second, duplicate].map(
        (result) => result.metadata?.subscriptionId,
      );
      expect(new Set(groupIds).size, `group ids: ${groupIds.join(', ')}`).toBe(1);
      expect(new Set(subscriptionIds).size, `subscription ids: ${subscriptionIds.join(', ')}`).toBe(1);
      expect(new Set([first.metadata?.agentId, second.metadata?.agentId, duplicate.metadata?.agentId])).toEqual(
        new Set(['agent-after-all-a', 'agent-after-all-b', 'agent-after-all-c']),
      );
      const groupSubscription = mockSelectorState.workspaceSubscriptionState.subscriptions[
        subscriptionIds[0] as string
      ] as any;
      expect(
        groupSubscription.filter,
        `after_all group ${groupIds[0]} subscription ${subscriptionIds[0]}`,
      ).toEqual(
        expect.objectContaining({
          actorIds: expect.arrayContaining([
            'agent-after-all-a',
            'agent-after-all-b',
            'agent-after-all-c',
          ]),
          eventTypes: expect.arrayContaining(['agent:failed', 'agent:deleted']),
        }),
      );
      expect(
        Object.values(mockSelectorState.workspaceSubscriptionState.subscriptions).filter(
          (sub: any) => sub.filter.delegationGroup?.groupId === groupIds[0],
        ),
      ).toHaveLength(1);
      expect(mockSubscriptionService.subscribeToGroup).toHaveBeenCalledTimes(3);
      expect(mockSubscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it('groups truly concurrent after_all delegate_task calls under one wake subscription', async () => {
      useDeterministicAgentCreation([
        'agent-concurrent-after-all-a',
        'agent-concurrent-after-all-b',
        'agent-concurrent-after-all-c',
      ]);
      vi.mocked(protocolAdapter.getNote).mockImplementation(async ({ noteId }: any) => ({
        ok: true,
        data: { id: noteId, title: `Task ${noteId}`, content: `Content ${noteId}` },
      }));
      const tool = new DelegateTaskTool(workspaceId, workspacePath);
      const makeDelegateCall = (taskNoteId: string): ToolCall => ({
        name: 'delegate_task',
        arguments: { taskNoteId, wait_mode: 'after_all' },
        context: makeContext(),
      });
      // C1d-6: `agent-interaction-tools.ts` no longer imports the FE
      // `AgentBackendHandler`, so the alias/relative-path resolution spy that
      // used to guard against dual-instance drift is retired. The daemon wire
      // seam (`getBackendClient().request`) is the single seam under test now.

      const [first, second, duplicate] = await Promise.all([
        tool.execute(makeDelegateCall('task-concurrent-after-all-a')),
        tool.execute(makeDelegateCall('task-concurrent-after-all-b')),
        tool.execute(makeDelegateCall('task-concurrent-after-all-a')),
      ]);

      for (const [label, result] of [
        ['first concurrent after_all', first],
        ['second concurrent after_all', second],
        ['duplicate concurrent after_all', duplicate],
      ] as const) {
        expectToolSuccess(result, label);
      }
      const groupIds = [first, second, duplicate].map((result) => result.metadata?.groupId);
      const subscriptionIds = [first, second, duplicate].map(
        (result) => result.metadata?.subscriptionId,
      );
      expect(new Set(groupIds).size, `concurrent group ids: ${groupIds.join(', ')}`).toBe(1);
      expect(new Set(subscriptionIds).size, `concurrent subscription ids: ${subscriptionIds.join(', ')}`).toBe(1);
      const groupSubscription = mockSelectorState.workspaceSubscriptionState.subscriptions[
        subscriptionIds[0] as string
      ] as any;
      expect(groupSubscription.filter.actorIds).toEqual(
        expect.arrayContaining([
          'agent-concurrent-after-all-a',
          'agent-concurrent-after-all-b',
          'agent-concurrent-after-all-c',
        ]),
      );
      expect(groupSubscription.filter.actorIds).toHaveLength(3);
      expect(groupSubscription.filter.delegationGroup.expectedAgentIds).toEqual(
        expect.arrayContaining([
          'agent-concurrent-after-all-a',
          'agent-concurrent-after-all-b',
          'agent-concurrent-after-all-c',
        ]),
      );
      expect(groupSubscription.filter.delegationGroup.expectedAgentIds).toHaveLength(3);
      expect(
        Object.values(mockSelectorState.workspaceSubscriptionState.subscriptions).filter(
          (sub: any) => sub.filter.delegationGroup?.groupId === groupIds[0],
        ),
      ).toHaveLength(1);
      expect(mockSubscriptionService.subscribeToGroup).toHaveBeenCalledTimes(3);
      expect(mockSubscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it('emits exactly one app-facing message and response subscription per send/sendToTask call', async () => {
      vi.mocked(protocolAdapter.getNote).mockResolvedValue({
        ok: true,
        data: {
          id: 'task-send',
          title: 'Send target task',
          metadata: { task: { assignedAgentIds: ['older-agent', 'latest-task-agent'] } },
        },
      });
      const sendAgent = new SendMessageToAgentTool(workspaceId);
      const sendTask = new SendMessageToTaskAgentTool(workspaceId);

      const direct = await sendAgent.execute({
        name: 'send_message_to_agent',
        arguments: { agentId: 'direct-target-agent', message: 'Please continue.', priority: 'high' },
        context: makeContext(),
      } as ToolCall);
      const task = await sendTask.execute({
        name: 'send_message_to_task_agent',
        arguments: { taskNoteId: 'task-send', message: 'Please revise.', priority: 'normal' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(direct, 'send_message_to_agent scenario');
      expectToolSuccess(task, 'send_message_to_task_agent scenario');
      expect(direct.metadata).toMatchObject({
        toAgentId: 'direct-target-agent',
        subscriptionId: 'sub-parent-agent-id-direct-target-agent',
      });
      expect(task.metadata).toMatchObject({
        toAgentId: 'latest-task-agent',
        taskNoteId: 'task-send',
        subscriptionId: 'sub-parent-agent-id-latest-task-agent',
      });
      expect(mockMainDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: 'agent:message:sent',
            data: expect.objectContaining({ toAgentId: 'direct-target-agent', priority: 'high' }),
          }),
        }),
      );
      expect(mockMainDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: 'agent:message:sent',
            data: expect.objectContaining({ toAgentId: 'latest-task-agent', taskNoteId: 'task-send' }),
          }),
        }),
      );
      const messageEvents = mockMainDispatch.mock.calls
        .map(([action]) => action?.payload)
        .filter((event) => event?.type === 'agent:message:sent');
      expect(messageEvents).toHaveLength(2);
      expect(messageEvents.filter((event) => event.data?.toAgentId === 'direct-target-agent')).toHaveLength(1);
      expect(messageEvents.filter((event) => event.data?.toAgentId === 'latest-task-agent')).toHaveLength(1);
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledTimes(2);
      expect(
        mockSubscriptionService.subscribe.mock.calls.filter(
          ([agentId, , filter]) => agentId === parentAgentId && filter.actorIds?.[0] === 'direct-target-agent',
        ),
      ).toHaveLength(1);
      expect(
        mockSubscriptionService.subscribe.mock.calls.filter(
          ([agentId, , filter]) => agentId === parentAgentId && filter.actorIds?.[0] === 'latest-task-agent',
        ),
      ).toHaveLength(1);
    });

    it('wakes an existing task agent and subscribes the caller to the response', async () => {
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-wake',
          title: 'Wake task',
          metadata: { task: { assignedAgentIds: ['agent-to-wake'] } },
        },
      });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: true,
        status: 'resumable',
        agentData: { metadata: { specialist: 'implementor' } },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-wake', contextMessage: 'Dependencies are ready.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create woke_existing scenario');
      expect(result.metadata).toMatchObject({
        action: 'woke_existing',
        agentId: 'agent-to-wake',
        taskNoteId: 'task-wake',
        subscriptionId: 'sub-parent-agent-id-agent-to-wake',
      });
      expect(mockBackendHandler.sendBackendInitiatedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'agent-to-wake',
          message: 'Dependencies are ready.',
          messageMetadata: expect.objectContaining({ taskNoteId: 'task-wake' }),
        }),
      );
    });

    it('wakes a running assigned agent with a one-shot completion subscription', async () => {
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-running',
          title: 'Running task',
          metadata: { task: { assignedAgentIds: ['running-agent'] } },
        },
      });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: true,
        status: 'running',
        agentData: { metadata: { specialist: 'implementor' } },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-running', contextMessage: 'Continue running work.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create running assigned-agent scenario');
      expect(result.metadata).toMatchObject({ action: 'woke_existing', agentId: 'running-agent' });
      expect(mockBackendHandler.createAgent).not.toHaveBeenCalled();
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith(
        parentAgentId,
        parentAgentName,
        expect.objectContaining({
          actorIds: ['running-agent'],
          oneShot: true,
          eventTypes: expect.arrayContaining(['agent:idle', 'agent:failed', 'agent:deleted']),
        }),
      );
    });

    it('uses the most recently assigned wakeable agent without probing older assignments', async () => {
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-most-recent',
          title: 'Most recent task',
          metadata: { task: { assignedAgentIds: ['older-agent', 'latest-agent'] } },
        },
      });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: true,
        status: 'resumable',
        agentData: { metadata: { specialist: 'verifier' } },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-most-recent', contextMessage: 'Wake latest.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create most-recent selection scenario');
      expect(result.metadata).toMatchObject({ action: 'woke_existing', agentId: 'latest-agent' });
      expect(mockBackendHandler.getAgentResumability).toHaveBeenCalledTimes(1);
      expect(mockBackendHandler.getAgentResumability).toHaveBeenCalledWith('latest-agent', workspaceId);
      expect(mockBackendHandler.sendBackendInitiatedMessage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'latest-agent' }),
      );
      expect(mockBackendHandler.createAgent).not.toHaveBeenCalled();
    });

    it('removes stale newer missing assignments before waking an older resumable agent', async () => {
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-stale-then-wake',
          title: 'Stale then wake task',
          metadata: { task: { assignedAgentIds: ['older-resumable', 'missing-latest'] } },
        },
      });
      mockNotesService.removeAgentFromAllTasks.mockResolvedValue({ ok: true, data: 1 });
      mockBackendHandler.getAgentResumability.mockImplementation(async (agentId: string) =>
        agentId === 'missing-latest'
          ? { canWake: false, status: 'not_found' }
          : { canWake: true, status: 'resumable', agentData: { metadata: { specialist: 'implementor' } } },
      );
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-stale-then-wake', contextMessage: 'Wake older.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create stale-cleanup-before-wake scenario');
      expect(result.metadata).toMatchObject({ action: 'woke_existing', agentId: 'older-resumable' });
      expect(mockNotesService.removeAgentFromAllTasks).toHaveBeenCalledWith(
        workspaceId,
        'missing-latest',
      );
      expect(mockBackendHandler.createAgent).not.toHaveBeenCalled();
    });

    it('creates a programmatic-provider fallback agent when no assigned agent can wake', async () => {
      useDeterministicAgentCreation(['agent-created-fallback']);
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: { id: 'task-create', title: 'Create fallback task', metadata: { task: {} } },
      });
      mockNotesService.assignAgentToTask.mockResolvedValue({ ok: true });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-create', contextMessage: 'Start from scratch.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create created_new scenario');
      expect(result.metadata).toMatchObject({
        action: 'created_new',
        agentId: 'agent-created-fallback',
        taskNoteId: 'task-create',
        subscriptionId: 'sub-parent-agent-id-agent-created-fallback',
      });
      expect(mockBackendHandler.createAgent).toHaveBeenCalledWith(
        workspaceId,
        'Task: Create fallback task',
        expect.objectContaining({ provider: 'programmatic-test' }),
      );
      expect(mockNotesService.assignAgentToTask).toHaveBeenCalledWith(
        workspaceId,
        'task-create',
        'agent-created-fallback',
      );
    });

    it('queues context to an already-active task agent without creating a duplicate', async () => {
      vi.useFakeTimers();
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-queued',
          title: 'Queued task',
          metadata: { task: { assignedAgentIds: ['active-agent'] } },
        },
      });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: true,
        status: 'running',
        agentData: { metadata: { specialist: 'implementor' } },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'ALREADY_STREAMING',
        error: 'active stream',
      });
      mockBackendHandler.handleQueueMessage.mockResolvedValue({
        success: true,
        queuedMessage: { id: 'msg-queued-wake' },
      });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-queued', contextMessage: 'Queue this context.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create queued active-agent scenario');
      expect(result.metadata).toMatchObject({
        action: 'message_queued_to_active_agent',
        agentId: 'active-agent',
        taskNoteId: 'task-queued',
        subscriptionId: 'sub-parent-agent-id-active-agent',
        queuedMessageId: 'msg-queued-wake',
      });
      expect(mockBackendHandler.createAgent).not.toHaveBeenCalled();
      expect(mockBackendHandler.handleQueueMessage).toHaveBeenCalledWith(null, {
        agentId: 'active-agent',
        content: 'Queue this context.',
        workspaceId,
      });
      const subscriptionFilter = mockSubscriptionService.subscribe.mock.calls[0]?.[2];
      expect(
        subscriptionFilter,
        'queued active-agent subscription should survive current idle event',
      ).toEqual(
        expect.objectContaining({
          actorIds: ['active-agent'],
          oneShot: false,
          dataMatchers: [
            {
              field: 'data.respondingToMessageId',
              operator: 'equals',
              value: 'msg-queued-wake',
            },
          ],
        }),
      );
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(mockSubscriptionService.unsubscribe).toHaveBeenCalledWith(
        'sub-parent-agent-id-active-agent',
      );
    });

    it('returns an error without duplicate creation when queueing to an active agent fails', async () => {
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-queue-fail',
          title: 'Queue failure task',
          metadata: { task: { assignedAgentIds: ['active-agent'] } },
        },
      });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: true,
        status: 'running',
        agentData: { metadata: { specialist: 'implementor' } },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'ALREADY_STREAMING',
        error: 'active stream',
      });
      mockBackendHandler.handleQueueMessage.mockResolvedValue({
        success: false,
        error: 'queue unavailable',
      });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-queue-fail', contextMessage: 'Queue this context.' },
        context: makeContext(),
      } as ToolCall);

      // C1d-6: post-migration the wake and its daemon-auto-queue are a single
      // `agent.sendMessage` call (PROTOCOL.md §5.5), so a queue-side failure
      // surfaces through the generic wake-failure path with the daemon's
      // error string ("queue unavailable" here) preserved verbatim. The
      // no-duplicate-creation invariant is unchanged.
      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Failed to wake assigned agent');
      expect((result.content[0] as any).text).toContain('queue unavailable');
      expect(mockBackendHandler.createAgent).not.toHaveBeenCalled();
      expect(mockSubscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it('removes stale missing task-agent assignments before creating a replacement', async () => {
      useDeterministicAgentCreation(['agent-created-after-missing']);
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-missing',
          title: 'Missing task',
          metadata: { task: { assignedAgentIds: ['missing-agent'] } },
        },
      });
      mockNotesService.assignAgentToTask.mockResolvedValue({ ok: true });
      mockNotesService.removeAgentFromAllTasks.mockResolvedValue({ ok: true, data: 1 });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: false,
        status: 'not_found',
      });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-missing', contextMessage: 'Recover missing assignment.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create missing assigned-agent recovery');
      expect(result.metadata).toMatchObject({
        action: 'created_new',
        agentId: 'agent-created-after-missing',
      });
      expect(mockNotesService.removeAgentFromAllTasks).toHaveBeenCalledWith(
        workspaceId,
        'missing-agent',
      );
      expect(mockNotesService.assignAgentToTask).toHaveBeenCalledWith(
        workspaceId,
        'task-missing',
        'agent-created-after-missing',
      );
    });

    it('falls back to create and cleans assignment when wake reports a deleted target', async () => {
      useDeterministicAgentCreation(['agent-created-after-delete']);
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-deleted-target',
          title: 'Deleted target task',
          metadata: { task: { assignedAgentIds: ['deleted-agent'] } },
        },
      });
      mockNotesService.assignAgentToTask.mockResolvedValue({ ok: true });
      mockNotesService.removeAgentFromAllTasks.mockResolvedValue({ ok: true, data: 1 });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: true,
        status: 'resumable',
        agentData: { metadata: { specialist: 'implementor' } },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'AGENT_DELETED',
        error: 'Agent has been deleted',
      });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-deleted-target', contextMessage: 'Recover deleted target.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create deleted target fallback scenario');
      expect(result.metadata).toMatchObject({
        action: 'created_new',
        agentId: 'agent-created-after-delete',
      });
      expect(mockNotesService.removeAgentFromAllTasks).toHaveBeenCalledWith(
        workspaceId,
        'deleted-agent',
      );
      expect(mockNotesService.assignAgentToTask).toHaveBeenCalledWith(
        workspaceId,
        'task-deleted-target',
        'agent-created-after-delete',
      );
    });

    it('falls back to create when delivery reports agent not found', async () => {
      useDeterministicAgentCreation(['agent-created-after-not-found']);
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-not-found-delivery',
          title: 'Not found delivery task',
          metadata: { task: { assignedAgentIds: ['vanished-agent'] } },
        },
      });
      mockNotesService.assignAgentToTask.mockResolvedValue({ ok: true });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: true,
        status: 'resumable',
        agentData: { metadata: { specialist: 'implementor' } },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'AGENT_NOT_FOUND',
        error: 'Agent not found',
      });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-not-found-delivery', contextMessage: 'Recover not found.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create agent-not-found delivery fallback scenario');
      expect(result.metadata).toMatchObject({
        action: 'created_new',
        agentId: 'agent-created-after-not-found',
      });
    });

    it('surfaces assignment failures while keeping the created replacement agent working', async () => {
      useDeterministicAgentCreation(['agent-created-assignment-warning']);
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-assignment-fail',
          title: 'Assignment failure task',
          metadata: { task: { assignedAgentIds: [] } },
        },
      });
      mockNotesService.assignAgentToTask.mockResolvedValue({ ok: false, error: 'write failed' });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-assignment-fail', contextMessage: 'Start despite metadata.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create assignment failure nonfatal scenario');
      expect(result.metadata).toMatchObject({
        action: 'created_new',
        agentId: 'agent-created-assignment-warning',
      });
      expect(mockNotesService.assignAgentToTask).toHaveBeenCalledWith(
        workspaceId,
        'task-assignment-fail',
        'agent-created-assignment-warning',
      );
    });

    it('treats malformed assignedAgentIds metadata as empty instead of probing bogus ids', async () => {
      useDeterministicAgentCreation(['agent-created-malformed-metadata']);
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-malformed',
          title: 'Malformed metadata task',
          metadata: { task: { assignedAgentIds: 'not-an-array' } },
        },
      });
      mockNotesService.assignAgentToTask.mockResolvedValue({ ok: true });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-malformed', contextMessage: 'Normalize metadata.' },
        context: makeContext(),
      } as ToolCall);

      expectToolSuccess(result, 'wake_or_create malformed metadata scenario');
      expect(result.metadata).toMatchObject({
        action: 'created_new',
        agentId: 'agent-created-malformed-metadata',
      });
      expect(mockBackendHandler.getAgentResumability).not.toHaveBeenCalled();
    });

    it('does not create a duplicate agent for transient wake failures', async () => {
      mockNotesService.getNote.mockResolvedValue({
        ok: true,
        data: {
          id: 'task-transient',
          title: 'Transient task',
          metadata: { task: { assignedAgentIds: ['resumable-agent'] } },
        },
      });
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        canWake: true,
        status: 'resumable',
        agentData: { metadata: { specialist: 'implementor' } },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'HANDSHAKE_TIMEOUT',
        error: 'temporary handshake issue',
      });
      const tool = new WakeOrCreateTaskAgentTool(workspaceId, workspacePath);

      const result = await tool.execute({
        name: 'wake_or_create_task_agent',
        arguments: { taskNoteId: 'task-transient', contextMessage: 'Try wake.' },
        context: makeContext(),
      } as ToolCall);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Failed to wake assigned agent');
      expect(mockBackendHandler.createAgent).not.toHaveBeenCalled();
      expect(mockNotesService.assignAgentToTask).not.toHaveBeenCalled();
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
      // C1d-6: daemon-primary `agent.getSession` cannot return metadata for a
      // truly missing session, so the pre-migration `{status: 'not_found',
      // agentData: {metadata: {specialist}}}` fixture is now a resumable
      // session (so previousSpecialist is recovered) paired with a wake that
      // resolves as agent-not-found — the wake falls through to create and
      // the model-resolution assertions below still exercise the specialist
      // codingAgent path.
      mockBackendHandler.getAgentResumability.mockResolvedValue({
        status: 'resumable',
        canWake: true,
        agentData: {
          metadata: { specialist: 'implementor' },
        },
      });
      mockBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
        success: false,
        errorCode: 'AGENT_NOT_FOUND',
        error: 'agent not found',
      });
      mockBackendHandler.createAgent.mockResolvedValue({
        id: 'new-task-agent-id',
        name: 'Task: Do the thing',
      });
      // P3-D4: route daemon note.get / task.* through the legacy mock. C1d-6:
      // fall through to `invokeWriteWakeWireCompat` for write/wake methods.
      mockRequest.mockImplementation(async (method: string, params: any) => {
        if (method === 'note.get') {
          const res = await mockNotesService.getNote(params?.workspaceId, params?.noteId);
          if (!res || !res.ok) {
            throw new Error(res?.error || 'note.get failed');
          }
          return { note: res.data };
        }
        if (method === 'task.assignAgent') {
          const res = await mockNotesService.assignAgentToTask(
            params?.workspaceId,
            params?.noteId,
            params?.agentId,
          );
          if (!res || !res.ok) {
            throw new Error(res?.error || 'task.assignAgent failed');
          }
          return { ok: true, noteId: params?.noteId, agentId: params?.agentId };
        }
        if (method === 'task.removeAgentFromAllTasks') {
          const res = await mockNotesService.removeAgentFromAllTasks(
            params?.workspaceId,
            params?.agentId,
          );
          if (!res || !res.ok) {
            throw new Error(res?.error || 'task.removeAgentFromAllTasks failed');
          }
          return { ok: true, updatedCount: res.data ?? 0 };
        }
        const compat = await invokeWriteWakeWireCompat(method, params);
        if (compat !== undefined) return compat;
        if (method === 'agent.get') {
          return { agent: null };
        }
        return {};
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

// P3-1: focused wire-contract tests that assert the exact JSON-RPC method +
// params the mcp agent-session tools emit per PROTOCOL.md §5.5. These live
// alongside the behavioural coverage above but mock `getBackendClient()` at
// the transport seam instead of the persistence layer.
describe('mcp agent-session tools — daemon wire contract (PROTOCOL.md §5.5)', () => {
  const workspaceId = 'ws-wire';

  beforeEach(() => {
    mockRequest.mockReset();
    // C1d-5: reads route entirely through the wire mock; handler stubs for
    // retired read paths (`listAllAgents`/`listAgents`/`getAgent`) are no
    // longer needed at this seam.
  });

  it('GetAgentStatusTool reads via agent.getSession (PROTOCOL.md §5.5)', async () => {
    // C1d-5: `get_agent_status` collapses onto a single `agent.getSession`
    // call — the pre-C1d-5 handler-first fallback chain is retired.
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.getSession') {
        return {
          session: {
            id: 'a-1',
            name: 'A',
            status: 'idle',
            messages: [],
            isStreaming: false,
            isResponding: false,
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { GetAgentStatusTool } = await import('../agent-interaction-tools');
    const tool = new GetAgentStatusTool(workspaceId);
    await tool.execute({
      name: 'get_agent_status',
      arguments: { agentId: 'a-1' },
      context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
    } as any);
    expect(mockRequest).toHaveBeenCalledWith('agent.getSession', {
      agentId: 'a-1',
      workspaceId,
    });
  });

  it('ListAgentsTool reads via agent.list (PROTOCOL.md §5.5)', async () => {
    // C1d-5: `list_agents` reads daemon-primary; the request must carry
    // `{ workspaceId }` and no other params, and the AgentLite response
    // shape drives the tool's projection.
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.list') {
        return { agents: [] };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { ListAgentsTool } = await import('../agent-interaction-tools');
    const tool = new ListAgentsTool(workspaceId);
    await tool.execute({
      name: 'list_agents',
      arguments: {},
      context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
    } as any);
    expect(mockRequest).toHaveBeenCalledWith('agent.list', { workspaceId });
  });

  it('GetAgentDiagnosticsTool reads via agent.list (PROTOCOL.md §5.5)', async () => {
    // C1d-5: `get_agent_diagnostics` collapses the pre-C1d-5 dual read
    // (`handler.listAllAgents` + `handler.listAgents`) onto a single
    // `agent.list` call; per-agent detail still routes through `agent.get`.
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.list') {
        return { agents: [] };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { GetAgentDiagnosticsTool } = await import('../agent-interaction-tools');
    const tool = new GetAgentDiagnosticsTool(workspaceId);
    await tool.execute({
      name: 'get_agent_diagnostics',
      arguments: {},
      context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
    } as any);
    expect(mockRequest).toHaveBeenCalledWith('agent.list', { workspaceId });
  });

  it('ReadAgentConversationTool calls agent.get + agent.getConversation', async () => {
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.get') {
        return { agent: { id: 'a-1', name: 'A', metadata: {} } };
      }
      if (method === 'agent.getConversation') {
        return { messages: [] };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { ReadAgentConversationTool } = await import('../agent-interaction-tools');
    const tool = new ReadAgentConversationTool(workspaceId);
    await tool.execute({
      name: 'read_agent_conversation',
      arguments: { agentId: 'a-1' },
      context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
    } as any);
    const methods = mockRequest.mock.calls.map((c) => c[0]);
    expect(methods).toContain('agent.get');
    expect(methods).toContain('agent.getConversation');
    for (const call of mockRequest.mock.calls) {
      expect(call[1]).toEqual({ agentId: 'a-1', workspaceId });
    }
  });

  it('GetAgentSummaryTool calls agent.get + agent.getConversation', async () => {
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.get') {
        return { agent: { id: 'a-1', name: 'A', status: 'idle', metadata: {} } };
      }
      if (method === 'agent.getConversation') {
        return { messages: [] };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { GetAgentSummaryTool } = await import('../agent-interaction-tools');
    const tool = new GetAgentSummaryTool(workspaceId);
    await tool.execute({
      name: 'get_agent_summary',
      arguments: { agentId: 'a-1' },
      context: { workspaceId, agentId: 'requester', agentName: 'Requester' },
    } as any);
    const methods = mockRequest.mock.calls.map((c) => c[0]);
    expect(methods).toEqual(
      expect.arrayContaining(['agent.get', 'agent.getConversation']),
    );
  });

  it('ReportToParentTool persists via agent.reportToParent with only { report }', async () => {
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.get') {
        return {
          agent: { id: 'child', name: 'Child', metadata: { createdByAgentId: 'parent' } },
        };
      }
      if (method === 'agent.reportToParent') {
        return { success: true };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { ReportToParentTool } = await import('../agent-interaction-tools');
    const tool = new ReportToParentTool(workspaceId);
    const result = await tool.execute({
      name: 'report_to_parent',
      arguments: { report: '  All green.  ' },
      context: { workspaceId, agentId: 'child', agentName: 'Child' },
    } as any);
    expect(result.isError).toBe(false);
    const rtp = mockRequest.mock.calls.find((c) => c[0] === 'agent.reportToParent');
    expect(rtp).toBeDefined();
    // PROTOCOL.md §5.5 declares only `report` on the wire; the daemon derives
    // the caller (delegated child) from the JSON-RPC connection context.
    expect(rtp?.[1]).toEqual({ report: 'All green.' });
  });

  it('getDelegationDepth reads metadata.delegationDepth via agent.get', async () => {
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.get') {
        return { agent: { metadata: { delegationDepth: 1 } } };
      }
      throw new Error(`unexpected ${method}`);
    });
    // The helper is not exported directly; exercise it via CreateAgentTool's
    // depth check by attempting to spawn a child from a depth-1 caller. We
    // do NOT complete the create — the assertion below only cares that
    // getDelegationDepth called `agent.get` first.
    const { CreateAgentTool } = await import('../agent-interaction-tools');
    const tool = new CreateAgentTool(workspaceId, '/tmp');
    await tool.execute({
      name: 'create_agent',
      arguments: {
        name: 'Child',
        initialMessage: 'do',
        specialist: 'implementor',
        taskNoteId: 'existing-task-note',
      },
      context: { workspaceId, agentId: 'parent', agentName: 'Parent' },
    } as any);
    expect(mockRequest).toHaveBeenCalledWith('agent.get', {
      agentId: 'parent',
      workspaceId,
    });
  });

  // C1d-6 wire contracts for the write/wake paths that used to route through
  // the retired `AgentBackendHandler`. Each asserts the exact JSON-RPC
  // method + params the tools emit per PROTOCOL.md §5.5.

  it('CreateAgentTool writes via agent.create with metadata-hoisted specialist fields', async () => {
    mockRequest.mockImplementation(async (method: string, params: any) => {
      if (method === 'agent.get') return { agent: { metadata: { delegationDepth: 0 } } };
      if (method === 'agent.create') {
        return { agent: { id: 'wire-create-1', name: params?.name ?? 'Child' } };
      }
      if (method === 'agent.sendMessage') return { success: true, queued: false };
      throw new Error(`unexpected ${method}`);
    });
    const { CreateAgentTool } = await import('../agent-interaction-tools');
    const tool = new CreateAgentTool(workspaceId, '/tmp');
    const result = await tool.execute({
      name: 'create_agent',
      arguments: { name: 'Wire Child', initialMessage: 'hello', specialist: 'implementor' },
      context: { workspaceId, agentId: 'wire-parent', agentName: 'Wire Parent' },
    } as any);
    expect(result.isError).toBe(false);
    const createCall = mockRequest.mock.calls.find((c) => c[0] === 'agent.create');
    expect(createCall).toBeDefined();
    // Specialist trio (`behaviorPrompt` / `specialistName` / `roleReminder`)
    // and the pre-first-turn `initialMessage` fold into `metadata` per the
    // widened `agent.create` seam. Top-level wire params carry the daemon-owned
    // fields (`workspaceId` / `name` / `workspacePath` / `model` / `provider` /
    // `agentType` / `metadata`).
    expect(createCall?.[1]).toEqual(
      expect.objectContaining({
        workspaceId,
        name: 'Wire Child',
        workspacePath: '/tmp',
        metadata: expect.objectContaining({
          createdByAgentId: 'wire-parent',
          isBackground: true,
          behaviorPrompt: expect.stringContaining('implementor'),
          specialistName: 'Implementor',
          initialMessage: 'hello',
        }),
      }),
    );
    // Post-create initial send follows immediately on the same session.
    const sendCall = mockRequest.mock.calls.find((c) => c[0] === 'agent.sendMessage');
    expect(sendCall?.[1]).toEqual(
      expect.objectContaining({ workspaceId, agentId: 'wire-create-1', content: 'hello' }),
    );
  });

  it('WakeOrCreateTaskAgentTool wakes via agent.sendMessage on the assigned agent', async () => {
    mockRequest.mockImplementation(async (method: string, params: any) => {
      if (method === 'note.get') {
        return {
          note: {
            id: 'wire-task',
            title: 'Wire task',
            metadata: { task: { assignedAgentIds: ['wire-target'] } },
          },
        };
      }
      if (method === 'agent.getSession') {
        return { session: { id: 'wire-target', isStreaming: false, isResponding: false } };
      }
      if (method === 'agent.sendMessage') return { success: true, queued: false };
      if (method === 'task.assignAgent') {
        return { ok: true, noteId: params?.noteId, agentId: params?.agentId };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { WakeOrCreateTaskAgentTool } = await import('../agent-interaction-tools');
    const tool = new WakeOrCreateTaskAgentTool(workspaceId, '/tmp');
    const result = await tool.execute({
      name: 'wake_or_create_task_agent',
      arguments: { taskNoteId: 'wire-task', contextMessage: 'Please continue.' },
      context: { workspaceId, agentId: 'wire-caller', agentName: 'Wire Caller' },
    } as any);
    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({ action: 'woke_existing', agentId: 'wire-target' });
    const sendCall = mockRequest.mock.calls.find((c) => c[0] === 'agent.sendMessage');
    expect(sendCall?.[1]).toEqual(
      expect.objectContaining({
        workspaceId,
        agentId: 'wire-target',
        content: 'Please continue.',
        messageMetadata: expect.objectContaining({
          taskNoteId: 'wire-task',
          source: 'wake_or_create_task_agent',
        }),
      }),
    );
  });

  it('WakeOrCreateTaskAgentTool queued branch flips on { queued: true } from agent.sendMessage', async () => {
    // Post-C1d-6 the daemon auto-queues when the target is mid-turn and
    // reports `{ success: true, queued: true, messageId }`. The tool must
    // take the "message queued to active agent" path without falling back to
    // a duplicate `agent.create` (regression guard for the flipped
    // ALREADY_STREAMING branch).
    mockRequest.mockImplementation(async (method: string, params: any) => {
      if (method === 'note.get') {
        return {
          note: {
            id: 'wire-queued',
            title: 'Wire queued task',
            metadata: { task: { assignedAgentIds: ['wire-active'] } },
          },
        };
      }
      if (method === 'agent.getSession') {
        return { session: { id: 'wire-active', isStreaming: true, isResponding: false } };
      }
      if (method === 'agent.sendMessage') {
        return { success: true, queued: true, messageId: 'msg-wire-queued' };
      }
      if (method === 'task.assignAgent') {
        return { ok: true, noteId: params?.noteId, agentId: params?.agentId };
      }
      throw new Error(`unexpected ${method}`);
    });
    const { WakeOrCreateTaskAgentTool } = await import('../agent-interaction-tools');
    const tool = new WakeOrCreateTaskAgentTool(workspaceId, '/tmp');
    const result = await tool.execute({
      name: 'wake_or_create_task_agent',
      arguments: { taskNoteId: 'wire-queued', contextMessage: 'Queue me.' },
      context: { workspaceId, agentId: 'wire-caller', agentName: 'Wire Caller' },
    } as any);
    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      action: 'message_queued_to_active_agent',
      agentId: 'wire-active',
      taskNoteId: 'wire-queued',
      queuedMessageId: 'msg-wire-queued',
    });
    // No duplicate agent creation — `agent.create` must not appear on the wire.
    expect(mockRequest.mock.calls.some((c) => c[0] === 'agent.create')).toBe(false);
  });
});

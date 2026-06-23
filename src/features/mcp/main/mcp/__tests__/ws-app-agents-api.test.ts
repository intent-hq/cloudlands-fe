import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAgentHandler, mockAgentPersistence, mockWorkspaceSubscriptionState } = vi.hoisted(
  () => ({
    mockAgentHandler: {
      listAllAgents: vi.fn(),
      getAgent: vi.fn(),
    },
    mockAgentPersistence: {
      loadAgent: vi.fn(),
    },
    mockWorkspaceSubscriptionState: {
      agentStatuses: {} as Record<string, string>,
    },
  }),
);

vi.mock('$features/agent/main/agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: () => mockAgentHandler,
  },
}));

vi.mock('../../../../agent/main/agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: () => mockAgentHandler,
  },
}));

vi.mock('$features/agent/main/agent-persistence', () => ({
  agentPersistence: mockAgentPersistence,
}));

vi.mock('../../../../agent/main/agent-persistence', () => ({
  agentPersistence: mockAgentPersistence,
}));

vi.mock('../../../../../store/main/redux-store-bridge', () => ({
  getMainState: () => ({}),
}));

vi.mock(
  '../../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors',
  () => ({
    selectAgentStatus: {
      select: (_state: any, _workspaceId: string, agentId: string) =>
        mockWorkspaceSubscriptionState.agentStatuses[agentId],
    },
  }),
);

import { buildWsAppAgentsApi } from '../ws-app-agents-api';

const workspaces = [
  { id: 'workspace-1', title: 'Alpha', status: 'Active', updatedAt: '2026-06-01T00:00:00.000Z' },
  { id: 'workspace-2', title: 'Beta', status: 'Archived', updatedAt: '2026-06-02T00:00:00.000Z' },
  { id: '__chief__', title: 'Chief', status: 'Active' },
];

function makeManager() {
  return {
    listAllWorkspaces: vi.fn().mockResolvedValue({ ok: true, data: workspaces }),
    getWorkspace: vi.fn((id: string) =>
      Promise.resolve(workspaces.find((w) => w.id === id) ?? null),
    ),
  };
}

function message(index: number, blocks: any[] = [{ type: 'text', text: `message-${index}` }]) {
  return {
    id: `msg-${index}`,
    role: index % 2 ? 'user' : 'assistant',
    timestamp: `2026-06-01T00:${String(index).padStart(2, '0')}:00.000Z`,
    contentBlocks: blocks,
  };
}

describe('buildWsAppAgentsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceSubscriptionState.agentStatuses = {};
    mockAgentHandler.getAgent.mockResolvedValue(null);
  });

  it('lists cross-workspace agent thread metadata without transcript content', async () => {
    const manager = makeManager();
    mockAgentHandler.listAllAgents.mockImplementation((workspaceId: string) =>
      Promise.resolve(
        workspaceId === 'workspace-1'
          ? [
              {
                id: 'agent-1',
                name: 'Alpha Agent',
                status: 'completed',
                metadata: { taskNoteId: 'task-1', messageCount: 7 },
                messages: [{ content: 'SECRET_TRANSCRIPT' }],
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:05:00.000Z',
                lastActivity: '2026-06-01T00:10:00.000Z',
              },
            ]
          : [
              {
                id: 'agent-2',
                name: 'Beta Agent',
                status: 'responding',
                metadata: { taskNoteId: 'task-2', messageCount: 3 },
                lastActivity: '2026-06-02T00:10:00.000Z',
              },
            ],
      ),
    );

    const result = await buildWsAppAgentsApi(manager).list({ limit: 1 });

    expect(result).toMatchObject({ total: 2, returned: 1, nextCursor: '1' });
    expect(result.threads[0]).toMatchObject({
      workspaceId: 'workspace-2',
      workspaceTitle: 'Beta',
      agentId: 'agent-2',
      agentName: 'Beta Agent',
      messageCount: 3,
      taskNoteId: 'task-2',
    });
    expect(JSON.stringify(result)).not.toContain('SECRET_TRANSCRIPT');
    expect(manager.listAllWorkspaces).toHaveBeenCalledWith({ lite: true });
    expect(mockAgentHandler.listAllAgents).toHaveBeenCalledWith('workspace-1');
    expect(mockAgentHandler.listAllAgents).toHaveBeenCalledWith('workspace-2');
  });

  it('filters completed threads when includeCompleted is false', async () => {
    const manager = makeManager();
    mockAgentHandler.listAllAgents.mockResolvedValue([
      { id: 'agent-complete', name: 'Done', status: 'completed' },
      { id: 'agent-live', name: 'Live', status: 'idle' },
    ]);

    const result = await buildWsAppAgentsApi(manager).list({
      workspaceId: 'workspace-1',
      includeCompleted: false,
    });

    expect(result.threads.map((thread) => thread.agentId)).toEqual(['agent-live']);
    expect(manager.getWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(mockAgentHandler.listAllAgents).toHaveBeenCalledTimes(1);
  });

  it('reads a bounded conversation and excludes tool calls by default', async () => {
    const messages = Array.from({ length: 25 }, (_, index) =>
      index === 24
        ? message(25, [
            { type: 'text', text: 'visible' },
            { type: 'tool_use', name: 'secret_tool', input: { token: 'SECRET_TOOL_INPUT' } },
            { type: 'tool_result', output: 'SECRET_TOOL_OUTPUT' },
          ])
        : message(index + 1),
    );
    mockAgentPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: 'agent-1',
        workspaceId: 'workspace-1',
        name: 'Alpha Agent',
        status: 'completed',
        metadata: { taskNoteId: 'task-1' },
        messages,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:30:00.000Z',
      },
    });

    const result = await buildWsAppAgentsApi(makeManager()).readConversation(
      'workspace-1',
      'agent-1',
    );

    expect(result).toMatchObject({
      totalMessages: 25,
      returnedMessages: 20,
      startTurn: 6,
      endTurn: 25,
      includeToolCalls: false,
      taskNoteId: 'task-1',
    });
    expect(JSON.stringify(result.messages)).toContain('visible');
    expect(JSON.stringify(result.messages)).not.toContain('SECRET_TOOL_INPUT');
    expect(JSON.stringify(result.messages)).not.toContain('SECRET_TOOL_OUTPUT');
  });

  it('supports explicit ranges and includeToolCalls for conversation reads', async () => {
    mockAgentPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: 'agent-1',
        workspaceId: 'workspace-1',
        name: 'Alpha Agent',
        status: 'idle',
        messages: [
          message(1),
          message(2, [{ type: 'tool_use', name: 'allowed_tool', input: { ok: true } }]),
          message(3),
        ],
      },
    });

    const result = await buildWsAppAgentsApi(makeManager()).readConversation(
      'workspace-1',
      'agent-1',
      {
        startTurn: 2,
        endTurn: 2,
        includeToolCalls: true,
      },
    );

    expect(result).toMatchObject({
      returnedMessages: 1,
      startTurn: 2,
      endTurn: 2,
      includeToolCalls: true,
    });
    expect(result.messages[0].contentBlocks?.[0]).toMatchObject({
      type: 'tool_use',
      name: 'allowed_tool',
    });
  });

  it('omits tool-only messages when tool calls are excluded', async () => {
    mockAgentPersistence.loadAgent.mockResolvedValue({
      success: true,
      data: {
        id: 'agent-1',
        workspaceId: 'workspace-1',
        name: 'Alpha Agent',
        status: 'idle',
        messages: [
          message(1),
          message(2, [
            { type: 'tool_use', name: 'secret_tool', input: { token: 'SECRET_TOOL_INPUT' } },
            { type: 'tool_result', output: 'SECRET_TOOL_OUTPUT' },
          ]),
          message(3, [
            { type: 'text', text: 'visible' },
            { type: 'tool_result', output: 'SECRET_MIXED_TOOL_OUTPUT' },
          ]),
        ],
      },
    });

    const api = buildWsAppAgentsApi(makeManager());
    const withoutTools = await api.readConversation('workspace-1', 'agent-1');
    const withTools = await api.readConversation('workspace-1', 'agent-1', {
      includeToolCalls: true,
    });

    expect(withoutTools).toMatchObject({
      totalMessages: 3,
      returnedMessages: 2,
      includeToolCalls: false,
    });
    expect(withoutTools.messages.map((msg) => msg.id)).toEqual(['msg-1', 'msg-3']);
    expect(withoutTools.messages.every((msg) => msg.contentBlocks?.length)).toBe(true);
    expect(JSON.stringify(withoutTools.messages)).not.toContain('SECRET_TOOL_INPUT');
    expect(JSON.stringify(withoutTools.messages)).not.toContain('SECRET_TOOL_OUTPUT');
    expect(JSON.stringify(withoutTools.messages)).not.toContain('SECRET_MIXED_TOOL_OUTPUT');
    expect(JSON.stringify(withoutTools.messages)).toContain('visible');

    expect(withTools).toMatchObject({ returnedMessages: 3, includeToolCalls: true });
    expect(withTools.messages[1].contentBlocks).toEqual([
      { type: 'tool_use', name: 'secret_tool', input: { token: 'SECRET_TOOL_INPUT' } },
      { type: 'tool_result', output: 'SECRET_TOOL_OUTPUT' },
    ]);
  });
});

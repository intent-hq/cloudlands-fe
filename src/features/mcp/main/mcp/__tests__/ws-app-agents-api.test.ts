import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequest, mockWorkspaceSubscriptionState } = vi.hoisted(() => ({
  // C1d-4: ws-app-agents-api now reads daemon-primary (PROTOCOL.md §5.5):
  // `list` → `agent.list`, `loadAgentSession` → `agent.getSession` (single
  // full-session call — no agent.get + agent.getConversation fallback).
  mockRequest: vi.fn(),
  mockWorkspaceSubscriptionState: {
    agentStatuses: {} as Record<string, string>,
  },
}));

vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
}));

vi.mock('../../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
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

function stubAgentListPerWorkspace(agentsByWorkspace: Record<string, any[]>) {
  mockRequest.mockImplementation(async (method: string, params: any) => {
    if (method === 'agent.list') {
      const workspaceId = String(params?.workspaceId ?? '');
      return { agents: agentsByWorkspace[workspaceId] ?? [] };
    }
    throw new Error(`unhandled RPC: ${method}`);
  });
}

function stubDaemonAgentLoad(response: { success: boolean; data?: any; error?: string }) {
  mockRequest.mockImplementation(async (method: string) => {
    if (method === 'agent.getSession') {
      if (!response.success || !response.data) {
        throw new Error(response.error || 'agent not found');
      }
      return { session: response.data };
    }
    throw new Error(`unhandled RPC: ${method}`);
  });
}

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
    mockRequest.mockReset();
    mockWorkspaceSubscriptionState.agentStatuses = {};
  });

  it('lists cross-workspace agent thread metadata without transcript content', async () => {
    const manager = makeManager();
    // Daemon returns AgentLite-shaped entries per PROTOCOL.md §5.5 `agent.list`.
    stubAgentListPerWorkspace({
      'workspace-1': [
        {
          id: 'agent-1',
          name: 'Alpha Agent',
          status: 'completed',
          messageCount: 7,
          metadata: { taskNoteId: 'task-1' },
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:05:00.000Z',
          lastActivity: '2026-06-01T00:10:00.000Z',
        },
      ],
      'workspace-2': [
        {
          id: 'agent-2',
          name: 'Beta Agent',
          status: 'responding',
          messageCount: 3,
          metadata: { taskNoteId: 'task-2' },
          lastActivity: '2026-06-02T00:10:00.000Z',
        },
      ],
    });

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
    expect(manager.listAllWorkspaces).toHaveBeenCalledWith({ lite: true });
    const listCalls = mockRequest.mock.calls.filter((c) => c[0] === 'agent.list');
    expect(listCalls.map((c) => c[1])).toEqual([
      { workspaceId: 'workspace-1' },
      { workspaceId: 'workspace-2' },
    ]);
  });

  it('filters completed threads when includeCompleted is false', async () => {
    const manager = makeManager();
    // PROTOCOL.md §5.5 `agent.list` — AgentLite entries only.
    stubAgentListPerWorkspace({
      'workspace-1': [
        { id: 'agent-complete', name: 'Done', status: 'completed' },
        { id: 'agent-live', name: 'Live', status: 'idle' },
      ],
    });

    const result = await buildWsAppAgentsApi(manager).list({
      workspaceId: 'workspace-1',
      includeCompleted: false,
    });

    expect(result.threads.map((thread) => thread.agentId)).toEqual(['agent-live']);
    expect(manager.getWorkspace).toHaveBeenCalledWith('workspace-1');
    const listCalls = mockRequest.mock.calls.filter((c) => c[0] === 'agent.list');
    expect(listCalls).toEqual([['agent.list', { workspaceId: 'workspace-1' }]]);
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
    stubDaemonAgentLoad({
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
    stubDaemonAgentLoad({
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
    stubDaemonAgentLoad({
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


describe('buildWsAppAgentsApi — daemon wire contract (PROTOCOL.md §5.5)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('readConversation loads via a single agent.getSession call (PROTOCOL.md §5.5)', async () => {
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'agent.getSession') {
        return {
          session: {
            id: 'agent-1',
            name: 'Alpha Agent',
            status: 'idle',
            metadata: { taskNoteId: 'task-1' },
            messages: [],
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });

    await buildWsAppAgentsApi(makeManager()).readConversation('workspace-1', 'agent-1');

    const methods = mockRequest.mock.calls.map((c) => c[0]);
    expect(methods).toEqual(['agent.getSession']);
    expect(mockRequest.mock.calls[0][1]).toEqual({
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
    });
  });

  it('list issues one agent.list per readable workspace (PROTOCOL.md §5.5)', async () => {
    stubAgentListPerWorkspace({
      'workspace-1': [
        {
          id: 'agent-1',
          name: 'Alpha Agent',
          status: 'idle',
          messageCount: 2,
          lastActivity: '2026-06-01T00:10:00.000Z',
        },
      ],
      'workspace-2': [],
    });

    const result = await buildWsAppAgentsApi(makeManager()).list();

    const listCalls = mockRequest.mock.calls.filter((c) => c[0] === 'agent.list');
    expect(listCalls.map((c) => c[1])).toEqual([
      { workspaceId: 'workspace-1' },
      { workspaceId: 'workspace-2' },
    ]);
    expect(result.threads.map((t) => t.agentId)).toEqual(['agent-1']);
  });
});

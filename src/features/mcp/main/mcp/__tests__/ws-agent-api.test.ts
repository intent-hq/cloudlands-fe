import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequest, mockWorkspaceSubscriptionState } = vi.hoisted(() => ({
  // C1d-4: ws-agent-api reads daemon-primary (PROTOCOL.md §5.5): `list` →
  // `agent.list`, `status`/`readConversation`/`summary` → `agent.getSession`
  // (single full-session call). No AgentBackendHandler paths remain.
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
  mainDispatch: vi.fn(),
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

import { buildAgentApi } from '../ws-agent-api';

const CALL = {
  name: 'noop',
  arguments: {},
  context: {
    workspaceId: 'workspace-1',
    workspacePath: '/tmp/workspace-1',
    callerAgentId: 'agent-caller',
  },
} as any;

function api() {
  return buildAgentApi('workspace-1', '/tmp/workspace-1', CALL);
}

function message(index: number, blocks: any[] = [{ type: 'text', text: `message-${index}` }]) {
  return {
    id: `msg-${index}`,
    role: index % 2 ? 'user' : 'assistant',
    timestamp: `2026-06-01T00:${String(index).padStart(2, '0')}:00.000Z`,
    contentBlocks: blocks,
  };
}

describe('buildAgentApi — daemon wire contract (PROTOCOL.md §5.5)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockWorkspaceSubscriptionState.agentStatuses = {};
  });

  describe('list', () => {
    it('issues a single agent.list({ workspaceId }) and projects AgentLite entries', async () => {
      mockRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.list') {
          return {
            agents: [
              {
                id: 'agent-live',
                name: 'Live',
                status: 'responding',
                messageCount: 3,
                isStreaming: false,
                isResponding: true,
                metadata: { taskNoteId: 'task-1' },
                createdAt: '2026-06-01T00:00:00.000Z',
                lastActivity: '2026-06-01T00:10:00.000Z',
              },
              {
                id: 'agent-done',
                name: 'Done',
                status: 'completed',
                messageCount: 5,
                isStreaming: false,
                isResponding: false,
                metadata: { taskNoteId: 'task-2' },
              },
            ],
          };
        }
        throw new Error(`unexpected ${method}`);
      });

      const result = await api().list(false);

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('agent.list', { workspaceId: 'workspace-1' });
      expect(result.map((a) => a.id)).toEqual(['agent-live']);
      expect(result[0]).toMatchObject({
        id: 'agent-live',
        name: 'Live',
        status: 'responding',
        sessionStatus: 'responding',
        presentInBackend: true,
        messageCount: 3,
        taskNoteId: 'task-1',
      });
    });

    it('preserves the active-set derivation via isStreaming || isResponding', async () => {
      mockRequest.mockResolvedValue({
        agents: [
          { id: 'a-stream', name: 'Streaming', status: 'idle', isStreaming: true },
          { id: 'a-resp', name: 'Responding', status: 'idle', isResponding: true },
          { id: 'a-quiet', name: 'Quiet', status: 'idle' },
        ],
      });

      const result = await api().list(true);

      const map = new Map(result.map((a) => [a.id, a.presentInBackend]));
      expect(map.get('a-stream')).toBe(true);
      expect(map.get('a-resp')).toBe(true);
      expect(map.get('a-quiet')).toBe(false);
    });

    it('returns completed agents when includeCompleted=true', async () => {
      mockRequest.mockResolvedValue({
        agents: [
          { id: 'a1', name: 'One', status: 'completed' },
          { id: 'a2', name: 'Two', status: 'failed' },
          { id: 'a3', name: 'Three', status: 'idle' },
        ],
      });

      const result = await api().list(true);
      expect(result.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    });
  });

  describe('status', () => {
    it('reads a single agent.getSession and derives presentInBackend from §5.5 flags', async () => {
      mockRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.getSession') {
          return {
            session: {
              id: 'agent-1',
              name: 'Alpha',
              status: 'responding',
              isResponding: true,
              metadata: { taskNoteId: 'task-1', messageCount: 4 },
              messages: [],
              createdAt: '2026-06-01T00:00:00.000Z',
              lastActivity: '2026-06-01T00:05:00.000Z',
            },
          };
        }
        throw new Error(`unexpected ${method}`);
      });

      const info = await api().status('agent-1');

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('agent.getSession', {
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
      });
      expect(info).toMatchObject({
        id: 'agent-1',
        name: 'Alpha',
        status: 'responding',
        sessionStatus: 'responding',
        presentInBackend: true,
        taskNoteId: 'task-1',
      });
    });

    it('throws when agent.getSession does not return a session', async () => {
      mockRequest.mockResolvedValue({});
      await expect(api().status('agent-missing')).rejects.toThrow('Agent agent-missing not found');
      expect(mockRequest).toHaveBeenCalledWith('agent.getSession', {
        agentId: 'agent-missing',
        workspaceId: 'workspace-1',
      });
    });

    it('throws when agent.getSession rejects (-32602 not found)', async () => {
      mockRequest.mockRejectedValue(new Error('Agent not found'));
      await expect(api().status('agent-nope')).rejects.toThrow('Agent agent-nope not found');
    });
  });

  describe('readConversation', () => {
    it('reads a single agent.getSession and returns the full transcript', async () => {
      const messages = [message(1), message(2), message(3)];
      mockRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.getSession') {
          return {
            session: {
              id: 'agent-1',
              name: 'Alpha',
              status: 'idle',
              metadata: { taskNoteId: 'task-1' },
              messages,
            },
          };
        }
        throw new Error(`unexpected ${method}`);
      });

      const result = await api().readConversation('agent-1');

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('agent.getSession', {
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
      });
      expect(result).toMatchObject({
        agentId: 'agent-1',
        agentName: 'Alpha',
        totalMessages: 3,
        returnedMessages: 3,
        taskNoteId: 'task-1',
      });
      expect(result.messages.map((m: any) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });

    it('applies lastN slicing to the transcript from agent.getSession', async () => {
      const messages = Array.from({ length: 10 }, (_, i) => message(i + 1));
      mockRequest.mockResolvedValue({
        session: {
          id: 'agent-1',
          name: 'Alpha',
          status: 'idle',
          messages,
        },
      });

      const result = await api().readConversation('agent-1', { lastN: 3 });
      expect(result.totalMessages).toBe(10);
      expect(result.returnedMessages).toBe(3);
      expect(result.messages.map((m: any) => m.id)).toEqual(['msg-8', 'msg-9', 'msg-10']);
    });

    it('throws a generic error when the daemon rejects the getSession call', async () => {
      mockRequest.mockRejectedValue(new Error('boom'));
      await expect(api().readConversation('agent-x')).rejects.toThrow(
        'Agent "agent-x" not found or could not be loaded',
      );
    });
  });

  describe('summary', () => {
    it('reads a single agent.getSession and summarises the transcript', async () => {
      const messages = [
        { ...message(1, [{ type: 'text', text: 'user hello' }]), role: 'user' },
        {
          ...message(2, [
            { type: 'tool_use', name: 'search_files', input: {} },
            { type: 'tool_use', name: 'search_files', input: {} },
          ]),
          role: 'assistant',
        },
        { ...message(3, [{ type: 'text', text: 'final reply' }]), role: 'assistant' },
      ];
      mockRequest.mockImplementation(async (method: string) => {
        if (method === 'agent.getSession') {
          return {
            session: {
              id: 'agent-1',
              name: 'Alpha',
              status: 'idle',
              metadata: { taskNoteId: 'task-1' },
              messages,
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:03:00.000Z',
            },
          };
        }
        throw new Error(`unexpected ${method}`);
      });

      const result = await api().summary('agent-1');

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith('agent.getSession', {
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
      });
      expect(result).toMatchObject({
        agentId: 'agent-1',
        agentName: 'Alpha',
        status: 'idle',
        messageCount: 3,
        taskNoteId: 'task-1',
        toolCallCounts: { search_files: 2 },
        lastResponse: 'final reply',
      });
    });

    it('throws a generic error when the daemon rejects the getSession call', async () => {
      mockRequest.mockRejectedValue(new Error('boom'));
      await expect(api().summary('agent-x')).rejects.toThrow(
        'Agent "agent-x" not found or could not be loaded',
      );
    });
  });
});

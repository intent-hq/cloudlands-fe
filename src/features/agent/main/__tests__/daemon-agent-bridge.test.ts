import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import type { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { JsonRpcError } from '../../../backend/main/json-rpc-errors';

const mockRequest = vi.fn();

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
}));

const { daemonAgentBridge } = await import('../daemon-agent-bridge');

const AGENT_ID = 'agent-1' as AgentId;
const WORKSPACE_ID = 'ws-1' as WorkspaceId;

const baseSession = (): AgentSession =>
  ({
    id: AGENT_ID,
    workspaceId: WORKSPACE_ID,
    backendSessionId: null,
    name: 'Test Agent',
    status: AgentStatus.Idle,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as AgentSession;

const message = (role: 'user' | 'assistant' = 'user') =>
  ({
    id: 'msg-1',
    role,
    contentBlocks: [{ type: 'text', text: 'hi' }],
    timestamp: new Date().toISOString(),
  }) as any;

beforeEach(() => {
  mockRequest.mockReset();
});

describe('daemonAgentBridge', () => {
  describe('loadAgent', () => {
    it('unwraps session from agent.getSession', async () => {
      const session = baseSession();
      mockRequest.mockResolvedValueOnce({ session });
      const result = await daemonAgentBridge.loadAgent(AGENT_ID, WORKSPACE_ID);
      expect(mockRequest).toHaveBeenCalledWith('agent.getSession', {
        agentId: AGENT_ID,
        workspaceId: WORKSPACE_ID,
      });
      expect(result.success).toBe(true);
      expect(result.data).toBe(session);
    });

    it('returns failure on daemon error', async () => {
      mockRequest.mockRejectedValueOnce(new Error('not found'));
      const result = await daemonAgentBridge.loadAgent(AGENT_ID, WORKSPACE_ID);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('loadAgentSummary', () => {
    it('unwraps AgentLite from agent.get', async () => {
      const lite = { id: AGENT_ID, workspaceId: WORKSPACE_ID, name: 'x' } as any;
      mockRequest.mockResolvedValueOnce({ agent: lite });
      const result = await daemonAgentBridge.loadAgentSummary(AGENT_ID, WORKSPACE_ID);
      expect(mockRequest).toHaveBeenCalledWith('agent.get', {
        agentId: AGENT_ID,
        workspaceId: WORKSPACE_ID,
      });
      expect(result.data).toBe(lite);
    });
  });

  describe('saveAgent', () => {
    it('sends only whitelisted fields via agent.update', async () => {
      mockRequest.mockResolvedValueOnce({ success: true });
      const session = baseSession();
      session.acpSessionId = 'sess-1';
      (session as any).messages = [message()];
      (session as any).privateField = 'nope';
      const result = await daemonAgentBridge.saveAgent(session);
      expect(result.success).toBe(true);
      const call = mockRequest.mock.calls[0];
      expect(call[0]).toBe('agent.update');
      const { changes } = call[1] as { changes: Record<string, unknown> };
      expect(changes).toHaveProperty('status');
      expect(changes).toHaveProperty('acpSessionId', 'sess-1');
      expect(changes).not.toHaveProperty('messages');
      expect(changes).not.toHaveProperty('privateField');
    });

    it('short-circuits when no whitelisted field is present', async () => {
      const empty = { id: AGENT_ID, workspaceId: WORKSPACE_ID, messages: [] } as any;
      const result = await daemonAgentBridge.saveAgent(empty);
      expect(result.success).toBe(true);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('surfaces daemon rejection as SaveResult failure', async () => {
      mockRequest.mockRejectedValueOnce(new Error('boom'));
      const result = await daemonAgentBridge.saveAgent(baseSession());
      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
    });
  });

  describe('listAgents', () => {
    it('maps AgentLite[] → id[]', async () => {
      mockRequest.mockResolvedValueOnce({ agents: [{ id: 'a' }, { id: 'b' }] });
      const ids = await daemonAgentBridge.listAgents(WORKSPACE_ID);
      expect(ids).toEqual(['a', 'b']);
    });

    it('returns [] on daemon error', async () => {
      mockRequest.mockRejectedValueOnce(new Error('down'));
      expect(await daemonAgentBridge.listAgents(WORKSPACE_ID)).toEqual([]);
    });
  });

  describe('deleteAgent', () => {
    it('calls agent.delete', async () => {
      mockRequest.mockResolvedValueOnce({ success: true });
      const result = await daemonAgentBridge.deleteAgent(AGENT_ID, WORKSPACE_ID);
      expect(mockRequest).toHaveBeenCalledWith('agent.delete', {
        agentId: AGENT_ID,
        workspaceId: WORKSPACE_ID,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getMessages', () => {
    it('unwraps messages from agent.getConversation', async () => {
      const msgs = [message('assistant')];
      mockRequest.mockResolvedValueOnce({ messages: msgs });
      const result = await daemonAgentBridge.getMessages(AGENT_ID);
      expect(mockRequest).toHaveBeenCalledWith('agent.getConversation', { agentId: AGENT_ID });
      expect(result).toBe(msgs);
    });
  });

  describe('saveMessage', () => {
    it('calls agent.appendMessage with role/contentBlocks/metadata', async () => {
      mockRequest.mockResolvedValueOnce({ success: true });
      const m = { ...message('assistant'), metadata: { source: 'system' } };
      const result = await daemonAgentBridge.saveMessage(AGENT_ID, WORKSPACE_ID, m);
      expect(mockRequest).toHaveBeenCalledWith('agent.appendMessage', {
        agentId: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        role: 'assistant',
        contentBlocks: m.contentBlocks,
        metadata: { source: 'system' },
      });
      expect(result.success).toBe(true);
    });

    it('downgrades mid-turn -32602 to SaveResult failure without warning', async () => {
      mockRequest.mockRejectedValueOnce(new JsonRpcError({ code: -32602, message: 'mid turn' }));
      const result = await daemonAgentBridge.saveMessage(AGENT_ID, WORKSPACE_ID, message());
      expect(result.success).toBe(false);
      expect(result.error).toBe('mid turn');
    });
  });

  describe('replaceMessages', () => {
    it('calls agent.replaceMessages', async () => {
      mockRequest.mockResolvedValueOnce({ success: true });
      const msgs = [message(), message('assistant')];
      const result = await daemonAgentBridge.replaceMessages(AGENT_ID, WORKSPACE_ID, msgs);
      expect(mockRequest).toHaveBeenCalledWith('agent.replaceMessages', {
        agentId: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        messages: msgs,
      });
      expect(result.success).toBe(true);
    });

    it('downgrades mid-turn -32602 to SaveResult failure', async () => {
      mockRequest.mockRejectedValueOnce(new JsonRpcError({ code: -32602, message: 'mid turn' }));
      const result = await daemonAgentBridge.replaceMessages(AGENT_ID, WORKSPACE_ID, []);
      expect(result.success).toBe(false);
    });
  });
});

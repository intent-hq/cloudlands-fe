/**
 * Tests for MockAgentService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockAgentService } from '../agent-service.mock';
import { AgentStatus } from '$shared/types';

describe('MockAgentService', () => {
  let service: MockAgentService;

  beforeEach(() => {
    service = new MockAgentService();
  });

  describe('Agent Creation', () => {
    it('should create an agent', async () => {
      const agent = await service.createAgent({
        name: 'Test Agent',
        model: 'claude-opus',
        workspaceId: 'workspace-1',
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe('Test Agent');
      expect(agent.model).toBe('claude-opus');
      expect(agent.workspaceId).toBe('workspace-1');
      expect(agent.status).toBe(AgentStatus.Active);
    });

    it('should generate unique IDs', async () => {
      const agent1 = await service.createAgent({ name: 'Agent 1' });
      const agent2 = await service.createAgent({ name: 'Agent 2' });

      expect(agent1.id).not.toBe(agent2.id);
      expect(agent1.backendSessionId).not.toBe(agent2.backendSessionId);
    });

    it('should use default values', async () => {
      const agent = await service.createAgent({});

      expect(agent.name).toBe('Test Agent');
      expect(agent.model).toBe('claude-opus');
      expect(agent.workspaceId).toBe('test-workspace');
    });
  });

  describe('Agent Retrieval', () => {
    it('should get an agent by ID', async () => {
      const created = await service.createAgent({ name: 'Test Agent' });
      const retrieved = await service.getAgent(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent agent', async () => {
      const agent = await service.getAgent('non-existent');
      expect(agent).toBeNull();
    });

    it('should list all agents', async () => {
      await service.createAgent({ name: 'Agent 1' });
      await service.createAgent({ name: 'Agent 2' });

      const agents = await service.listAgents();
      expect(agents).toHaveLength(2);
    });

    it('should filter agents by workspace', async () => {
      await service.createAgent({
        name: 'Agent 1',
        workspaceId: 'workspace-1',
      });
      await service.createAgent({
        name: 'Agent 2',
        workspaceId: 'workspace-2',
      });

      const agents = await service.listAgents('workspace-1');
      expect(agents).toHaveLength(1);
      expect(agents[0].workspaceId).toBe('workspace-1');
    });
  });

  describe('Agent Deletion', () => {
    it('should delete an agent', async () => {
      const agent = await service.createAgent({ name: 'Test Agent' });
      await service.deleteAgent(agent.id);

      const retrieved = await service.getAgent(agent.id);
      expect(retrieved).toBeNull();
    });

    it('should delete agent messages', async () => {
      const agent = await service.createAgent({ name: 'Test Agent' });
      await service.sendMessage(agent.id, 'Hello');

      await service.deleteAgent(agent.id);

      const messages = await service.getMessages(agent.id);
      expect(messages).toHaveLength(0);
    });
  });

  describe('Message Operations', () => {
    it('should send a message', async () => {
      const agent = await service.createAgent({ name: 'Test Agent' });
      const message = await service.sendMessage(agent.id, 'Hello');

      expect(message).toBeDefined();
      expect(message.contentBlocks).toBeDefined();
      expect(message.contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Hello',
      });
      expect(message.role).toBe('user');
    });

    it('should get messages for an agent', async () => {
      const agent = await service.createAgent({ name: 'Test Agent' });
      await service.sendMessage(agent.id, 'Message 1');
      await service.sendMessage(agent.id, 'Message 2');

      const messages = await service.getMessages(agent.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Message 1',
      });
      expect(messages[1].contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Message 2',
      });
    });

    it('should add a message', async () => {
      const agent = await service.createAgent({ name: 'Test Agent' });
      const message = {
        id: 'msg-1',
        role: 'assistant' as const,
        content: 'Response',
        timestamp: new Date(),
      };

      await service.addMessage(agent.id, message);

      const messages = await service.getMessages(agent.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(message);
    });
  });

  describe('Call Logging', () => {
    it('should log method calls', async () => {
      const agent = await service.createAgent({ name: 'Test Agent' });
      await service.getAgent(agent.id);
      await service.listAgents();

      const log = service.getCallLog();
      expect(log.length).toBeGreaterThanOrEqual(3);
      expect(log[0].method).toBe('createAgent');
      expect(log[1].method).toBe('getAgent');
      expect(log[2].method).toBe('listAgents');
    });
  });

  describe('Clear Operations', () => {
    it('should clear all data', async () => {
      const agent = await service.createAgent({ name: 'Test Agent' });
      await service.sendMessage(agent.id, 'Hello');

      service.clear();

      const agents = await service.listAgents();
      expect(agents).toHaveLength(0);
      // After clear, only the listAgents call should be in the log
      expect(service.getCallLog()).toHaveLength(1);
      expect(service.getCallLog()[0].method).toBe('listAgents');
    });
  });
});

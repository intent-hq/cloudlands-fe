/**
 * Integration Tests for Mock Environment
 *
 * Demonstrates how to use all mocks together in a realistic scenario.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockEnvironment, cleanupMockEnvironment } from '../index';

describe('Mock Environment Integration', () => {
  let env: ReturnType<typeof createMockEnvironment>;

  beforeEach(() => {
    env = createMockEnvironment();
  });

  afterEach(() => {
    cleanupMockEnvironment(env);
  });

  describe('Complete Agent Workflow', () => {
    it('should handle a complete agent interaction', async () => {
      // 1. Create an agent
      const agent = await env.agentService.createAgent({
        name: 'Integration Test Agent',
        model: 'claude-opus',
        workspaceId: 'test-workspace',
      });

      expect(agent).toBeDefined();
      expect(agent.id).toBeDefined();

      // 2. Register the session
      if (!agent.backendSessionId) {
        throw new Error('Agent must have a backendSessionId');
      }
      await env.sessionRegistry.registerSession(
        agent.id,
        agent.backendSessionId,
        agent.workspaceId,
      );

      const registered = await env.sessionRegistry.getSession(agent.id);
      expect(registered).toBeDefined();
      expect(registered?.backendId).toBe(agent.backendSessionId);

      // 3. Start a stream
      const streamId = env.streaming.startStream(agent.id, agent.backendSessionId!);
      expect(streamId).toBeDefined();

      // 4. Add content to the stream
      env.streaming.addChunk(streamId, 'Hello from agent');
      env.streaming.addChunk(streamId, ' - this is a test');

      // 5. Complete the stream
      const message = await env.streaming.completeStream(streamId);
      expect(message.contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Hello from agent - this is a test',
      });

      // 6. Add the message to the agent
      await env.agentService.addMessage(agent.id, message);

      // 7. Persist the message
      await env.persistence.saveMessage(message, agent.backendSessionId!);

      // 8. Verify everything is persisted
      const messages = await env.persistence.loadMessages(agent.backendSessionId!);
      expect(messages).toHaveLength(1);
      expect(messages[0].contentBlocks?.[0].text).toBe('Hello from agent - this is a test');

      // 9. Verify agent state
      const agentMessages = await env.agentService.getMessages(agent.id);
      expect(agentMessages).toHaveLength(1);
    });

    it('should handle multiple agents in parallel', async () => {
      // Create multiple agents
      const agent1 = await env.agentService.createAgent({
        name: 'Agent 1',
        workspaceId: 'workspace-1',
      });

      const agent2 = await env.agentService.createAgent({
        name: 'Agent 2',
        workspaceId: 'workspace-1',
      });

      // Register both
      await env.sessionRegistry.registerSession(
        agent1.id,
        agent1.backendSessionId!,
        agent1.workspaceId,
      );

      await env.sessionRegistry.registerSession(
        agent2.id,
        agent2.backendSessionId!,
        agent2.workspaceId,
      );

      // Stream to both
      const stream1 = env.streaming.startStream(agent1.id, agent1.backendSessionId!);
      const stream2 = env.streaming.startStream(agent2.id, agent2.backendSessionId!);

      env.streaming.addChunk(stream1, 'Response 1');
      env.streaming.addChunk(stream2, 'Response 2');

      const msg1 = await env.streaming.completeStream(stream1);
      const msg2 = await env.streaming.completeStream(stream2);

      // Persist both
      await env.persistence.saveMessage(msg1, agent1.backendSessionId!);
      await env.persistence.saveMessage(msg2, agent2.backendSessionId!);

      // Verify
      const messages1 = await env.persistence.loadMessages(agent1.backendSessionId!);
      const messages2 = await env.persistence.loadMessages(agent2.backendSessionId!);

      expect(messages1).toHaveLength(1);
      expect(messages2).toHaveLength(1);
      expect(messages1[0].contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Response 1',
      });
      expect(messages2[0].contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Response 2',
      });
    });

    it('should track all operations for debugging', async () => {
      // Perform various operations
      const agent = await env.agentService.createAgent({
        name: 'Debug Test Agent',
      });

      await env.sessionRegistry.registerSession(agent.id, agent.backendSessionId!, 'workspace-1');

      await env.agentService.sendMessage(agent.id, 'Test message');
      await env.persistence.saveMetadata('test-key', { data: 'value' });

      // Check call logs
      const agentLog = env.agentService.getCallLog();
      const registryLog = env.sessionRegistry.getCallLog();
      const saveHistory = env.persistence.getSaveHistory();

      expect(agentLog.length).toBeGreaterThan(0);
      expect(registryLog.length).toBeGreaterThan(0);
      expect(saveHistory.length).toBeGreaterThan(0);

      // Verify specific operations
      expect(agentLog.some((l) => l.method === 'createAgent')).toBe(true);
      expect(agentLog.some((l) => l.method === 'sendMessage')).toBe(true);
      expect(registryLog.some((l) => l.method === 'registerSession')).toBe(true);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle non-existent resources gracefully', async () => {
      const agent = await env.agentService.getAgent('non-existent');
      expect(agent).toBeNull();

      const session = await env.sessionRegistry.getSession('non-existent');
      expect(session).toBeNull();

      const messages = await env.persistence.loadMessages('non-existent');
      expect(messages).toHaveLength(0);
    });

    it('should handle stream cleanup', async () => {
      const stream1 = env.streaming.startStream('agent-1', 'session-1');
      const stream2 = env.streaming.startStream('agent-2', 'session-2');

      let active = env.streaming.getActiveStreams();
      expect(active).toHaveLength(2);

      env.streaming.completeStream(stream1);

      // After a small delay, stream1 should be complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      active = env.streaming.getActiveStreams();
      expect(active.length).toBeLessThan(2);
    });
  });
});

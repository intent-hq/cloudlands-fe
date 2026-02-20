/**
 * Basic Integration Tests for Agent System
 * Tests core functionality using the test harness
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentTestHarness } from '../../src/features/agent/testing/agent-test-harness';

describe('Agent System Basic Integration Tests', () => {
  let harness: AgentTestHarness;

  beforeAll(async () => {
    harness = new AgentTestHarness({
      verbose: process.env.VERBOSE === 'true',
      memoryLeakThreshold: 50 * 1024 * 1024, // 50MB
    });
    await harness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  describe('Core Agent Operations', () => {
    it('should create and manage agents', async () => {
      const agent = await harness.createAgent({
        name: 'test-agent-1',
        model: 'test-model',
      });

      expect(agent).toBeDefined();
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBe('test-agent-1');
      expect(agent.model).toBe('test-model');
      expect(agent.messages).toHaveLength(0);
    });

    it('should send and receive messages', async () => {
      const agent = await harness.createAgent({ name: 'message-test' });

      const message = await harness.sendMessage(agent.id, 'Hello, test agent!');

      expect(message).toBeDefined();
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, test agent!');
      expect(message.id).toMatch(/^msg_/);

      // Check that response was added
      const session = harness['sessions'].get(agent.id);
      expect(session?.messages.length).toBeGreaterThan(1);

      const response = session?.messages.find((m) => m.role === 'assistant');
      expect(response).toBeDefined();
      expect(response?.id).toMatch(/^msg_/);
    });

    it('should handle streaming messages', async () => {
      const agent = await harness.createAgent({ name: 'stream-test' });

      const message = await harness.sendMessage(agent.id, 'Stream this response', {
        streaming: true,
      });

      expect(message).toBeDefined();

      const session = harness['sessions'].get(agent.id);
      const response = session?.messages.find((m) => m.role === 'assistant');
      expect(response?.contentBlocks?.[0]?.text).toBe('Hello from the test agent!');
    });
  });

  describe('Performance Metrics', () => {
    it('should track operation metrics', async () => {
      const agent = await harness.createAgent({ name: 'metrics-test' });

      // Send multiple messages
      for (let i = 0; i < 5; i++) {
        await harness.sendMessage(agent.id, `Message ${i}`);
      }

      const metrics = harness.getMetrics();

      expect(metrics.totalOperations).toBeGreaterThan(5);
      expect(metrics.performance.operationCount).toBeGreaterThan(5);
      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0);
      expect(metrics.averageResponseTime).toBeLessThan(1000);
    });

    it('should detect memory leaks', async () => {
      const leaks = await harness.detectMemoryLeaks();

      // In a test environment, we shouldn't have significant leaks
      const totalLeakSize = leaks.reduce((sum, leak) => sum + leak.size, 0);
      expect(totalLeakSize).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent agent creation', async () => {
      const promises = Array.from({ length: 3 }, (_, i) =>
        harness.createAgent({ name: `concurrent-${i}` }),
      );

      const agents = await Promise.all(promises);

      expect(agents).toHaveLength(3);
      agents.forEach((agent, i) => {
        expect(agent.name).toBe(`concurrent-${i}`);
      });
    });

    it('should handle concurrent message sending', async () => {
      const agent = await harness.createAgent({ name: 'concurrent-messages' });

      const promises = Array.from({ length: 3 }, (_, i) =>
        harness.sendMessage(agent.id, `Concurrent message ${i}`),
      );

      const messages = await Promise.all(promises);

      expect(messages).toHaveLength(3);
      messages.forEach((msg, i) => {
        expect(msg.content).toBe(`Concurrent message ${i}`);
      });
    });
  });

  describe('Test Scenarios', () => {
    it('should run a complete test scenario', async () => {
      let testAgentId: any;

      const metrics = await harness.runScenario({
        name: 'basic-flow',
        description: 'Test basic agent flow',
        execute: async (h) => {
          // Create agent
          const agent = await h.createAgent({ name: 'scenario-test' });
          testAgentId = agent.id;

          // Send messages
          await h.sendMessage(testAgentId, 'First message');
          await h.sendMessage(testAgentId, 'Second message');
        },
      });

      expect(metrics.performance.operationCount).toBeGreaterThan(0);
      expect(metrics.errors).toHaveLength(0);
    });
  });
});

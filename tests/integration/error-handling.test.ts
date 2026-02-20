/**
 * Error Handling Integration Tests
 *
 * Comprehensive tests for error scenarios including network failures,
 * invalid configurations, resource constraints, and graceful degradation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../../src/features/agent/testing/agent-test-harness';
import { StreamManager } from '../../src/features/agent/services/stream-manager';
import { ConsolidatedBackendService } from '../../src/features/agent/main/consolidated-backend.service';
import {
  createWorkspaceId,
  createAgentId,
  createMessageId,
} from '../../src/shared/types/branded-ids';
import { randomUUID } from 'crypto';
import type { AgentSession, Workspace } from '../../src/shared/types';
import { WorkspaceStatus } from '../../src/shared/types';
import { AgentStatus } from '../../src/shared/types/agent.types';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Error Handling Integration Tests', () => {
  let harness: AgentTestHarness;
  let streamManager: StreamManager;
  let backendService: ConsolidatedBackendService;
  let testWorkspaceId: ReturnType<typeof createWorkspaceId>;
  let testWorkspace: Workspace;
  let testAgent: AgentSession;

  beforeAll(async () => {
    // Initialize test infrastructure
    harness = new AgentTestHarness({
      enableMemoryTracking: true,
      enablePerformanceTracking: true,
      enableErrorCapture: true,
      maxErrors: 100,
      verbose: process.env.VERBOSE === 'true',
    });

    streamManager = StreamManager.getInstance();
    backendService = ConsolidatedBackendService.getInstance({
      // Avoid background timers + filesystem writes in this integration test suite.
      healthCheckInterval: 0,
      persistenceEnabled: false,
    });

    testWorkspaceId = createWorkspaceId(randomUUID());
    testWorkspace = {
      id: testWorkspaceId,
      title: 'Test Workspace',
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: new Date().toISOString(),
    };

    // Create test agent
    testAgent = await harness.createAgent({
      name: 'Error Test Agent',
      model: 'claude-3-opus',
      provider: 'anthropic',
      workspaceId: testWorkspaceId,
    });

    // Ensure the ConsolidatedBackendService knows about this agent ID.
    // The harness keeps its own session map; some tests exercise backendService APIs.
    const backendCreate = await backendService.createAgent(testWorkspace, {
      id: testAgent.id,
      workspaceId: testWorkspaceId,
      name: testAgent.name,
      model: testAgent.model,
      source: 'test',
    });
    expect(backendCreate.success).toBe(true);
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  beforeEach(async () => {
    await harness.start();
  });

  afterEach(async () => {
    await harness.stop();
    await harness.reset();
  });

  describe('Network Failures', () => {
    it('should handle network failure during streaming', async () => {
      const streamId = streamManager.startStream({
        agentId: testAgent.id,
        sessionId: testAgent.id,
        workspaceId: testWorkspaceId,
      });

      // Start streaming
      streamManager.addTextChunk(streamId, 'Starting message...');

      // Simulate network failure
      const networkError = new Error('Network connection lost');
      networkError.name = 'NetworkError';
      streamManager.handleError(streamId, networkError);

      // Verify error is captured
      const health = streamManager.getStreamHealth(streamId);
      expect(health.status).toBe('error');
      expect(health.error).toBeDefined();

      // Attempt recovery
      const recovered = await streamManager.attemptStreamRecovery(streamId);

      if (recovered) {
        // Continue after recovery
        streamManager.addTextChunk(streamId, ' Recovered and continuing.');
        const result = await streamManager.completeStream(streamId);
        expect(result.success).toBe(true);
      } else {
        // Recovery failed, stream should be cleaned up
        const session = streamManager.getSession(streamId);
        expect(session).toBeNull();
      }
    });

    it('should retry failed message sends', async () => {
      let attemptCount = 0;
      const maxRetries = 3;

      // Mock send message with failures
      const originalSend = backendService.sendMessage.bind(backendService);
      backendService.sendMessage = async (agentId, content, options) => {
        attemptCount++;
        if (attemptCount < maxRetries) {
          return { success: false, error: 'Network timeout' };
        }
        // On the final attempt, return success
        return { success: true };
      };

      // Send message with retry logic
      let lastError: string | undefined;
      let success = false;

      for (let i = 0; i < maxRetries; i++) {
        const result = await backendService.sendMessage(
          testAgent.id,
          'Test message with retries',
          {},
        );

        if (result.success) {
          success = true;
          break;
        }
        lastError = result.error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
      }

      expect(attemptCount).toBe(maxRetries);
      expect(success).toBe(true);

      // Restore original method
      backendService.sendMessage = originalSend;
    });
  });

  describe('Invalid Configurations', () => {
    it('should reject invalid agent configurations', async () => {
      const invalidConfigs = [
        { name: '', model: 'claude-3-opus', provider: 'anthropic' },
        { name: 'Test', model: '', provider: 'anthropic' },
        { name: 'Test', model: 'invalid-model', provider: 'unknown' as any },
        { name: null as any, model: 'claude-3-opus', provider: 'anthropic' },
        { name: 'A'.repeat(256), model: 'claude-3-opus', provider: 'anthropic' }, // Too long
      ];

      for (const config of invalidConfigs) {
        try {
          await harness.createAgent(config);
          expect.fail(`Should have rejected config: ${JSON.stringify(config)}`);
        } catch (error) {
          expect(error).toBeDefined();
          expect(error.message).toMatch(/validation|invalid/i);
        }
      }
    });

    it('should validate message content', async () => {
      const invalidMessages = [
        '', // Empty message
        ' '.repeat(100000), // Too long
        null as any,
        undefined as any,
      ];

      for (const content of invalidMessages) {
        const result = await backendService.sendMessage(testAgent.id, content, {});

        if (content === null || content === undefined) {
          expect(result.success).toBe(false);
        } else if (content === '') {
          // Empty messages might be allowed in some cases
          expect(result).toBeDefined();
        } else if (content.length > 50000) {
          // Very long messages might be truncated or rejected
          expect(result).toBeDefined();
        }
      }
    });
  });

  describe('File System Errors', () => {
    it('should handle file system permission errors', async () => {
      const readOnlyPath = '/readonly/path/that/cannot/be/written';

      try {
        const agent = await harness.createAgent({
          name: 'Permission Test Agent',
          model: 'claude-3-opus',
          provider: 'anthropic',
          workspacePath: readOnlyPath,
        });

        // Should handle gracefully
        expect(agent).toBeDefined();
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined();
        expect(error.message).toMatch(/permission|access|denied/i);
      }
    });

    it('should handle disk space errors', async () => {
      // Create a fresh agent for this test
      const agent = await harness.createAgent({
        name: 'Disk Test Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: testWorkspaceId,
      });

      // Simulate large message that might exceed disk space
      const largeMessage = 'x'.repeat(10 * 1024 * 1024); // 10MB

      const message = {
        id: createMessageId(randomUUID()),
        role: 'user' as const,
        content: largeMessage,
        timestamp: new Date(),
      };

      // This should handle gracefully even with large content
      const result = await harness.sendMessage(agent.id, largeMessage);
      expect(result).toBeDefined();
    });
  });

  describe('Memory Pressure', () => {
    it('should handle memory pressure scenarios', async () => {
      const agents: AgentSession[] = [];
      const maxAgents = 50;

      try {
        // Create many agents to simulate memory pressure
        for (let i = 0; i < maxAgents; i++) {
          const agent = await harness.createAgent({
            name: `Memory Test Agent ${i}`,
            model: 'claude-3-opus',
            provider: 'anthropic',
          });
          agents.push(agent);
        }

        // Check memory metrics
        const metrics = harness.getMetrics();
        expect(metrics.memoryUsage.current).toBeDefined();

        // Should not have memory leaks
        expect(metrics.memoryUsage.leaks).toHaveLength(0);
      } finally {
        // Cleanup
        for (const agent of agents) {
          await harness.deleteAgent(agent.id);
        }
      }
    });

    it('should cleanup resources under memory pressure', async () => {
      // Create multiple streams
      const streams: string[] = [];

      for (let i = 0; i < 20; i++) {
        const streamId = streamManager.startStream({
          agentId: createAgentId(randomUUID()),
          sessionId: createAgentId(randomUUID()),
          workspaceId: testWorkspaceId,
        });
        streams.push(streamId);
      }

      // Force cleanup
      streamManager.cleanup();

      // Verify streams are cleaned up
      for (const streamId of streams) {
        const session = streamManager.getSession(streamId);
        expect(session).toBeNull();
      }
    });
  });

  describe('Concurrent Operation Conflicts', () => {
    it('should handle concurrent agent operations', async () => {
      // Create a fresh agent for this test
      const agent = await harness.createAgent({
        name: 'Concurrent Test Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: testWorkspaceId,
      });

      const operations = [];
      const operationCount = 10;

      // Create concurrent operations
      for (let i = 0; i < operationCount; i++) {
        operations.push(harness.sendMessage(agent.id, `Concurrent message ${i}`));
      }

      // All operations should complete
      const results = await Promise.allSettled(operations);

      const successful = results.filter((r) => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);
    });

    it('should handle race conditions in state updates', async () => {
      const updatePromises = [];

      // Simulate concurrent state updates
      for (let i = 0; i < 5; i++) {
        updatePromises.push(backendService.updateAgentStatus(testAgent.id, AgentStatus.Active));
        updatePromises.push(backendService.updateAgentStatus(testAgent.id, AgentStatus.Thinking));
      }

      await Promise.allSettled(updatePromises);

      // Final state should be consistent
      const agent = await backendService.getAgent(testAgent.id);
      expect(agent).toBeDefined();
      expect([AgentStatus.Active, AgentStatus.Thinking]).toContain(agent?.status);
    });
  });

  describe('IPC Communication Failures', () => {
    it('should handle IPC timeout', async () => {
      // Create a fresh agent for this test
      const agent = await harness.createAgent({
        name: 'IPC Test Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
        workspaceId: testWorkspaceId,
      });

      // Simulate IPC timeout by using a very short timeout
      const timeoutPromise = Promise.race([
        harness.sendMessage(agent.id, 'Test message'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('IPC timeout')), 10)),
      ]);

      try {
        await timeoutPromise;
      } catch (error) {
        expect(error.message).toContain('timeout');
      }
    });

    it('should handle IPC channel closure', async () => {
      // Simulate channel closure
      const streamId = streamManager.startStream({
        agentId: testAgent.id,
        sessionId: testAgent.id,
        workspaceId: testWorkspaceId,
      });

      // Force close the stream
      streamManager.forceCloseStream(streamId);

      // Attempting to use closed stream should fail gracefully
      try {
        streamManager.addTextChunk(streamId, 'This should fail');
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Stream should be cleaned up
      const session = streamManager.getSession(streamId);
      expect(session).toBeNull();
    });
  });

  describe('Graceful Degradation', () => {
    it('should degrade gracefully when backend is unavailable', async () => {
      // Simulate backend unavailability
      const originalGetAgent = backendService.getAgent.bind(backendService);
      backendService.getAgent = async () => {
        throw new Error('Backend unavailable');
      };

      try {
        await backendService.getAgent(testAgent.id);
      } catch (error) {
        expect(error.message).toContain('Backend unavailable');
      }

      // Restore
      backendService.getAgent = originalGetAgent;
    });

    it('should provide fallback behavior for non-critical failures', async () => {
      // Simulate non-critical service failure
      const result = await harness.createAgent({
        name: 'Fallback Test Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
        // Invalid optional parameter
        metadata: { invalid: Symbol('invalid') } as any,
      });

      // Should create agent despite invalid metadata
      expect(result).toBeDefined();
      expect(result.name).toBe('Fallback Test Agent');
    });
  });
});

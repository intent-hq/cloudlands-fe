/**
 * Performance Integration Tests
 *
 * Tests for memory leaks, response times, throughput,
 * and resource management.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../../src/features/agent/testing/agent-test-harness';
import { StreamManager } from '../../src/features/agent/services/stream-manager';
import { PerformanceOptimizer } from '../../src/features/agent/services/performance-optimizer';
import { MemoryManager } from '../../src/features/agent/services/memory-manager';
import {
  createWorkspaceId,
  createAgentId,
  createMessageId,
} from '../../src/shared/types/branded-ids';
import { randomUUID } from 'crypto';
import type { AgentSession } from '../../src/shared/types';
import { performance } from 'perf_hooks';

describe('Performance Integration Tests', () => {
  let harness: AgentTestHarness;
  let streamManager: StreamManager;
  let performanceOptimizer: PerformanceOptimizer;
  let memoryManager: MemoryManager;
  let testWorkspaceId: ReturnType<typeof createWorkspaceId>;

  beforeAll(async () => {
    // Initialize with strict performance tracking
    harness = new AgentTestHarness({
      enableMemoryTracking: true,
      enablePerformanceTracking: true,
      enableErrorCapture: true,
      memoryCheckInterval: 100,
      memoryLeakThreshold: 10 * 1024 * 1024, // 10MB
      performanceThreshold: 500, // 500ms
      verbose: process.env.VERBOSE === 'true',
    });

    streamManager = StreamManager.getInstance();
    performanceOptimizer = PerformanceOptimizer.getInstance();
    memoryManager = MemoryManager.getInstance();

    testWorkspaceId = createWorkspaceId(randomUUID());
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  beforeEach(async () => {
    await harness.start();
    // Reset performance metrics
    performanceOptimizer.reset();
    memoryManager.reset();
  });

  afterEach(async () => {
    await harness.stop();
    await harness.reset();
  });

  describe('Memory Leak Detection', () => {
    it('should not leak memory during agent creation/deletion cycles', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const cycles = 20;
      const agents: AgentSession[] = [];

      for (let i = 0; i < cycles; i++) {
        const agent = await harness.createAgent({
          name: `Memory Test Agent ${i}`,
          model: 'claude-3-opus',
          provider: 'anthropic',
        });
        agents.push(agent);
      }

      // Delete all agents
      for (const agent of agents) {
        await harness.deleteAgent(agent.id);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal (< 5MB)
      expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024);

      // Check harness metrics
      const metrics = harness.getMetrics();
      expect(metrics.memoryUsage.leaks).toHaveLength(0);
    });

    it('should not leak memory during streaming operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const streamCount = 50;
      const chunksPerStream = 100;

      for (let i = 0; i < streamCount; i++) {
        const streamId = streamManager.startStream({
          agentId: createAgentId(randomUUID()),
          sessionId: createAgentId(randomUUID()),
          workspaceId: testWorkspaceId,
        });

        // Stream many chunks
        for (let j = 0; j < chunksPerStream; j++) {
          streamManager.addTextChunk(streamId, `Chunk ${j}`);
        }

        await streamManager.completeStream(streamId);
      }

      // Cleanup
      streamManager.cleanup();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory should be released after cleanup
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    it('should track and report memory usage', async () => {
      const agent = await harness.createAgent({
        name: 'Memory Tracking Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
      });

      // Perform operations
      for (let i = 0; i < 10; i++) {
        await harness.sendMessage(agent.id, `Message ${i}`);
      }

      // Get memory report
      const report = memoryManager.getMemoryReport();

      expect(report).toBeDefined();
      expect(report.currentUsage).toBeGreaterThan(0);
      expect(report.peakUsage).toBeGreaterThanOrEqual(report.currentUsage);
      expect(report.collections).toBeDefined();
    });
  });

  describe('Response Time Measurements', () => {
    it('should meet response time targets for agent creation', async () => {
      const measurements: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();

        const agent = await harness.createAgent({
          name: `Performance Agent ${i}`,
          model: 'claude-3-opus',
          provider: 'anthropic',
        });

        const duration = performance.now() - start;
        measurements.push(duration);

        await harness.deleteAgent(agent.id);
      }

      const average = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const p95 = measurements.sort((a, b) => a - b)[Math.floor(measurements.length * 0.95)];

      expect(average).toBeLessThan(1000); // Average < 1s
      expect(p95).toBeLessThan(2000); // 95th percentile < 2s
    });

    it('should maintain low latency for message streaming', async () => {
      const agent = await harness.createAgent({
        name: 'Latency Test Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
      });

      const streamId = streamManager.startStream({
        agentId: agent.id,
        sessionId: agent.id,
        workspaceId: testWorkspaceId,
      });

      const latencies: number[] = [];
      const chunks = 100;

      for (let i = 0; i < chunks; i++) {
        const start = performance.now();
        streamManager.addTextChunk(streamId, `Chunk ${i}`);
        const latency = performance.now() - start;
        latencies.push(latency);
      }

      await streamManager.completeStream(streamId);

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);

      expect(avgLatency).toBeLessThan(10); // Average < 10ms
      expect(maxLatency).toBeLessThan(50); // Max < 50ms
    });
  });

  describe('Throughput Testing', () => {
    it('should handle high message throughput', async () => {
      const agent = await harness.createAgent({
        name: 'Throughput Test Agent',
        model: 'claude-3-opus',
        provider: 'anthropic',
      });

      const messageCount = 100;
      const start = performance.now();
      const promises: Promise<any>[] = [];

      for (let i = 0; i < messageCount; i++) {
        promises.push(harness.sendMessage(agent.id, `Throughput test message ${i}`));
      }

      await Promise.all(promises);
      const duration = performance.now() - start;
      const throughput = messageCount / (duration / 1000); // messages per second

      expect(throughput).toBeGreaterThan(10); // At least 10 messages/second
    });

    it('should handle concurrent stream operations', async () => {
      const concurrentStreams = 20;
      const chunksPerStream = 50;
      const start = performance.now();

      const streamPromises = [];

      for (let i = 0; i < concurrentStreams; i++) {
        streamPromises.push(
          (async () => {
            const streamId = streamManager.startStream({
              agentId: createAgentId(randomUUID()),
              sessionId: createAgentId(randomUUID()),
              workspaceId: testWorkspaceId,
            });

            for (let j = 0; j < chunksPerStream; j++) {
              streamManager.addTextChunk(streamId, `Stream ${i} Chunk ${j}`);
            }

            return streamManager.completeStream(streamId);
          })(),
        );
      }

      const results = await Promise.all(streamPromises);
      const duration = performance.now() - start;

      expect(results.every((r) => r.success)).toBe(true);
      expect(duration).toBeLessThan(5000); // Complete within 5 seconds
    });
  });

  describe('Resource Cleanup', () => {
    it('should properly cleanup resources after operations', async () => {
      const initialHandles = process._getActiveHandles().length;
      const initialRequests = process._getActiveRequests().length;

      // Perform operations
      const agents: AgentSession[] = [];
      for (let i = 0; i < 5; i++) {
        const agent = await harness.createAgent({
          name: `Cleanup Test Agent ${i}`,
          model: 'claude-3-opus',
          provider: 'anthropic',
        });
        agents.push(agent);
      }

      // Cleanup
      for (const agent of agents) {
        await harness.deleteAgent(agent.id);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const finalHandles = process._getActiveHandles().length;
      const finalRequests = process._getActiveRequests().length;

      // Should not leave hanging handles or requests
      expect(finalHandles).toBeLessThanOrEqual(initialHandles + 2); // Allow small variance
      expect(finalRequests).toBeLessThanOrEqual(initialRequests + 2);
    });

    it('should release memory after bulk operations', async () => {
      const beforeMemory = process.memoryUsage();

      // Perform bulk operations
      const operations = [];
      for (let i = 0; i < 100; i++) {
        operations.push(
          performanceOptimizer.track(`operation-${i}`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { result: `Result ${i}` };
          }),
        );
      }

      await Promise.all(operations);

      // Clear cache and cleanup
      performanceOptimizer.clearCache();
      memoryManager.forceCleanup();

      if (global.gc) {
        global.gc();
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const afterMemory = process.memoryUsage();
      const memoryIncrease = afterMemory.heapUsed - beforeMemory.heapUsed;

      // Memory should be mostly released
      expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024); // < 5MB increase
    });
  });

  describe('Performance Optimization', () => {
    it('should cache frequently accessed data', async () => {
      const key = 'test-operation';
      const iterations = 10;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();

        await performanceOptimizer.track(
          key,
          async () => {
            // Simulate expensive operation
            await new Promise((resolve) => setTimeout(resolve, 100));
            return { data: 'cached result' };
          },
          { memoize: true },
        );

        const duration = performance.now() - start;
        durations.push(duration);
      }

      // First call should be slow, subsequent calls should be fast (cached)
      expect(durations[0]).toBeGreaterThan(90);
      expect(durations[1]).toBeLessThan(10); // Cached result
    });

    it('should optimize batch operations', async () => {
      const batchSize = 50;
      const items = Array.from({ length: batchSize }, (_, i) => i);

      const start = performance.now();

      // Process in optimized batches
      const results = await performanceOptimizer.processBatch(
        items,
        async (item) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return item * 2;
        },
        { batchSize: 10, concurrency: 5 },
      );

      const duration = performance.now() - start;

      expect(results).toHaveLength(batchSize);
      expect(duration).toBeLessThan(2000); // Should complete quickly with batching
    });
  });
});

/**
 * Test Scenarios
 *
 * Predefined test scenarios for the agent system.
 */

import type { TestScenario } from './agent-test-harness';
import {
  createMockSession,
  delay,
  takeMemorySnapshot,
  compareMemorySnapshots,
} from './agent-test-utils';
import { AgentStatus } from '../../../shared/types/agent.types';

/**
 * Basic agent lifecycle test
 */
export const basicLifecycleScenario: TestScenario = {
  name: 'Basic Agent Lifecycle',
  description: 'Tests agent creation, messaging, and cleanup',

  async execute(harness) {
    // Create agent
    const agent = await harness.createAgent({
      name: 'lifecycle-test-agent',
    });

    // Send message
    await harness.sendMessage(agent.id, 'Hello, agent!');

    // Simulate lifecycle
    await harness.simulateLifecycle(agent.id);

    // Verify metrics
    const metrics = harness.getMetrics();
    if (metrics.errors.length > 0) {
      throw new Error(`Lifecycle test failed with ${metrics.errors.length} errors`);
    }
  },

  validate(metrics) {
    return metrics.errors.length === 0 && metrics.memoryUsage.leaks.length === 0;
  },

  timeout: 10000,
};

/**
 * Memory leak detection test
 */
export const memoryLeakScenario: TestScenario = {
  name: 'Memory Leak Detection',
  description: 'Tests for memory leaks during agent operations',

  async setup() {
    // Force GC before test
    if (global.gc) global.gc();
  },

  async execute(harness) {
    const initialSnapshot = takeMemorySnapshot();
    const agents = [];

    // Create multiple agents
    for (let i = 0; i < 10; i++) {
      const agent = await harness.createAgent({
        name: `memory-test-agent-${i}`,
      });
      agents.push(agent);

      // Send messages
      for (let j = 0; j < 5; j++) {
        await harness.sendMessage(agent.id, `Message ${j}`);
      }
    }

    // Clean up
    await harness.reset();

    // Force GC and check memory
    if (global.gc) global.gc();
    await delay(500);

    const finalSnapshot = takeMemorySnapshot();
    const comparison = compareMemorySnapshots(initialSnapshot, finalSnapshot);

    if (comparison.hasLeak) {
      throw new Error(`Memory leak detected: ${comparison.diff.heapUsed} bytes`);
    }

    // Also check harness detection
    const leaks = await harness.detectMemoryLeaks();
    if (leaks.length > 0) {
      throw new Error(`Harness detected ${leaks.length} memory leaks`);
    }
  },

  validate(metrics) {
    return metrics.memoryUsage.leaks.length === 0;
  },

  timeout: 30000,
};

/**
 * Streaming performance test
 */
export const streamingPerformanceScenario: TestScenario = {
  name: 'Streaming Performance',
  description: 'Tests streaming response performance',

  async execute(harness) {
    const agent = await harness.createAgent({
      name: 'streaming-test-agent',
    });

    const startTime = Date.now();

    // Send multiple streaming messages
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(harness.sendMessage(agent.id, `Streaming message ${i}`, { streaming: true }));
    }

    await Promise.all(promises);

    const duration = Date.now() - startTime;
    const metrics = harness.getMetrics();

    // Check performance
    if (metrics.performance.averageResponseTime > 1000) {
      throw new Error(
        `Average response time too high: ${metrics.performance.averageResponseTime}ms`,
      );
    }

    if (duration > 5000) {
      throw new Error(`Streaming test took too long: ${duration}ms`);
    }
  },

  validate(metrics) {
    return (
      metrics.performance.averageResponseTime < 1000 && metrics.performance.p95ResponseTime < 2000
    );
  },

  timeout: 10000,
};

/**
 * Error recovery test
 */
export const errorRecoveryScenario: TestScenario = {
  name: 'Error Recovery',
  description: 'Tests error handling and recovery',

  async execute(harness) {
    const agent = await harness.createAgent({
      name: 'error-test-agent',
    });

    // Simulate various error conditions
    const session = (harness as any).sessions.get(agent.id);
    if (session) {
      // Test error state
      session.status = AgentStatus.Error;
      harness.emit('statusChanged', { agentId: agent.id, status: AgentStatus.Error });

      // Recover from error
      await delay(100);
      session.status = AgentStatus.Idle;
      harness.emit('statusChanged', { agentId: agent.id, status: AgentStatus.Idle });

      // Test message with error
      try {
        // Simulate a failed message send
        throw new Error('Simulated message error');
      } catch (error) {
        // Should be caught and recorded
        (harness as any).recordError('execution', error as Error, { agentId: agent.id });
      }

      // Verify agent can still function
      await harness.sendMessage(agent.id, 'Recovery test message');

      const metrics = harness.getMetrics();
      if (metrics.errors.length === 0) {
        throw new Error('Expected errors to be recorded');
      }
    }
  },

  validate(metrics) {
    // Should have recorded errors but still completed
    return metrics.errors.length > 0 && metrics.errors.every((e) => e.phase === 'execution');
  },

  timeout: 10000,
};

/**
 * Concurrent operations test
 */
export const concurrentOperationsScenario: TestScenario = {
  name: 'Concurrent Operations',
  description: 'Tests handling of concurrent agent operations',

  async execute(harness) {
    const agents = [];

    // Create multiple agents concurrently
    const createPromises = [];
    for (let i = 0; i < 5; i++) {
      createPromises.push(harness.createAgent({ name: `concurrent-agent-${i}` }));
    }

    const createdAgents = await Promise.all(createPromises);
    agents.push(...createdAgents);

    // Send messages concurrently
    const messagePromises = [];
    for (const agent of agents) {
      for (let i = 0; i < 3; i++) {
        messagePromises.push(harness.sendMessage(agent.id, `Concurrent message ${i}`));
      }
    }

    await Promise.all(messagePromises);

    // Verify all operations completed
    const metrics = harness.getMetrics();
    const expectedOperations = 5 + 5 * 3; // 5 creates + 15 messages

    if (metrics.performance.operations.length < expectedOperations) {
      throw new Error(
        `Expected ${expectedOperations} operations, got ${metrics.performance.operations.length}`,
      );
    }
  },

  validate(metrics) {
    return metrics.errors.length === 0 && metrics.performance.operations.every((op) => op.success);
  },

  timeout: 20000,
};

/**
 * Long-running session test
 */
export const longRunningSessionScenario: TestScenario = {
  name: 'Long Running Session',
  description: 'Tests agent behavior over extended period',

  async execute(harness) {
    const agent = await harness.createAgent({
      name: 'long-running-agent',
    });

    const startTime = Date.now();
    const duration = 5000; // 5 seconds
    let messageCount = 0;

    // Send messages continuously for duration
    while (Date.now() - startTime < duration) {
      await harness.sendMessage(agent.id, `Message ${messageCount++}`);
      await delay(100);
    }

    // Check for memory growth
    const leaks = await harness.detectMemoryLeaks();
    if (leaks.length > 0) {
      throw new Error('Memory leaks detected in long-running session');
    }

    // Check performance degradation
    const metrics = harness.getMetrics();
    const operations = metrics.performance.operations;

    if (operations.length > 10) {
      const firstHalf = operations.slice(0, Math.floor(operations.length / 2));
      const secondHalf = operations.slice(Math.floor(operations.length / 2));

      const firstAvg = firstHalf.reduce((sum, op) => sum + op.duration, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, op) => sum + op.duration, 0) / secondHalf.length;

      // Check if performance degraded by more than 50%
      if (secondAvg > firstAvg * 1.5) {
        throw new Error(`Performance degradation detected: ${secondAvg}ms vs ${firstAvg}ms`);
      }
    }
  },

  validate(metrics) {
    return metrics.memoryUsage.leaks.length === 0 && metrics.errors.length === 0;
  },

  timeout: 30000,
};

/**
 * Export all scenarios as a test suite
 */
export const allScenarios: TestScenario[] = [
  basicLifecycleScenario,
  memoryLeakScenario,
  streamingPerformanceScenario,
  errorRecoveryScenario,
  concurrentOperationsScenario,
  longRunningSessionScenario,
];

/**
 * Export all test scenarios as an object for easier access
 */
export const testScenarios = {
  basicLifecycle: basicLifecycleScenario,
  memoryLeak: memoryLeakScenario,
  streamingPerformance: streamingPerformanceScenario,
  errorRecovery: errorRecoveryScenario,
  concurrentOperations: concurrentOperationsScenario,
  longRunningSession: longRunningSessionScenario,
};

/**
 * Create a custom scenario
 */
export function createCustomScenario(
  name: string,
  execute: (harness: any) => Promise<void>,
  options: {
    description?: string;
    setup?: () => Promise<void>;
    teardown?: () => Promise<void>;
    validate?: (metrics: any) => boolean;
    timeout?: number;
  } = {},
): TestScenario {
  return {
    name,
    description: options.description || `Custom scenario: ${name}`,
    setup: options.setup,
    execute,
    teardown: options.teardown,
    validate: options.validate,
    timeout: options.timeout || 10000,
  };
}

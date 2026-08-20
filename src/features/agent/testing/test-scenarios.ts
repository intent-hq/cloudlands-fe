/**
 * Test Scenarios
 *
 * Predefined test scenarios for the agent system.
 */

import type { TestScenario } from './agent-test-harness';
import { delay, takeMemorySnapshot, compareMemorySnapshots } from './agent-test-utils';
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

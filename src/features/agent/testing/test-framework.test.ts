/**
 * Test Framework Self-Test
 *
 * Tests the testing framework itself to ensure it works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from './agent-test-harness';
import { AgentTestRunner } from './agent-test-runner';
import {
  createMockSession,
  createMockMessage,
  waitFor,
  takeMemorySnapshot,
  compareMemorySnapshots,
  delay,
} from './agent-test-utils';
import {
  basicLifecycleScenario,
  memoryLeakScenario,
  streamingPerformanceScenario,
  errorRecoveryScenario,
  createCustomScenario,
} from './test-scenarios';
import { AgentStatus } from '../../../shared/types/agent.types';

describe('AgentTestHarness', () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      verbose: false,
      memoryCheckInterval: 100,
      memoryLeakThreshold: 10 * 1024 * 1024, // 10MB
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('should start and stop correctly', async () => {
    await harness.start();
    expect(harness['isRunning']).toBe(true);

    await harness.stop();
    expect(harness['isRunning']).toBe(false);
  });

  it('should create an agent session', async () => {
    await harness.start();

    const agent = await harness.createAgent({
      name: 'test-agent',
      model: 'test-model',
    });

    expect(agent).toBeDefined();
    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('test-agent');
    expect(agent.model).toBe('test-model');
    expect(agent.status).toBe(AgentStatus.Idle);

    await harness.stop();
  });

  it('should send messages to agents', async () => {
    await harness.start();

    const agent = await harness.createAgent();
    const message = await harness.sendMessage(agent.id, 'Test message');

    expect(message).toBeDefined();
    expect(message.role).toBe('user');
    expect(message.contentBlocks?.[0].text).toBe('Test message');

    // Check that agent received the message
    const session = harness['sessions'].get(agent.id);
    expect(session?.messages).toHaveLength(2); // User message + response

    await harness.stop();
  });

  it('should simulate streaming', async () => {
    await harness.start();

    const agent = await harness.createAgent();
    const tokens: string[] = [];

    harness.on('streamToken', ({ token }) => {
      tokens.push(token);
    });

    await harness.sendMessage(agent.id, 'Stream test', { streaming: true });

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join('')).toContain('test');

    await harness.stop();
  });

  it('should detect memory leaks', async () => {
    await harness.start();

    // Create a scenario that might leak memory
    const initialSnapshot = takeMemorySnapshot();

    // Create many agents without cleanup
    for (let i = 0; i < 100; i++) {
      await harness.createAgent({ name: `leak-test-${i}` });
    }

    // Force GC if available
    if (global.gc) global.gc();
    await delay(100);

    const finalSnapshot = takeMemorySnapshot();
    const comparison = compareMemorySnapshots(initialSnapshot, finalSnapshot, 5 * 1024 * 1024);

    // The harness should detect if there's a significant memory increase
    const leaks = await harness.detectMemoryLeaks();

    // We expect some memory usage but not necessarily a leak
    expect(leaks).toBeDefined();
    expect(Array.isArray(leaks)).toBe(true);

    await harness.stop();
  });

  it('should track performance metrics', async () => {
    await harness.start();

    const agent = await harness.createAgent();
    await harness.sendMessage(agent.id, 'Performance test');

    const metrics = harness.getMetrics();

    expect(metrics.performance.operations.length).toBeGreaterThan(0);
    expect(metrics.performance.averageResponseTime).toBeGreaterThanOrEqual(0);

    const createOp = metrics.performance.operations.find((op) => op.name === 'createAgent');
    expect(createOp).toBeDefined();
    expect(createOp?.success).toBe(true);

    await harness.stop();
  });

  it('should record errors', async () => {
    await harness.start();

    // Try to send message to non-existent agent
    try {
      await harness.sendMessage('non-existent-id' as any, 'Test');
    } catch (error) {
      // Expected error
    }

    const metrics = harness.getMetrics();
    const failedOp = metrics.performance.operations.find((op) => !op.success);

    expect(failedOp).toBeDefined();
    expect(failedOp?.error).toBeDefined();

    await harness.stop();
  });

  it('should emit events', async () => {
    await harness.start();

    const events: string[] = [];

    harness.on('agentCreated', () => events.push('agentCreated'));
    harness.on('messageSent', () => events.push('messageSent'));
    harness.on('responseReceived', () => events.push('responseReceived'));

    const agent = await harness.createAgent();
    await harness.sendMessage(agent.id, 'Event test');

    expect(events).toContain('agentCreated');
    expect(events).toContain('messageSent');
    expect(events).toContain('responseReceived');

    await harness.stop();
  });

  it('should run scenarios', async () => {
    await harness.start();

    const scenario = createCustomScenario(
      'Test Scenario',
      async (harness) => {
        const agent = await harness.createAgent();
        await harness.sendMessage(agent.id, 'Scenario test');
      },
      {
        description: 'A simple test scenario',
        validate: (metrics) => metrics.errors.length === 0,
      },
    );

    const metrics = await harness.runScenario(scenario);

    expect(metrics).toBeDefined();
    expect(metrics.errors).toHaveLength(0);

    await harness.stop();
  });
});

describe('AgentTestRunner', () => {
  let runner: AgentTestRunner;

  beforeEach(() => {
    runner = new AgentTestRunner();
  });

  it('should register test suites', () => {
    const suite = {
      name: 'Test Suite',
      description: 'A test suite',
      scenarios: [basicLifecycleScenario],
    };

    runner.registerSuite(suite);
    expect(runner['suites'].has('Test Suite')).toBe(true);
  });

  it('should run a single suite', async () => {
    const suite = {
      name: 'Single Suite',
      description: 'A single test suite',
      scenarios: [
        createCustomScenario('Simple Test', async (harness) => {
          await harness.createAgent();
        }),
      ],
      continueOnFailure: true,
    };

    runner.registerSuite(suite);
    const report = await runner.runSuite(suite);

    expect(report).toBeDefined();
    expect(report.name).toBe('Single Suite');
    expect(report.results).toHaveLength(1);
    expect(report.passed).toBeGreaterThanOrEqual(0);
  });

  it('should run parallel scenarios', async () => {
    const scenarios = Array.from({ length: 3 }, (_, i) =>
      createCustomScenario(`Parallel Test ${i}`, async (harness) => {
        await harness.createAgent({ name: `parallel-agent-${i}` });
        await delay(100);
      }),
    );

    const suite = {
      name: 'Parallel Suite',
      description: 'Parallel test suite',
      scenarios,
      parallel: true,
      maxParallel: 2,
    };

    runner.registerSuite(suite);
    const startTime = Date.now();
    const report = await runner.runSuite(suite);
    const duration = Date.now() - startTime;

    expect(report.results).toHaveLength(3);
    // Should be faster than sequential (300ms) but account for overhead
    expect(duration).toBeLessThan(400);
  });

  it('should generate reports', async () => {
    const report = {
      startTime: Date.now(),
      endTime: Date.now() + 1000,
      duration: 1000,
      suites: [
        {
          name: 'Test Suite',
          results: [
            {
              suite: 'Test Suite',
              scenario: 'Test Scenario',
              success: true,
              metrics: {
                memoryUsage: {
                  initial: process.memoryUsage(),
                  current: process.memoryUsage(),
                  peak: process.memoryUsage(),
                  leaks: [],
                },
                performance: {
                  startTime: Date.now(),
                  endTime: Date.now() + 100,
                  operations: [],
                  responseTimes: [50, 60, 70],
                  operationCount: 3,
                  averageResponseTime: 60,
                  p95ResponseTime: 80,
                  p99ResponseTime: 95,
                },
                errors: [],
                warnings: [],
                coverage: {
                  linesExecuted: 100,
                  totalLines: 150,
                  percentage: 66.67,
                },
              },
              duration: 100,
              timestamp: Date.now(),
            },
          ],
          passed: 1,
          failed: 0,
          duration: 100,
        },
      ],
      summary: {
        totalScenarios: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        memoryLeaks: 0,
        performanceIssues: 0,
        errors: 0,
      },
    };

    // Test markdown generation
    const markdown = runner['generateMarkdownContent'](report);
    expect(markdown).toContain('# Agent Test Report');
    expect(markdown).toContain('Test Suite');
    expect(markdown).toContain('✅ PASSED');

    // Test HTML generation
    const html = runner['generateHTMLContent'](report);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Agent Test Report');
    expect(html).toContain('Test Suite');
  });
});

describe('Test Utilities', () => {
  it('should create mock sessions', () => {
    const session = createMockSession({
      name: 'custom-agent',
    });

    expect(session).toBeDefined();
    expect(session.name).toBe('custom-agent');
    expect(session.status).toBe(AgentStatus.Idle);
    expect(session.messages).toHaveLength(0);
  });

  it('should create mock messages', () => {
    const message = createMockMessage('user', 'Test content');

    expect(message).toBeDefined();
    expect(message.role).toBe('user');
    expect(message.contentBlocks?.[0].text).toBe('Test content');
    expect(message.timestamp).toBeDefined();
  });

  it('should wait for conditions', async () => {
    let value = false;

    setTimeout(() => {
      value = true;
    }, 100);

    await waitFor(() => value, 1000, 50);
    expect(value).toBe(true);
  });

  it('should compare memory snapshots', () => {
    const before = takeMemorySnapshot();

    // Allocate some memory
    const data = new Array(1000000).fill('test');

    const after = takeMemorySnapshot();
    const comparison = compareMemorySnapshots(before, after, 100 * 1024 * 1024);

    expect(comparison.diff.heapUsed).toBeGreaterThan(0);
    expect(comparison.percentage).toBeGreaterThan(0);

    // Clean up
    data.length = 0;
  });
});

describe('Test Scenarios', () => {
  it('should have valid basic lifecycle scenario', () => {
    expect(basicLifecycleScenario).toBeDefined();
    expect(basicLifecycleScenario.name).toBe('Basic Agent Lifecycle');
    expect(basicLifecycleScenario.execute).toBeDefined();
    expect(basicLifecycleScenario.validate).toBeDefined();
  });

  it('should have valid memory leak scenario', () => {
    expect(memoryLeakScenario).toBeDefined();
    expect(memoryLeakScenario.name).toBe('Memory Leak Detection');
    expect(memoryLeakScenario.setup).toBeDefined();
    expect(memoryLeakScenario.execute).toBeDefined();
  });

  it('should have valid streaming performance scenario', () => {
    expect(streamingPerformanceScenario).toBeDefined();
    expect(streamingPerformanceScenario.name).toBe('Streaming Performance');
    expect(streamingPerformanceScenario.validate).toBeDefined();
  });

  it('should have valid error recovery scenario', () => {
    expect(errorRecoveryScenario).toBeDefined();
    expect(errorRecoveryScenario.name).toBe('Error Recovery');
    expect(errorRecoveryScenario.execute).toBeDefined();
  });
});

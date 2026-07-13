#!/usr/bin/env tsx
/**
 * Integration Test Runner
 *
 * Standalone runner for integration tests using the test harness.
 * Can be run directly with: tsx tests/integration/run-integration-tests.ts
 */

import {
  AgentTestHarness,
  TestScenario,
} from '../../src/features/agent/testing/agent-test-harness';
import { performance } from 'perf_hooks';
import * as fs from 'fs/promises';
import * as path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  errors: string[];
  warnings: string[];
  metrics?: any;
}

class IntegrationTestRunner {
  private harness: AgentTestHarness;
  private results: TestResult[] = [];
  private startTime: number = 0;

  constructor() {
    this.harness = new AgentTestHarness({
      enableMemoryTracking: true,
      enablePerformanceTracking: true,
      enableErrorCapture: true,
      memoryCheckInterval: 1000,
      memoryLeakThreshold: 50 * 1024 * 1024,
      performanceThreshold: 5000,
      verbose: process.argv.includes('--verbose'),
      maxErrors: 100,
      timeout: 60000,
    });
  }

  async run(): Promise<void> {
    console.log('🚀 Starting Integration Tests...\n');
    this.startTime = performance.now();

    try {
      await this.harness.start();

      // Run all test suites
      await this.runTestSuite('Workspace Creation', this.workspaceCreationTests());
      await this.runTestSuite('Message Flow', this.messageFlowTests());
      await this.runTestSuite('Persistence', this.persistenceTests());
      await this.runTestSuite('Error Recovery', this.errorRecoveryTests());
      await this.runTestSuite('Concurrency', this.concurrencyTests());
      await this.runTestSuite('Performance', this.performanceTests());
      await this.runTestSuite('Chaos Testing', this.chaosTests());

      await this.generateReport();
    } catch (error) {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    } finally {
      await this.harness.cleanup();
    }
  }

  private async runTestSuite(suiteName: string, scenarios: TestScenario[]): Promise<void> {
    console.log(`\n📦 Running ${suiteName} Tests...`);

    for (const scenario of scenarios) {
      const testStart = performance.now();
      const result: TestResult = {
        name: `${suiteName}::${scenario.name}`,
        passed: false,
        duration: 0,
        errors: [],
        warnings: [],
      };

      try {
        await this.harness.reset();
        const metrics = await this.harness.runScenario(scenario);

        result.passed = metrics.errors.length === 0;
        result.errors = metrics.errors.map((e) => e.message);
        result.warnings = metrics.warnings;
        result.metrics = metrics;

        console.log(`  ${result.passed ? '✅' : '❌'} ${scenario.name}`);
      } catch (error) {
        result.passed = false;
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
        console.log(`  ❌ ${scenario.name}: ${error}`);
      }

      result.duration = performance.now() - testStart;
      this.results.push(result);
    }
  }

  private workspaceCreationTests(): TestScenario[] {
    return [
      {
        name: 'create-single-agent',
        description: 'Create a single agent in a new workspace',
        execute: async (harness) => {
          const agent = await harness.createAgent({
            name: 'Test Agent',
            model: 'claude-3-opus',
          });
          if (!agent.id) throw new Error('Agent creation failed');
        },
        validate: (metrics) => metrics.errors.length === 0,
      },
      {
        name: 'create-multiple-agents',
        description: 'Create multiple agents in the same workspace',
        execute: async (harness) => {
          const agents = await Promise.all([
            harness.createAgent({ name: 'Agent 1' }),
            harness.createAgent({ name: 'Agent 2' }),
            harness.createAgent({ name: 'Agent 3' }),
          ]);
          if (agents.length !== 3) throw new Error('Failed to create all agents');
        },
        validate: (metrics) => metrics.errors.length === 0,
      },
    ];
  }

  private messageFlowTests(): TestScenario[] {
    return [
      {
        name: 'send-receive-messages',
        description: 'Send and receive messages',
        execute: async (harness) => {
          const agent = await harness.createAgent({ name: 'Message Test Agent' });
          await harness.sendMessage(agent.id, 'Test message 1');
          await harness.sendMessage(agent.id, 'Test message 2');
          await harness.sendMessage(agent.id, 'Test message 3');
        },
        validate: (metrics) => metrics.errors.length === 0,
      },
      {
        name: 'streaming-messages',
        description: 'Test streaming message responses',
        execute: async (harness) => {
          const agent = await harness.createAgent({ name: 'Streaming Agent' });
          await harness.sendMessage(agent.id, 'Stream this response', { streaming: true });
        },
        validate: (metrics) => metrics.errors.length === 0,
      },
    ];
  }

  private persistenceTests(): TestScenario[] {
    return [
      {
        name: 'save-load-agent',
        description: 'Test agent persistence',
        execute: async (harness) => {
          const agent = await harness.createAgent({ name: 'Persistent Agent' });
          await harness.sendMessage(agent.id, 'Message to persist');
          const result = await harness.testPersistence(agent.id);
          if (!result.success) throw new Error('Persistence failed');
        },
        validate: (metrics) => metrics.errors.length === 0,
        timeout: 15000,
      },
      {
        name: 'corruption-recovery',
        description: 'Test recovery from corrupted data',
        execute: async (harness) => {
          const result = await harness.testCorruptionRecovery();
          if (!result.success) throw new Error('Corruption recovery failed');
        },
        validate: () => true, // Some errors expected
        timeout: 20000,
      },
    ];
  }

  private errorRecoveryTests(): TestScenario[] {
    return [
      {
        name: 'network-error-recovery',
        description: 'Recover from network errors',
        execute: async (harness) => {
          const result = await harness.testErrorRecovery({
            type: 'network',
            iterations: 10,
          });
          if (!result.passed) throw new Error('Network recovery failed');
        },
        validate: () => true, // Errors expected
      },
      {
        name: 'timeout-error-recovery',
        description: 'Recover from timeout errors',
        execute: async (harness) => {
          const result = await harness.testErrorRecovery({
            type: 'timeout',
            iterations: 10,
          });
          if (!result.passed) throw new Error('Timeout recovery failed');
        },
        validate: () => true, // Errors expected
      },
      {
        name: 'provider-error-recovery',
        description: 'Recover from provider errors',
        execute: async (harness) => {
          const result = await harness.testErrorRecovery({
            type: 'provider',
            iterations: 10,
          });
          if (!result.passed) throw new Error('Provider recovery failed');
        },
        validate: () => true, // Errors expected
      },
    ];
  }

  private concurrencyTests(): TestScenario[] {
    return [
      {
        name: 'concurrent-agent-creation',
        description: 'Create agents concurrently',
        execute: async (harness) => {
          const promises = [];
          for (let i = 0; i < 10; i++) {
            promises.push(harness.createAgent({ name: `Concurrent ${i}` }));
          }
          const agents = await Promise.all(promises);
          if (agents.length !== 10) throw new Error('Concurrent creation failed');
        },
        validate: (metrics) => metrics.errors.length === 0,
        timeout: 20000,
      },
      {
        name: 'ipc-concurrency',
        description: 'Test IPC concurrency handling',
        execute: async (harness) => {
          const result = await harness.testIPCConcurrency(25);
          if (result.failureCount > 5) throw new Error('Too many IPC failures');
        },
        validate: (metrics) => metrics.errors.length < 5,
        timeout: 30000,
      },
    ];
  }

  private performanceTests(): TestScenario[] {
    return [
      {
        name: 'agent-creation-benchmark',
        description: 'Benchmark agent creation performance',
        execute: async (harness) => {
          const result = await harness.benchmarkOperation(async () => {
            await harness.createAgent({ name: 'Benchmark Agent' });
          }, 100);
          if (result.averageTime > 200) throw new Error('Agent creation too slow');
        },
        validate: (metrics) => metrics.performance.averageResponseTime < 200,
        timeout: 30000,
      },
      {
        name: 'message-sending-benchmark',
        description: 'Benchmark message sending performance',
        execute: async (harness) => {
          const agent = await harness.createAgent({ name: 'Message Benchmark' });
          const result = await harness.benchmarkOperation(async () => {
            await harness.sendMessage(agent.id, 'Benchmark message');
          }, 50);
          if (result.averageTime > 500) throw new Error('Message sending too slow');
        },
        validate: (metrics) => metrics.performance.averageResponseTime < 500,
        timeout: 30000,
      },
      {
        name: 'stress-test',
        description: 'Stress test the system',
        execute: async (harness) => {
          const result = await harness.stressTest({
            agents: 10,
            duration: 20,
            messagesPerAgent: 10,
            streaming: false,
          });
          if (!result.success) throw new Error('Stress test failed');
        },
        validate: (metrics) => metrics.memoryUsage.leaks.length === 0,
        timeout: 60000,
      },
    ];
  }

  private chaosTests(): TestScenario[] {
    return [
      {
        name: 'chaos-testing',
        description: 'Run chaos testing with injected failures',
        execute: async (harness) => {
          const result = await harness.runChaosTest({
            duration: 15,
            errorRate: 0.2,
            services: ['agent-service', 'streaming-service'],
          });
          if (!result.passed) throw new Error('Chaos test failed');
        },
        validate: () => true, // Errors expected in chaos testing
        timeout: 30000,
      },
      {
        name: 'backend-health-check',
        description: 'Verify backend health monitoring',
        execute: async (harness) => {
          const result = await harness.testBackendHealth();
          if (!result.success) throw new Error('Backend unhealthy');
        },
        validate: (metrics) => metrics.errors.length === 0,
      },
    ];
  }

  private async generateReport(): Promise<void> {
    const duration = (performance.now() - this.startTime) / 1000;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    const totalErrors = this.results.reduce((sum, r) => sum + r.errors.length, 0);
    const totalWarnings = this.results.reduce((sum, r) => sum + r.warnings.length, 0);

    // Get final metrics from harness
    const finalMetrics = this.harness.getMetrics();

    console.log(`\n${  '='.repeat(80)}`);
    console.log('📊 INTEGRATION TEST REPORT');
    console.log('='.repeat(80));
    console.log('\n📈 Test Results:');
    console.log(`  ✅ Passed: ${passed}`);
    console.log(`  ❌ Failed: ${failed}`);
    console.log(`  ⏱️  Duration: ${duration.toFixed(2)}s`);
    console.log(`  ⚠️  Total Errors: ${totalErrors}`);
    console.log(`  ⚠️  Total Warnings: ${totalWarnings}`);

    console.log('\n💾 Memory Analysis:');
    console.log(
      `  Initial Heap: ${(finalMetrics.memoryUsage.initial.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(
      `  Current Heap: ${(finalMetrics.memoryUsage.current.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(
      `  Peak Heap: ${(finalMetrics.memoryUsage.peak.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(`  Memory Leaks: ${finalMetrics.memoryLeakDetected ? '⚠️ DETECTED' : '✅ None'}`);

    console.log('\n⚡ Performance Metrics:');
    console.log(`  Average Response Time: ${finalMetrics.averageResponseTime.toFixed(2)}ms`);
    console.log(`  P95 Response Time: ${finalMetrics.p95ResponseTime.toFixed(2)}ms`);
    console.log(`  P99 Response Time: ${finalMetrics.p99ResponseTime.toFixed(2)}ms`);
    console.log(`  Total Operations: ${finalMetrics.totalOperations}`);

    // Write detailed report to file
    const reportPath = path.join(process.cwd(), 'test-reports', `integration-${Date.now()}.json`);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          summary: {
            passed,
            failed,
            duration,
            totalErrors,
            totalWarnings,
          },
          results: this.results,
          metrics: finalMetrics,
        },
        null,
        2,
      ),
    );

    console.log(`\n📄 Detailed report saved to: ${reportPath}`);

    // Exit with appropriate code
    if (failed > 0) {
      console.log('\n❌ Integration tests failed!');
      process.exit(1);
    } else {
      console.log('\n✅ All integration tests passed!');
      process.exit(0);
    }
  }
}

// Run the tests
if (require.main === module) {
  const runner = new IntegrationTestRunner();
  runner.run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

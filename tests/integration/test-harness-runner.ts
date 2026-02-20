#!/usr/bin/env tsx

/**
 * Test Harness Runner
 * Comprehensive test runner using the AgentTestHarness
 */

import { AgentTestHarness } from '../../src/features/agent/testing/agent-test-harness';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  metrics?: any;
}

class TestHarnessRunner {
  private harness: AgentTestHarness;
  private results: TestResult[] = [];
  private startTime: number = 0;

  constructor() {
    this.harness = new AgentTestHarness({
      verbose: process.argv.includes('--verbose'),
      memoryLeakThreshold: 50 * 1024 * 1024,
      enableMemoryTracking: true,
      enablePerformanceTracking: true,
      enableErrorCapture: true,
    });
  }

  async run(): Promise<void> {
    console.log('🚀 Starting Agent System Integration Tests with Test Harness\n');
    this.startTime = Date.now();

    try {
      await this.harness.start();

      // Run all test suites
      await this.runCoreTests();
      await this.runPerformanceTests();
      await this.runStressTests();
      await this.runMemoryTests();

      // Generate report
      this.generateReport();
    } catch (error) {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    } finally {
      await this.harness.stop();
    }
  }

  private async runCoreTests(): Promise<void> {
    console.log('📦 Running Core Agent Tests...');

    // Test 1: Agent Creation
    await this.runTest('Agent Creation', async () => {
      const agent = await this.harness.createAgent({
        name: 'test-agent',
        model: 'test-model',
      });

      if (!agent.id || !agent.name) {
        throw new Error('Agent creation failed');
      }
    });

    // Test 2: Message Sending
    await this.runTest('Message Sending', async () => {
      const agent = await this.harness.createAgent({ name: 'message-test' });
      const message = await this.harness.sendMessage(agent.id, 'Test message');

      if (!message.id || !message.id.startsWith('msg_')) {
        throw new Error('Invalid message ID format');
      }
    });

    // Test 3: Streaming
    await this.runTest('Streaming Messages', async () => {
      const agent = await this.harness.createAgent({ name: 'stream-test' });
      await this.harness.sendMessage(agent.id, 'Stream test', { streaming: true });
    });

    // Test 4: Concurrent Operations
    await this.runTest('Concurrent Operations', async () => {
      const promises = Array.from({ length: 3 }, (_, i) =>
        this.harness.createAgent({ name: `concurrent-${i}` }),
      );

      const agents = await Promise.all(promises);
      if (agents.length !== 3) {
        throw new Error('Concurrent agent creation failed');
      }
    });
  }

  private async runPerformanceTests(): Promise<void> {
    console.log('\n⚡ Running Performance Tests...');

    await this.runTest('Response Time Benchmark', async () => {
      const agent = await this.harness.createAgent({ name: 'perf-test' });

      const times: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await this.harness.sendMessage(agent.id, `Perf test ${i}`);
        times.push(Date.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      if (avgTime > 500) {
        throw new Error(`Average response time too high: ${avgTime}ms`);
      }
    });

    await this.runTest('Throughput Test', async () => {
      const agent = await this.harness.createAgent({ name: 'throughput-test' });
      const start = Date.now();

      const promises = Array.from({ length: 20 }, (_, i) =>
        this.harness.sendMessage(agent.id, `Throughput ${i}`),
      );

      await Promise.all(promises);
      const duration = Date.now() - start;
      const throughput = 20000 / duration; // messages per second

      if (throughput < 5) {
        throw new Error(`Throughput too low: ${throughput.toFixed(2)} msg/s`);
      }
    });
  }

  private async runStressTests(): Promise<void> {
    console.log('\n💪 Running Stress Tests...');

    await this.runTest('Multi-Agent Stress Test', async () => {
      const result = await this.harness.stressTest({
        agents: 3,
        duration: 5,
        messagesPerAgent: 3,
        streaming: false,
      });

      if (!result.success) {
        throw new Error('Stress test failed');
      }
    });
  }

  private async runMemoryTests(): Promise<void> {
    console.log('\n🧠 Running Memory Tests...');

    await this.runTest('Memory Leak Detection', async () => {
      const leaks = await this.harness.detectMemoryLeaks();
      const totalLeakSize = leaks.reduce((sum, leak) => sum + leak.size, 0);

      if (totalLeakSize > 10 * 1024 * 1024) {
        // 10MB threshold
        throw new Error(`Memory leak detected: ${(totalLeakSize / 1024 / 1024).toFixed(2)}MB`);
      }
    });

    await this.runTest('Memory Usage Tracking', async () => {
      const metrics = this.harness.getMetrics();
      const heapUsed = metrics.memoryUsage.current.heapUsed;
      const heapLimit = 500 * 1024 * 1024; // 500MB limit

      if (heapUsed > heapLimit) {
        throw new Error(`Heap usage too high: ${(heapUsed / 1024 / 1024).toFixed(2)}MB`);
      }
    });
  }

  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    let passed = false;
    let error: string | undefined;

    try {
      await testFn();
      passed = true;
      console.log(`  ✅ ${name}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.log(`  ❌ ${name}: ${error}`);
    }

    this.results.push({
      name,
      passed,
      duration: Date.now() - start,
      error,
    });
  }

  private generateReport(): void {
    const duration = Date.now() - this.startTime;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    const metrics = this.harness.getMetrics();

    const report = {
      summary: {
        totalTests: this.results.length,
        passed,
        failed,
        duration,
        successRate: `${((passed / this.results.length) * 100).toFixed(2)  }%`,
      },
      performance: {
        averageResponseTime: metrics.averageResponseTime,
        p95ResponseTime: metrics.p95ResponseTime,
        p99ResponseTime: metrics.p99ResponseTime,
        totalOperations: metrics.totalOperations,
      },
      memory: {
        heapUsed: metrics.memoryUsage.current.heapUsed,
        heapTotal: metrics.memoryUsage.current.heapTotal,
        external: metrics.memoryUsage.current.external,
        leaksDetected: metrics.memoryLeakDetected,
        leakCount: metrics.memoryUsage.leaks.length,
      },
      errors: metrics.errors,
      testResults: this.results,
    };

    // Print summary
    console.log(`\n${  '='.repeat(60)}`);
    console.log('📊 TEST REPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${report.summary.totalTests}`);
    console.log(`Passed: ${report.summary.passed} ✅`);
    console.log(`Failed: ${report.summary.failed} ❌`);
    console.log(`Success Rate: ${report.summary.successRate}`);
    console.log(`Duration: ${(report.summary.duration / 1000).toFixed(2)}s`);
    console.log('\n📈 Performance Metrics:');
    console.log(`  Average Response Time: ${report.performance.averageResponseTime.toFixed(2)}ms`);
    console.log(`  P95 Response Time: ${report.performance.p95ResponseTime.toFixed(2)}ms`);
    console.log(`  P99 Response Time: ${report.performance.p99ResponseTime.toFixed(2)}ms`);
    console.log(`  Total Operations: ${report.performance.totalOperations}`);
    console.log('\n💾 Memory Usage:');
    console.log(`  Heap Used: ${(report.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Heap Total: ${(report.memory.heapTotal / 1024 / 1024).toFixed(2)}MB`);
    console.log(
      `  Memory Leaks: ${report.memory.leaksDetected ? `⚠️ ${report.memory.leakCount} detected` : '✅ None detected'}`,
    );

    // Save detailed report
    const reportPath = join(process.cwd(), 'test-harness-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);

    // Exit with appropriate code
    if (failed > 0) {
      console.log('\n❌ Tests failed!');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }
  }
}

// Run the tests
const runner = new TestHarnessRunner();
runner.run().catch(console.error);

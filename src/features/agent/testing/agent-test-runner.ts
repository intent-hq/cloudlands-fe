/**
 * Agent Test Runner
 *
 * Orchestrates test execution using the test harness.
 * Manages test suites, parallel execution, and reporting.
 */

import { AgentTestHarness, TestScenario, TestMetrics, HarnessConfig } from './agent-test-harness';
import { EventEmitter } from '$shared/utils/event-emitter';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface TestSuite {
  name: string;
  description: string;
  scenarios: TestScenario[];
  config?: HarnessConfig;
  parallel?: boolean;
  maxParallel?: number;
  continueOnFailure?: boolean;
}

export interface TestResult {
  suite: string;
  scenario: string;
  success: boolean;
  metrics: TestMetrics;
  error?: Error;
  duration: number;
  timestamp: number;
}

export interface TestReport {
  startTime: number;
  endTime: number;
  duration: number;
  suites: TestSuiteReport[];
  summary: {
    totalScenarios: number;
    passed: number;
    failed: number;
    skipped: number;
    memoryLeaks: number;
    performanceIssues: number;
    errors: number;
  };
}

export interface TestSuiteReport {
  name: string;
  results: TestResult[];
  passed: number;
  failed: number;
  duration: number;
}

export class AgentTestRunner extends EventEmitter {
  private suites: Map<string, TestSuite> = new Map();
  private results: TestResult[] = [];
  private isRunning: boolean = false;
  private startTime: number = 0;

  constructor() {
    super();
  }

  /**
   * Register a test suite
   */
  registerSuite(suite: TestSuite): void {
    if (this.suites.has(suite.name)) {
      throw new Error(`Test suite '${suite.name}' already registered`);
    }
    this.suites.set(suite.name, suite);
    this.emit('suiteRegistered', { suite: suite.name });
  }

  /**
   * Run all registered test suites
   */
  async runAll(): Promise<TestReport> {
    if (this.isRunning) {
      throw new Error('Test runner is already running');
    }

    this.isRunning = true;
    this.startTime = Date.now();
    this.results = [];

    const report: TestReport = {
      startTime: this.startTime,
      endTime: 0,
      duration: 0,
      suites: [],
      summary: {
        totalScenarios: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        memoryLeaks: 0,
        performanceIssues: 0,
        errors: 0,
      },
    };

    try {
      for (const [name, suite] of this.suites) {
        const suiteReport = await this.runSuite(suite);
        report.suites.push(suiteReport);

        // Update summary
        report.summary.totalScenarios += suiteReport.results.length;
        report.summary.passed += suiteReport.passed;
        report.summary.failed += suiteReport.failed;
      }

      report.endTime = Date.now();
      report.duration = report.endTime - report.startTime;

      // Count memory leaks and performance issues
      for (const result of this.results) {
        if (result.metrics.memoryUsage.leaks.length > 0) {
          report.summary.memoryLeaks += result.metrics.memoryUsage.leaks.length;
        }
        if (result.metrics.warnings.length > 0) {
          report.summary.performanceIssues += result.metrics.warnings.length;
        }
        report.summary.errors += result.metrics.errors.length;
      }

      this.emit('testRunCompleted', report);
      return report;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run a specific test suite
   */
  async runSuite(suite: TestSuite): Promise<TestSuiteReport> {
    this.emit('suiteStarted', { suite: suite.name });
    const suiteStartTime = Date.now();

    const report: TestSuiteReport = {
      name: suite.name,
      results: [],
      passed: 0,
      failed: 0,
      duration: 0,
    };

    if (suite.parallel && suite.scenarios.length > 1) {
      // Run scenarios in parallel
      const maxParallel = suite.maxParallel || 4;
      const chunks = this.chunkArray(suite.scenarios, maxParallel);

      for (const chunk of chunks) {
        const promises = chunk.map((scenario) => this.runScenario(scenario, suite.config));

        const results = await Promise.allSettled(promises);

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const scenario = chunk[i];

          if (result.status === 'fulfilled') {
            report.results.push(result.value);
            if (result.value.success) {
              report.passed++;
            } else {
              report.failed++;
            }
          } else {
            // Handle rejected promise
            const errorResult: TestResult = {
              suite: suite.name,
              scenario: scenario.name,
              success: false,
              metrics: this.createErrorMetrics(result.reason),
              error: result.reason,
              duration: 0,
              timestamp: Date.now(),
            };
            report.results.push(errorResult);
            report.failed++;
          }
        }
      }
    } else {
      // Run scenarios sequentially
      for (const scenario of suite.scenarios) {
        try {
          const result = await this.runScenario(scenario, suite.config);
          report.results.push(result);

          if (result.success) {
            report.passed++;
          } else {
            report.failed++;
            if (!suite.continueOnFailure) {
              break;
            }
          }
        } catch (error) {
          const errorResult: TestResult = {
            suite: suite.name,
            scenario: scenario.name,
            success: false,
            metrics: this.createErrorMetrics(error as Error),
            error: error as Error,
            duration: 0,
            timestamp: Date.now(),
          };
          report.results.push(errorResult);
          report.failed++;

          if (!suite.continueOnFailure) {
            break;
          }
        }
      }
    }

    report.duration = Date.now() - suiteStartTime;
    this.emit('suiteCompleted', report);
    return report;
  }

  /**
   * Run a single test scenario
   */
  private async runScenario(scenario: TestScenario, config?: HarnessConfig): Promise<TestResult> {
    this.emit('scenarioStarted', { scenario: scenario.name });
    const startTime = Date.now();

    const harness = new AgentTestHarness(config);

    try {
      await harness.start();
      const metrics = await harness.runScenario(scenario);
      await harness.stop();

      const result: TestResult = {
        suite: 'unknown',
        scenario: scenario.name,
        success: metrics.errors.length === 0,
        metrics,
        duration: Date.now() - startTime,
        timestamp: startTime,
      };

      this.results.push(result);
      this.emit('scenarioCompleted', result);

      await harness.cleanup();
      return result;
    } catch (error) {
      await harness.cleanup();

      const result: TestResult = {
        suite: 'unknown',
        scenario: scenario.name,
        success: false,
        metrics: harness.getMetrics(),
        error: error as Error,
        duration: Date.now() - startTime,
        timestamp: startTime,
      };

      this.results.push(result);
      this.emit('scenarioFailed', result);
      return result;
    }
  }

  /**
   * Generate HTML report
   */
  async generateHTMLReport(report: TestReport, outputPath: string): Promise<void> {
    const html = this.generateHTMLContent(report);
    await fs.writeFile(outputPath, html, 'utf-8');
    this.emit('reportGenerated', { path: outputPath, type: 'html' });
  }

  /**
   * Generate JSON report
   */
  async generateJSONReport(report: TestReport, outputPath: string): Promise<void> {
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    this.emit('reportGenerated', { path: outputPath, type: 'json' });
  }

  /**
   * Generate Markdown report
   */
  async generateMarkdownReport(report: TestReport, outputPath: string): Promise<void> {
    const markdown = this.generateMarkdownContent(report);
    await fs.writeFile(outputPath, markdown, 'utf-8');
    this.emit('reportGenerated', { path: outputPath, type: 'markdown' });
  }

  // Helper methods

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private createErrorMetrics(error: Error): TestMetrics {
    return {
      memoryUsage: {
        initial: process.memoryUsage(),
        current: process.memoryUsage(),
        peak: process.memoryUsage(),
        leaks: [],
      },
      performance: {
        startTime: Date.now(),
        endTime: Date.now(),
        operations: [],
        responseTimes: [],
        operationCount: 0,
        averageResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
      },
      errors: [
        {
          timestamp: Date.now(),
          phase: 'execution',
          error,
          message: error.message,
          operation: 'test-execution',
          stack: error.stack,
        },
      ],
      warnings: [],
      coverage: {
        linesExecuted: 0,
        totalLines: 0,
        percentage: 0,
      },
    };
  }

  private generateHTMLContent(report: TestReport): string {
    const passRate =
      report.summary.totalScenarios > 0
        ? ((report.summary.passed / report.summary.totalScenarios) * 100).toFixed(2)
        : '0';

    return `<!DOCTYPE html>
<html>
<head>
  <title>Agent Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .header { background: #f0f0f0; padding: 20px; border-radius: 5px; }
    .summary { margin: 20px 0; }
    .suite { margin: 20px 0; border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
    .passed { color: green; }
    .failed { color: red; }
    .warning { color: orange; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Agent Test Report</h1>
    <p>Generated: ${new Date(report.endTime).toLocaleString()}</p>
    <p>Duration: ${(report.duration / 1000).toFixed(2)}s</p>
  </div>

  <div class="summary">
    <h2>Summary</h2>
    <p>Pass Rate: <strong>${passRate}%</strong></p>
    <p class="passed">Passed: ${report.summary.passed}</p>
    <p class="failed">Failed: ${report.summary.failed}</p>
    <p class="warning">Memory Leaks: ${report.summary.memoryLeaks}</p>
    <p class="warning">Performance Issues: ${report.summary.performanceIssues}</p>
    <p class="failed">Errors: ${report.summary.errors}</p>
  </div>

  ${report.suites
    .map(
      (suite) => `
    <div class="suite">
      <h3>${suite.name}</h3>
      <p>Duration: ${(suite.duration / 1000).toFixed(2)}s</p>
      <table>
        <tr>
          <th>Scenario</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Errors</th>
          <th>Memory Leaks</th>
        </tr>
        ${suite.results
    .map(
      (result) => `
          <tr>
            <td>${result.scenario}</td>
            <td class="${result.success ? 'passed' : 'failed'}">${result.success ? 'PASSED' : 'FAILED'}</td>
            <td>${(result.duration / 1000).toFixed(2)}s</td>
            <td>${result.metrics.errors.length}</td>
            <td>${result.metrics.memoryUsage.leaks.length}</td>
          </tr>
        `,
    )
    .join('')}
      </table>
    </div>
  `,
    )
    .join('')}
</body>
</html>`;
  }

  private generateMarkdownContent(report: TestReport): string {
    const passRate =
      report.summary.totalScenarios > 0
        ? ((report.summary.passed / report.summary.totalScenarios) * 100).toFixed(2)
        : '0';

    let markdown = '# Agent Test Report\n\n';
    markdown += `**Generated:** ${new Date(report.endTime).toLocaleString()}\n`;
    markdown += `**Duration:** ${(report.duration / 1000).toFixed(2)}s\n\n`;

    markdown += '## Summary\n\n';
    markdown += `- **Pass Rate:** ${passRate}%\n`;
    markdown += `- **Passed:** ${report.summary.passed}\n`;
    markdown += `- **Failed:** ${report.summary.failed}\n`;
    markdown += `- **Memory Leaks:** ${report.summary.memoryLeaks}\n`;
    markdown += `- **Performance Issues:** ${report.summary.performanceIssues}\n`;
    markdown += `- **Errors:** ${report.summary.errors}\n\n`;

    for (const suite of report.suites) {
      markdown += `## ${suite.name}\n\n`;
      markdown += `Duration: ${(suite.duration / 1000).toFixed(2)}s\n\n`;
      markdown += '| Scenario | Status | Duration | Errors | Memory Leaks |\n';
      markdown += '|----------|--------|----------|--------|-------------|\n';

      for (const result of suite.results) {
        const status = result.success ? '✅ PASSED' : '❌ FAILED';
        markdown += `| ${result.scenario} | ${status} | ${(result.duration / 1000).toFixed(2)}s | ${result.metrics.errors.length} | ${result.metrics.memoryUsage.leaks.length} |\n`;
      }
      markdown += '\n';
    }

    return markdown;
  }
}

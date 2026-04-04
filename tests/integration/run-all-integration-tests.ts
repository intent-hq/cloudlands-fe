#!/usr/bin/env tsx
/**
 * Integration Test Runner
 *
 * Executes all integration tests with comprehensive reporting
 * and performance metrics.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  errors: string[];
  memoryUsage: NodeJS.MemoryUsage;
}

interface TestReport {
  timestamp: string;
  totalDuration: number;
  suites: TestResult[];
  summary: {
    totalPassed: number;
    totalFailed: number;
    totalSkipped: number;
    totalSuites: number;
    successRate: number;
  };
  performance: {
    peakMemory: number;
    averageDuration: number;
  };
}

class IntegrationTestRunner {
  private results: TestResult[] = [];
  private startTime: number = 0;
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /**
   * Run a single test suite
   */
  private async runTestSuite(suitePath: string): Promise<TestResult> {
    return new Promise((resolve) => {
      const suiteName = path.basename(suitePath, '.test.ts');
      console.log(`\n🧪 Running ${suiteName}...`);

      const startTime = performance.now();

      const proc = spawn('npx', ['vitest', 'run', suitePath], {
        stdio: this.verbose ? 'inherit' : 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
      });

      let output = '';
      let errorOutput = '';

      if (!this.verbose) {
        proc.stdout?.on('data', (data) => {
          output += data.toString();
        });

        proc.stderr?.on('data', (data) => {
          errorOutput += data.toString();
        });
      }

      proc.on('close', (code) => {
        const duration = performance.now() - startTime;
        const endMemory = process.memoryUsage();

        // Parse test results from output
        const passed = (output.match(/✓/g) || []).length;
        const failed = (output.match(/✗/g) || []).length;
        const skipped = (output.match(/↓/g) || []).length;

        const result: TestResult = {
          suite: suiteName,
          passed,
          failed,
          skipped,
          duration,
          errors: errorOutput ? [errorOutput] : [],
          memoryUsage: endMemory,
        };

        if (code === 0) {
          console.log(`✅ ${suiteName} completed (${passed} passed, ${duration.toFixed(2)}ms)`);
        } else {
          console.log(`❌ ${suiteName} failed (${failed} failures)`);
        }

        resolve(result);
      });
    });
  }

  /**
   * Run all integration tests
   */
  async runAll(): Promise<TestReport> {
    this.startTime = performance.now();

    console.log('🚀 Starting Integration Test Suite');
    console.log('================================\n');

    // Find all integration test files
    const testDir = path.join(__dirname);
    const files = await fs.readdir(testDir);
    const testFiles = files.filter(
      (f) => f.endsWith('.test.ts') && f !== 'run-all-integration-tests.ts',
    );

    console.log(`Found ${testFiles.length} test suites to run:`);
    testFiles.forEach((f) => console.log(`  - ${f}`));

    // Run tests sequentially to avoid resource conflicts
    for (const testFile of testFiles) {
      const testPath = path.join(testDir, testFile);
      const result = await this.runTestSuite(testPath);
      this.results.push(result);
    }

    // Generate report
    const report = this.generateReport();

    // Save report to file
    await this.saveReport(report);

    // Print summary
    this.printSummary(report);

    return report;
  }

  /**
   * Generate test report
   */
  private generateReport(): TestReport {
    const totalDuration = performance.now() - this.startTime;

    const summary = {
      totalPassed: this.results.reduce((sum, r) => sum + r.passed, 0),
      totalFailed: this.results.reduce((sum, r) => sum + r.failed, 0),
      totalSkipped: this.results.reduce((sum, r) => sum + r.skipped, 0),
      totalSuites: this.results.length,
      successRate: 0,
    };

    const totalTests = summary.totalPassed + summary.totalFailed;
    summary.successRate = totalTests > 0 ? (summary.totalPassed / totalTests) * 100 : 0;

    const peakMemory = Math.max(...this.results.map((r) => r.memoryUsage.heapUsed));
    const averageDuration =
      this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length;

    return {
      timestamp: new Date().toISOString(),
      totalDuration,
      suites: this.results,
      summary,
      performance: {
        peakMemory,
        averageDuration,
      },
    };
  }

  /**
   * Save report to file
   */
  private async saveReport(report: TestReport): Promise<void> {
    const reportDir = path.join(__dirname, '..', '..', 'test-reports');
    await fs.mkdir(reportDir, { recursive: true });

    const reportPath = path.join(reportDir, `integration-test-report-${Date.now()}.json`);

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Report saved to: ${reportPath}`);
  }

  /**
   * Print test summary
   */
  private printSummary(report: TestReport): void {
    console.log('\n================================');
    console.log('📊 Integration Test Summary');
    console.log('================================\n');

    console.log('Test Results:');
    console.log(`  ✅ Passed: ${report.summary.totalPassed}`);
    console.log(`  ❌ Failed: ${report.summary.totalFailed}`);
    console.log(`  ⏭️  Skipped: ${report.summary.totalSkipped}`);
    console.log(`  📦 Total Suites: ${report.summary.totalSuites}`);
    console.log(`  🎯 Success Rate: ${report.summary.successRate.toFixed(2)}%`);

    console.log('\nPerformance:');
    console.log(`  ⏱️  Total Duration: ${(report.totalDuration / 1000).toFixed(2)}s`);
    console.log(
      `  ⚡ Average Suite Duration: ${(report.performance.averageDuration / 1000).toFixed(2)}s`,
    );
    console.log(`  💾 Peak Memory: ${(report.performance.peakMemory / 1024 / 1024).toFixed(2)}MB`);

    if (report.summary.totalFailed > 0) {
      console.log('\n❌ Failed Suites:');
      report.suites
        .filter((s) => s.failed > 0)
        .forEach((s) => {
          console.log(`  - ${s.suite}: ${s.failed} failures`);
          if (s.errors.length > 0 && this.verbose) {
            s.errors.forEach((e) => console.log(`    ${e.substring(0, 100)}...`));
          }
        });
    }

    console.log('\n================================');

    if (report.summary.successRate === 100) {
      console.log('🎉 All tests passed! Great job!');
    } else if (report.summary.successRate >= 80) {
      console.log('⚠️  Most tests passed, but some failures need attention.');
    } else {
      console.log('🔴 Significant test failures detected. Please review and fix.');
    }
  }
}

// Main execution
async function main() {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const runner = new IntegrationTestRunner(verbose);

  try {
    const report = await runner.runAll();

    // Exit with appropriate code
    process.exit(report.summary.totalFailed > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { IntegrationTestRunner, TestReport, TestResult };

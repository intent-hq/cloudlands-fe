/**
 * Agent Testing Service
 *
 * Main service that AI agents can use to test their changes.
 * Provides a unified interface for all testing capabilities.
 */

import { Logger } from '../../../shared/logger';
import type { Result } from '../../../shared/types';
import { ipcTestRunner, IPCTestCase, IPCTestResult } from './ipc-test-framework';
import {
  componentTestRunner,
  ComponentTestCase,
  ComponentTestResult,
} from './component-test-framework';
import {
  integrationTestRunner,
  IntegrationTestScenario,
  IntegrationTestResult,
} from './integration-test-framework';
import { promises as fs } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { getSafeHomeDir } from '../../../shared/main/utils';

const logger = new Logger('AgentTestingService');

export interface AgentTestRequest {
  type: 'ipc' | 'component' | 'integration' | 'unit' | 'e2e';
  workspaceId: string;
  agentId: string;
  tests: any[];
  options?: {
    coverage?: boolean;
    parallel?: boolean;
    timeout?: number;
    outputPath?: string;
  };
}

export interface AgentTestReport {
  requestId: string;
  agentId: string;
  workspaceId: string;
  timestamp: number;
  type: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  results: any[];
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
  suggestions?: string[];
}

/**
 * Agent Testing Service
 */
export class AgentTestingService {
  private testReports: Map<string, AgentTestReport> = new Map();
  private _testOutputDir: string | null = null;

  /**
   * Get the test output directory path.
   * Lazily initialized to avoid calling getSafeHomeDir() during module load
   * when the home directory might not be available yet.
   */
  private get testOutputDir(): string {
    if (this._testOutputDir === null) {
      const safeHome = getSafeHomeDir();
      this._testOutputDir = join(safeHome, '.augment', 'agent-tests');
      logger.debug(`Test output directory initialized: ${this._testOutputDir} (home: ${safeHome})`);
    }
    return this._testOutputDir;
  }

  private async ensureTestOutputDir(): Promise<void> {
    const dir = this.testOutputDir;

    // Validate the directory path before attempting to create it
    if (!dir || dir.length <= 1 || dir.startsWith('/.')) {
      const error = new Error(
        `Invalid test output directory: "${dir}". This usually means the home directory could not be determined. ` +
          `Home: ${getSafeHomeDir()}`,
      );
      logger.error('Failed to initialize test output directory', error);
      throw error;
    }

    try {
      await fs.access(dir);
    } catch {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (mkdirError) {
        logger.error(`Failed to create test output directory: ${dir}`, mkdirError);
        throw mkdirError;
      }
    }
  }

  /**
   * Run tests for an agent
   */
  async runTests(request: AgentTestRequest): Promise<Result<AgentTestReport, string>> {
    const requestId = `${request.agentId}-${Date.now()}`;
    const _startTime = Date.now();

    logger.info(`Running ${request.type} tests for agent ${request.agentId}`);

    try {
      let results: any[] = [];
      let summary = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
      };

      switch (request.type) {
        case 'ipc': {
          const testResults = await this.runIPCTests(request.tests as IPCTestCase[]);
          results = testResults.results;
          summary = {
            total: testResults.summary.total,
            passed: testResults.summary.passed,
            failed: testResults.summary.failed,
            skipped: 0,
            duration: testResults.summary.duration,
          };
          break;
        }

        case 'component': {
          const componentResults = await this.runComponentTests(
            request.tests as ComponentTestCase[],
          );
          results = componentResults;
          summary = {
            total: componentResults.length,
            passed: componentResults.filter((r) => r.success).length,
            failed: componentResults.filter((r) => !r.success).length,
            skipped: 0,
            duration: componentResults.reduce((sum, r) => sum + r.duration, 0),
          };
          break;
        }

        case 'integration': {
          const scenarios = request.tests as IntegrationTestScenario[];
          const integrationResults = await this.runIntegrationTests(scenarios);
          results = integrationResults;
          summary = {
            total: integrationResults.length,
            passed: integrationResults.filter((r) => r.success).length,
            failed: integrationResults.filter((r) => !r.success).length,
            skipped: 0,
            duration: integrationResults.reduce((sum, r) => sum + (r.totalDuration || 0), 0),
          };
          break;
        }

        case 'unit': {
          const unitResults = await this.runUnitTests(request);
          results = unitResults.results;
          summary = unitResults.summary;
          break;
        }

        case 'e2e': {
          const e2eResults = await this.runE2ETests(request);
          results = e2eResults.results;
          summary = e2eResults.summary;
          break;
        }

        default:
          return {
            ok: false,
            error: `Unknown test type: ${request.type}`,
          };
      }

      // Generate suggestions based on failures
      const suggestions = this.generateSuggestions(results, request.type);

      // Create test report
      const report: AgentTestReport = {
        requestId,
        agentId: request.agentId,
        workspaceId: request.workspaceId,
        timestamp: Date.now(),
        type: request.type,
        summary,
        results,
        suggestions,
      };

      // Save report
      await this.saveReport(report);
      this.testReports.set(requestId, report);

      return {
        ok: true,
        data: report,
      };
    } catch (error) {
      logger.error('Test execution failed:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Test execution failed',
      };
    }
  }

  /**
   * Run IPC tests
   */
  private async runIPCTests(tests: IPCTestCase[]): Promise<{
    results: IPCTestResult[];
    summary: {
      total: number;
      passed: number;
      failed: number;
      duration: number;
    };
  }> {
    const results = await ipcTestRunner.runTests(tests);
    return {
      results,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        duration: results.reduce((sum, r) => sum + (r.duration || 0), 0),
      },
    };
  }

  /**
   * Run component tests
   */
  private async runComponentTests(tests: ComponentTestCase[]): Promise<ComponentTestResult[]> {
    const results: ComponentTestResult[] = [];

    for (const test of tests) {
      const result = await componentTestRunner.runTest(test);
      results.push(result);
    }

    return results;
  }

  /**
   * Run integration tests
   */
  private async runIntegrationTests(
    scenarios: IntegrationTestScenario[],
  ): Promise<IntegrationTestResult[]> {
    const results: IntegrationTestResult[] = [];

    for (const scenario of scenarios) {
      const result = await integrationTestRunner.runScenario(scenario);
      results.push(result);
    }

    return results;
  }

  /**
   * Run unit tests using the project's test runner
   */
  private async runUnitTests(request: AgentTestRequest): Promise<{
    results: any[];
    summary: any;
  }> {
    return new Promise((resolve, reject) => {
      const args = ['run', 'test', '--run'];

      if (request.options?.coverage) {
        args.push('--coverage');
      }

      const testProcess = spawn('npm', args, {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'test' },
        shell: true,
        windowsHide: true,
      });

      let output = '';
      let errorOutput = '';

      testProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      testProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      testProcess.on('close', (code) => {
        const success = code === 0;

        // Parse test output
        const results = this.parseTestOutput(output);

        resolve({
          results: [
            {
              type: 'unit',
              success,
              output,
              errorOutput,
              exitCode: code,
            },
          ],
          summary: {
            total: results.total || 1,
            passed: success ? results.passed || 1 : 0,
            failed: success ? 0 : results.failed || 1,
            skipped: results.skipped || 0,
            duration: results.duration || 0,
          },
        });
      });

      testProcess.on('error', reject);
    });
  }

  /**
   * Run end-to-end tests
   */
  private async runE2ETests(request: AgentTestRequest): Promise<{
    results: any[];
    summary: any;
  }> {
    // Similar to unit tests but with e2e configuration
    return this.runUnitTests(request);
  }

  /**
   * Parse test output to extract results
   */
  private parseTestOutput(output: string): {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
    duration?: number;
  } {
    const result: any = {};

    // Try to parse common test output patterns
    const totalMatch = output.match(/(\d+) test(?:s)? total/i);
    if (totalMatch) result.total = parseInt(totalMatch[1]);

    const passedMatch = output.match(/(\d+) pass(?:ed)?/i);
    if (passedMatch) result.passed = parseInt(passedMatch[1]);

    const failedMatch = output.match(/(\d+) fail(?:ed)?/i);
    if (failedMatch) result.failed = parseInt(failedMatch[1]);

    const skippedMatch = output.match(/(\d+) skip(?:ped)?/i);
    if (skippedMatch) result.skipped = parseInt(skippedMatch[1]);

    const durationMatch = output.match(/Time:\s*([\d.]+)(?:ms|s)/i);
    if (durationMatch) {
      const value = parseFloat(durationMatch[1]);
      result.duration = output.includes('ms') ? value : value * 1000;
    }

    return result;
  }

  /**
   * Generate suggestions based on test failures
   */
  private generateSuggestions(results: any[], testType: string): string[] {
    const suggestions: string[] = [];

    // Analyze failures and provide suggestions
    for (const result of results) {
      if (!result.success) {
        if (result.error?.includes('timeout')) {
          suggestions.push('Consider increasing the timeout for slow operations');
        }

        if (result.error?.includes('not found')) {
          suggestions.push('Verify that all required elements/channels exist');
        }

        if (result.error?.includes('permission')) {
          suggestions.push('Check file/directory permissions');
        }

        if (testType === 'ipc' && result.error?.includes('channel')) {
          suggestions.push('Ensure the IPC channel is properly registered in preload');
        }

        if (testType === 'component' && result.error?.includes('import')) {
          suggestions.push('Check component import paths and dependencies');
        }
      }
    }

    // Remove duplicates
    return [...new Set(suggestions)];
  }

  /**
   * Save test report to disk
   */
  private async saveReport(report: AgentTestReport): Promise<void> {
    const filename = `${report.requestId}.json`;
    const filepath = join(this.testOutputDir, filename);

    await this.ensureTestOutputDir();
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    logger.info(`Test report saved to ${filepath}`);
  }

  /**
   * Get test report by ID
   */
  async getReport(requestId: string): Promise<AgentTestReport | undefined> {
    // Try memory first
    let report = this.testReports.get(requestId);

    // Try disk if not in memory
    if (!report) {
      const filepath = join(this.testOutputDir, `${requestId}.json`);
      try {
        const data = await fs.readFile(filepath, 'utf-8');
        report = JSON.parse(data);
        if (report) {
          this.testReports.set(requestId, report);
        }
      } catch {
        // File doesn't exist or couldn't be read
      }
    }

    return report;
  }

  /**
   * Get all reports for an agent
   */
  getAgentReports(agentId: string): AgentTestReport[] {
    const reports: AgentTestReport[] = [];

    // Check memory
    for (const report of this.testReports.values()) {
      if (report.agentId === agentId) {
        reports.push(report);
      }
    }

    return reports;
  }

  /**
   * Clean up old test reports
   */
  cleanupOldReports(daysToKeep: number = 7): void {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    // Clean memory
    for (const [id, report] of this.testReports.entries()) {
      if (report.timestamp < cutoffTime) {
        this.testReports.delete(id);
      }
    }

    logger.info(`Cleaned up test reports older than ${daysToKeep} days`);
  }
}

// Export singleton instance
export const agentTestingService = new AgentTestingService();

/**
 * Testing Service
 *
 * Provides isolated testing capabilities for agents to evaluate their changes
 * without interfering with the user's development server.
 */

import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import type { Result } from '../../shared/types';

export interface TestOptions {
  workspaceId: string;
  testFiles?: string[];
  testPattern?: string;
  coverage?: boolean;
  watch?: boolean;
  timeout?: number;
}

export interface TestResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration: number;
  output: string;
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
}

export interface LintOptions {
  workspaceId: string;
  files?: string[];
  fix?: boolean;
}

export interface LintResult {
  passed: boolean;
  errors: number;
  warnings: number;
  fixable: number;
  output: string;
}

export interface BuildOptions {
  workspaceId: string;
  watch?: boolean;
  production?: boolean;
}

export interface BuildResult {
  success: boolean;
  duration: number;
  output: string;
  artifacts?: string[];
}

class TestingService {
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private tempDirs: Map<string, string> = new Map();

  /**
   * Run tests in an isolated environment
   */
  async runTests(options: TestOptions): Promise<Result<TestResult, string>> {
    const processId = `test-${options.workspaceId}-${Date.now()}`;

    try {
      // Create a temporary directory for test output
      const tempDir = this.createTempDir(processId);

      // Build the test command
      const args: string[] = ['run', 'test'];

      if (options.testFiles && options.testFiles.length > 0) {
        args.push(...options.testFiles);
      } else if (options.testPattern) {
        args.push(options.testPattern);
      }

      if (options.coverage) {
        args.push('--coverage');
      }

      if (!options.watch) {
        args.push('--run');
      }

      // Run tests
      const result = await this.runCommand('npm', args, {
        cwd: process.cwd(),
        timeout: options.timeout || 60000,
        processId,
      });

      // Parse test results
      const testResult = this.parseTestOutput(result.output);

      return {
        ok: true,
        data: testResult,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to run tests',
      };
    } finally {
      this.cleanup(processId);
    }
  }

  /**
   * Run linting in an isolated environment
   */
  async runLint(options: LintOptions): Promise<Result<LintResult, string>> {
    const processId = `lint-${options.workspaceId}-${Date.now()}`;

    try {
      // Build the lint command
      const args: string[] = ['run', 'lint'];

      if (options.files && options.files.length > 0) {
        args.push(...options.files);
      }

      if (options.fix) {
        args.push('--fix');
      }

      // Run linting
      const result = await this.runCommand('npm', args, {
        cwd: process.cwd(),
        timeout: 30000,
        processId,
      });

      // Parse lint results
      const lintResult = this.parseLintOutput(result.output);

      return {
        ok: true,
        data: lintResult,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to run linting',
      };
    } finally {
      this.cleanup(processId);
    }
  }

  /**
   * Run build in an isolated environment
   */
  async runBuild(options: BuildOptions): Promise<Result<BuildResult, string>> {
    const processId = `build-${options.workspaceId}-${Date.now()}`;

    try {
      const startTime = Date.now();

      // Build the build command
      const args: string[] = ['run'];

      if (options.production) {
        args.push('build');
      } else {
        args.push('build:dev');
      }

      // Run build
      const result = await this.runCommand('npm', args, {
        cwd: process.cwd(),
        timeout: 120000,
        processId,
      });

      const duration = Date.now() - startTime;

      return {
        ok: true,
        data: {
          success: result.exitCode === 0,
          duration,
          output: result.output,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to run build',
      };
    } finally {
      this.cleanup(processId);
    }
  }

  /**
   * Stop a running process
   */
  async stopProcess(processId: string): Promise<Result<void, string>> {
    const process = this.runningProcesses.get(processId);

    if (!process) {
      return {
        ok: false,
        error: 'Process not found',
      };
    }

    try {
      process.kill('SIGTERM');
      this.runningProcesses.delete(processId);
      this.cleanup(processId);

      return { ok: true, data: undefined };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to stop process',
      };
    }
  }

  /**
   * Get list of running processes
   */
  getRunningProcesses(): string[] {
    return Array.from(this.runningProcesses.keys());
  }

  // Private helper methods

  private createTempDir(processId: string): string {
    const tempDir = join(tmpdir(), `agent-test-${processId}`);

    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    this.tempDirs.set(processId, tempDir);
    return tempDir;
  }

  private cleanup(processId: string): void {
    // Clean up temp directory
    const tempDir = this.tempDirs.get(processId);
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    this.tempDirs.delete(processId);

    // Clean up process
    const process = this.runningProcesses.get(processId);
    if (process && !process.killed) {
      process.kill();
    }
    this.runningProcesses.delete(processId);
  }

  private async runCommand(
    command: string,
    args: string[],
    options: {
      cwd: string;
      timeout: number;
      processId: string;
    },
  ): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      const childProcess = spawn(command, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          CI: 'true',
          FORCE_COLOR: '0',
        },
        windowsHide: true,
      });

      this.runningProcesses.set(options.processId, childProcess);

      childProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      const timeout = setTimeout(() => {
        childProcess.kill();
        reject(new Error('Command timed out'));
      }, options.timeout);

      childProcess.on('close', (code: number | null) => {
        clearTimeout(timeout);
        this.runningProcesses.delete(options.processId);

        resolve({
          output: output + errorOutput,
          exitCode: code || 0,
        });
      });

      childProcess.on('error', (error: Error) => {
        clearTimeout(timeout);
        this.runningProcesses.delete(options.processId);
        reject(error);
      });
    });
  }

  private parseTestOutput(output: string): TestResult {
    // Parse Vitest output
    const lines = output.split('\n');
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let skippedTests = 0;
    let duration = 0;

    for (const line of lines) {
      // Look for test summary line
      if (line.includes('Tests')) {
        const match = line.match(/(\d+) passed/);
        if (match) passedTests = parseInt(match[1]);

        const failMatch = line.match(/(\d+) failed/);
        if (failMatch) failedTests = parseInt(failMatch[1]);

        const skipMatch = line.match(/(\d+) skipped/);
        if (skipMatch) skippedTests = parseInt(skipMatch[1]);
      }

      // Look for duration
      if (line.includes('Duration')) {
        const match = line.match(/(\d+\.?\d*)\s*(ms|s)/);
        if (match) {
          duration = parseFloat(match[1]);
          if (match[2] === 's') duration *= 1000;
        }
      }
    }

    totalTests = passedTests + failedTests + skippedTests;

    return {
      passed: failedTests === 0,
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      duration,
      output,
    };
  }

  private parseLintOutput(output: string): LintResult {
    // Parse ESLint output
    const lines = output.split('\n');
    let errors = 0;
    let warnings = 0;
    let fixable = 0;

    for (const line of lines) {
      // Look for summary line
      if (line.includes('problem')) {
        const errorMatch = line.match(/(\d+) error/);
        if (errorMatch) errors = parseInt(errorMatch[1]);

        const warnMatch = line.match(/(\d+) warning/);
        if (warnMatch) warnings = parseInt(warnMatch[1]);

        const fixMatch = line.match(/(\d+) fixable/);
        if (fixMatch) fixable = parseInt(fixMatch[1]);
      }
    }

    return {
      passed: errors === 0,
      errors,
      warnings,
      fixable,
      output,
    };
  }
}

export const testingService = new TestingService();

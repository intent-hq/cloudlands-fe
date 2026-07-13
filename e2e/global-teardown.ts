/**
 * Global Teardown for E2E Tests
 *
 * Cleans up after all tests have completed
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const TEST_DIRS = [
  '.test-workspaces',
  '.test-workspaces-multi',
  '.test-workspaces-error',
  '.test-workspaces-perf',
];

async function globalTeardown() {
  console.log('\n🧹 Starting E2E test global teardown...');

  // Kill any remaining Electron processes
  console.log('  Terminating Electron processes...');
  try {
    await killElectronProcesses();
    console.log('  ✓ Electron processes terminated');
  } catch (e) {
    console.warn('  ⚠ Could not terminate processes:', e);
  }

  // Clean up test directories if not in CI
  if (!process.env.CI && process.env.CLEANUP_AFTER_TEST !== 'false') {
    console.log('  Cleaning up test directories...');
    for (const dir of TEST_DIRS) {
      const fullPath = path.join(process.cwd(), dir);
      try {
        await fs.rm(fullPath, { recursive: true, force: true });
        console.log(`  ✓ Removed ${dir}`);
      } catch (e) {
        console.warn(`  ⚠ Could not remove ${dir}:`, e);
      }
    }
  } else {
    console.log('  ℹ Keeping test directories for inspection');
  }

  // Generate test summary
  await generateTestSummary();

  console.log('✅ Global teardown completed');
}

async function killElectronProcesses() {
  return new Promise<void>((resolve) => {
    const isWindows = process.platform === 'win32';
    const killProcess = isWindows
      ? spawn('taskkill', ['/F', '/IM', 'electron.exe'], {
          stdio: 'ignore',
          shell: true,
          windowsHide: true,
        })
      : spawn('pkill', ['-9', '-f', 'electron'], {
          stdio: 'ignore',
          shell: true,
        });

    killProcess.on('close', () => {
      resolve();
    });

    killProcess.on('error', () => {
      resolve();
    });
  });
}

async function generateTestSummary() {
  const summaryPath = path.join(process.cwd(), 'e2e-reports', 'summary.md');
  const resultsPath = path.join(process.cwd(), 'e2e-reports', 'results.json');

  try {
    // Check if results file exists
    await fs.access(resultsPath);

    // Read results
    const resultsData = await fs.readFile(resultsPath, 'utf-8');
    const results = JSON.parse(resultsData);

    // Generate summary
    const summary = `# E2E Test Summary

## Test Run Information
- **Date**: ${new Date().toISOString()}
- **Environment**: ${process.env.CI ? 'CI' : 'Local'}
- **Node Version**: ${process.version}

## Results
- **Total Tests**: ${results.stats?.tests || 0}
- **Passed**: ${results.stats?.passes || 0}
- **Failed**: ${results.stats?.failures || 0}
- **Skipped**: ${results.stats?.skipped || 0}
- **Duration**: ${results.stats?.duration || 0}ms

## Test Suites
${generateSuiteSummary(results)}

## Failed Tests
${generateFailedTestsList(results)}

## Performance Metrics
${generatePerformanceMetrics(results)}
`;

    await fs.writeFile(summaryPath, summary, 'utf-8');
    console.log(`  ✓ Test summary generated at ${summaryPath}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('  ℹ No Playwright JSON results found; skipping test summary generation');
      return;
    }
    console.warn('  ⚠ Could not generate test summary:', e);
  }
}

function generateSuiteSummary(results: any): string {
  if (!results.suites || results.suites.length === 0) {
    return '- No test suites found';
  }

  return results.suites
    .map((suite: any) => `- **${suite.title}**: ${suite.passes}/${suite.tests} passed (${suite.duration}ms)`)
    .join('\n');
}

function generateFailedTestsList(results: any): string {
  if (!results.failures || results.failures.length === 0) {
    return '✅ No failed tests';
  }

  return results.failures
    .map((failure: any) => `- **${failure.title}**\n  - File: ${failure.file}\n  - Error: ${failure.error}`)
    .join('\n\n');
}

function generatePerformanceMetrics(results: any): string {
  // Extract performance metrics from test results
  const metrics = results.performanceMetrics || {};

  return `
- **Average Test Duration**: ${metrics.avgDuration || 'N/A'}ms
- **Slowest Test**: ${metrics.slowest || 'N/A'}
- **Fastest Test**: ${metrics.fastest || 'N/A'}
- **Memory Usage**: ${metrics.memoryUsage || 'N/A'}MB
`;
}

export default globalTeardown;

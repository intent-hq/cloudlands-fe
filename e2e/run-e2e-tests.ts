#!/usr/bin/env tsx
/**
 * E2E Test Runner
 *
 * Orchestrates the execution of end-to-end tests with proper setup and reporting
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';

// Parse command line arguments
const { values: args } = parseArgs({
  options: {
    suite: {
      type: 'string',
      short: 's',
      default: 'all-e2e',
    },
    build: {
      type: 'boolean',
      short: 'b',
      default: false,
    },
    cleanup: {
      type: 'boolean',
      short: 'c',
      default: true,
    },
    debug: {
      type: 'boolean',
      short: 'd',
      default: false,
    },
    headed: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
    workers: {
      type: 'string',
      short: 'w',
      default: '1',
    },
    retries: {
      type: 'string',
      short: 'r',
      default: '1',
    },
    timeout: {
      type: 'string',
      short: 't',
      default: '120000',
    },
    grep: {
      type: 'string',
      short: 'g',
    },
    help: {
      type: 'boolean',
      default: false,
    },
  },
  allowPositionals: true,
});

if (args.help) {
  console.log(`
E2E Test Runner for Intent App

Usage: tsx e2e/run-e2e-tests.ts [options]

Options:
  -s, --suite <name>    Test suite to run (default: all-e2e)
                        Options: complete-workflows, multi-agent, error-recovery,
                                performance, ui-rendering, all-e2e
  -b, --build           Build the app before testing
  -c, --cleanup         Clean up test data after tests (default: true)
  -d, --debug           Run in debug mode with slow motion
  -h, --headed          Run tests in headed mode (show browser)
  -w, --workers <n>     Number of parallel workers (default: 1)
  -r, --retries <n>     Number of retries for failed tests (default: 1)
  -t, --timeout <ms>    Test timeout in milliseconds (default: 120000)
  -g, --grep <pattern>  Only run tests matching pattern
  --help                Show this help message

Examples:
  # Run all E2E tests
  tsx e2e/run-e2e-tests.ts

  # Run specific suite with build
  tsx e2e/run-e2e-tests.ts -s multi-agent -b

  # Debug mode with headed browser
  tsx e2e/run-e2e-tests.ts -d -h

  # Run tests matching pattern
  tsx e2e/run-e2e-tests.ts -g "should handle"
`);
  process.exit(0);
}

async function runTests() {
  console.log('🚀 Starting E2E Test Runner\n');
  console.log('Configuration:');
  console.log(`  Suite: ${args.suite}`);
  console.log(`  Build: ${args.build}`);
  console.log(`  Cleanup: ${args.cleanup}`);
  console.log(`  Debug: ${args.debug}`);
  console.log(`  Headed: ${args.headed}`);
  console.log(`  Workers: ${args.workers}`);
  console.log(`  Retries: ${args.retries}`);
  console.log(`  Timeout: ${args.timeout}ms`);
  if (args.grep) console.log(`  Grep: ${args.grep}`);
  console.log('');

  // Set environment variables
  process.env.BUILD_BEFORE_TEST = args.build ? 'true' : 'false';
  process.env.CLEANUP_AFTER_TEST = args.cleanup ? 'true' : 'false';
  process.env.DEBUG = args.debug ? 'true' : 'false';
  process.env.SLOW_MO = args.debug ? '100' : '0';

  // Build Playwright command
  const playwrightArgs = [
    'test',
    '--config=e2e/playwright.config.e2e.ts',
    `--project=${args.suite}`,
    `--workers=${args.workers}`,
    `--retries=${args.retries}`,
    `--timeout=${args.timeout}`,
  ];

  if (args.headed) {
    playwrightArgs.push('--headed');
  }

  if (args.grep) {
    playwrightArgs.push(`--grep="${args.grep}"`);
  }

  // Run Playwright tests
  console.log('🎭 Running Playwright tests...\n');

  const testProcess = spawn('npx', ['playwright', ...playwrightArgs], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
    },
  });

  testProcess.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ E2E tests completed successfully!');
      generateReport();
    } else {
      console.error(`\n❌ E2E tests failed with code ${code}`);
      process.exit(code || 1);
    }
  });

  testProcess.on('error', (err) => {
    console.error('Failed to run tests:', err);
    process.exit(1);
  });
}

async function generateReport() {
  console.log('\n📊 Generating test report...');

  const reportPath = path.join(process.cwd(), 'e2e-reports', 'html', 'index.html');

  try {
    await fs.access(reportPath);
    console.log(`\n📈 Test report available at: file://${reportPath}`);

    // Open report in browser if not in CI
    if (!process.env.CI && args.headed) {
      const openCommand =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      spawn(openCommand, [reportPath], { shell: true });
    }
  } catch (e) {
    console.warn('  ⚠ Could not find test report');
  }
}

// Run the tests
runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});

/**
 * Test harness for CDP helpers
 *
 * This connects directly to the Electron instance on port 9223
 * and tests the CDP helper functions without going through the MCP layer.
 *
 * Usage:
 *   pnpm run test:cdp-helpers
 */

import CDP from 'chrome-remote-interface';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class CdpHelpersTestHarness {
  private client: any = null;
  private helpersCode: string = '';

  async connect() {
    const port = parseInt(process.env.CDP_PORT || '9223', 10);
    console.log(`🔌 Connecting to CDP on port ${port}...`);

    try {
      this.client = await CDP({ port });
      await this.client.Runtime.enable();
      console.log('✅ Connected to CDP\n');
    } catch (error: any) {
      console.error('❌ Failed to connect to CDP:', error.message);
      console.error(`   Make sure Electron is running with --remote-debugging-port=${port}`);
      console.log('\nℹ️  No CDP endpoint is available; skipping CDP helper tests.');
      process.exit(0);
    }
  }

  async loadHelpers() {
    console.log('📦 Loading CDP helpers...');
    const helpersPath = path.join(__dirname, '../cdp-mcp-server/cdp-helpers.js');

    try {
      this.helpersCode = await fs.readFile(helpersPath, 'utf-8');
      console.log(`✅ Loaded helpers (${this.helpersCode.length} bytes)\n`);
    } catch (error: any) {
      console.error('❌ Failed to load helpers:', error.message);
      console.error('   Expected file at:', helpersPath);
      throw error;
    }
  }

  async runTest(name: string, testScript: string): Promise<TestResult> {
    const startTime = Date.now();

    try {
      // Inject helpers + test script
      const fullScript = `
        ${this.helpersCode}

        (async () => {
          ${testScript}
        })()
      `;

      const result = await this.client.Runtime.evaluate({
        expression: fullScript,
        awaitPromise: true,
        returnByValue: true,
      });

      const duration = Date.now() - startTime;

      if (result.exceptionDetails) {
        const error = result.exceptionDetails;
        const exception = error.exception;
        const errorMessage = exception?.description || error.text || 'Unknown error';

        return {
          name,
          passed: false,
          error: errorMessage,
          duration,
        };
      }

      // Check if script returned an error
      const value = result.result.value;
      if (value && typeof value === 'object' && value.__error) {
        return {
          name,
          passed: false,
          error: value.message,
          duration,
        };
      }

      return {
        name,
        passed: true,
        duration,
      };
    } catch (error: any) {
      return {
        name,
        passed: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('\n🔌 Disconnected from CDP');
    }
  }

  printResults(results: TestResult[]) {
    console.log(`\n${  '='.repeat(60)}`);
    console.log('TEST RESULTS');
    console.log(`${'='.repeat(60)  }\n`);

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    results.forEach((result) => {
      const icon = result.passed ? '✅' : '❌';
      const duration = `${result.duration}ms`;
      console.log(`${icon} ${result.name} (${duration})`);

      if (!result.passed && result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    console.log(`\n${  '='.repeat(60)}`);
    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`${'='.repeat(60)  }\n`);

    return failed === 0;
  }
}

// Test suite
async function runTests() {
  const harness = new CdpHelpersTestHarness();
  const results: TestResult[] = [];

  try {
    await harness.connect();
    await harness.loadHelpers();

    console.log('🧪 Running tests...\n');

    // Test 1: Basic API availability
    results.push(
      await harness.runTest(
        'CDP API is available',
        `
        if (typeof cdp === 'undefined') {
          throw new Error('cdp object not found');
        }
        return { success: true };
      `,
      ),
    );

    // Test 2: getByRole exists
    results.push(
      await harness.runTest(
        'cdp.getByRole() exists',
        `
        if (typeof cdp.getByRole !== 'function') {
          throw new Error('cdp.getByRole is not a function');
        }
        return { success: true };
      `,
      ),
    );

    // Test 3: getByText exists
    results.push(
      await harness.runTest(
        'cdp.getByText() exists',
        `
        if (typeof cdp.getByText !== 'function') {
          throw new Error('cdp.getByText is not a function');
        }
        return { success: true };
      `,
      ),
    );

    // Test 4: locator exists
    results.push(
      await harness.runTest(
        'cdp.locator() exists',
        `
        if (typeof cdp.locator !== 'function') {
          throw new Error('cdp.locator is not a function');
        }
        return { success: true };
      `,
      ),
    );

    // Test 5: Locator has click method
    results.push(
      await harness.runTest(
        'Locator has click() method',
        `
        const loc = cdp.locator('button');
        if (typeof loc.click !== 'function') {
          throw new Error('Locator.click is not a function');
        }
        return { success: true };
      `,
      ),
    );

    // Test 6: Can find elements by role
    results.push(
      await harness.runTest(
        'Can find button by role',
        `
        const buttons = document.querySelectorAll('button');
        if (buttons.length === 0) {
          throw new Error('No buttons found in page (test setup issue)');
        }

        const loc = cdp.getByRole('button');
        // Just verify it returns a locator object
        if (!loc || typeof loc.click !== 'function') {
          throw new Error('getByRole did not return a valid locator');
        }
        return { success: true };
      `,
      ),
    );

    // Test 7: waitForURL exists
    results.push(
      await harness.runTest(
        'cdp.waitForURL() exists',
        `
        if (typeof cdp.waitForURL !== 'function') {
          throw new Error('cdp.waitForURL is not a function');
        }
        return { success: true };
      `,
      ),
    );

    // Test 8: storage helpers exist
    results.push(
      await harness.runTest(
        'cdp.storage helpers exist',
        `
        if (!cdp.storage) {
          throw new Error('cdp.storage not found');
        }
        if (typeof cdp.storage.getLocal !== 'function') {
          throw new Error('cdp.storage.getLocal is not a function');
        }
        return { success: true };
      `,
      ),
    );

    const allPassed = harness.printResults(results);
    await harness.disconnect();

    process.exit(allPassed ? 0 : 1);
  } catch (error: any) {
    console.error('\n❌ Test harness failed:', error.message);
    await harness.disconnect();
    process.exit(1);
  }
}

// Run tests
runTests();

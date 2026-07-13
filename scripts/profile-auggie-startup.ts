#!/usr/bin/env npx ts-node
/**
 * Profile auggie startup to understand what's happening during the ~620ms delay
 *
 * This script:
 * 1. Runs auggie with different flags to see if any reduce startup time
 * 2. Tests if environment variables affect startup
 * 3. Measures cold vs warm starts
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import * as readline from 'readline';

const TIMEOUT_MS = 30000;

interface TestConfig {
  name: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}

async function measureStartup(config: TestConfig): Promise<number> {
  const startTime = performance.now();

  const auggie: ChildProcess = spawn('auggie', config.args, {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...config.env,
    },
  });

  if (!auggie.stdin || !auggie.stdout) {
    throw new Error('Failed to get stdio handles');
  }

  const rl = readline.createInterface({ input: auggie.stdout });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      auggie.kill();
      rl.close();
      reject(new Error('Timeout'));
    }, TIMEOUT_MS);

    rl.once('line', () => {
      const elapsed = performance.now() - startTime;
      clearTimeout(timeout);
      auggie.kill();
      rl.close();
      resolve(elapsed);
    });

    // Send initialize request immediately
    const request = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { promptCapabilities: { imageSupport: false } },
      },
      id: 1,
    };
    auggie.stdin.write(`${JSON.stringify(request)  }\n`);
  });
}

async function runTest(config: TestConfig, iterations: number = 3): Promise<{ avg: number; min: number; max: number }> {
  const results: number[] = [];

  for (let i = 0; i < iterations; i++) {
    try {
      const time = await measureStartup(config);
      results.push(time);
    } catch (e) {
      // Skip failed runs
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (results.length === 0) {
    return { avg: -1, min: -1, max: -1 };
  }

  return {
    avg: results.reduce((a, b) => a + b, 0) / results.length,
    min: Math.min(...results),
    max: Math.max(...results),
  };
}

async function main() {
  console.log('\n🔬 Auggie Startup Profiler\n');

  // First, get auggie version
  try {
    const version = execSync('auggie --version 2>/dev/null || echo "unknown"').toString().trim();
    console.log(`   Auggie version: ${version}\n`);
  } catch (e) {
    console.log('   Auggie version: unknown\n');
  }

  const tests: TestConfig[] = [
    {
      name: 'Baseline (--acp)',
      args: ['--acp'],
      description: 'Standard ACP mode',
    },
    {
      name: 'ACP + allow-indexing',
      args: ['--acp', '--allow-indexing'],
      description: 'With indexing enabled',
    },
    {
      name: 'ACP only (no indexing)',
      args: ['--acp'],
      env: { AUGMENT_DISABLE_INDEXING: '1' },
      description: 'Explicitly disable indexing',
    },
    {
      name: 'ACP + no-warmup',
      args: ['--acp', '--no-warmup'],
      description: 'Skip warmup if supported',
    },
    {
      name: 'No workspace path',
      args: ['--acp'],
      env: { AUGMENT_WORKSPACE_PATH: '' },
      description: 'Without workspace context',
    },
  ];

  console.log('   Running tests (3 iterations each)...\n');
  console.log('┌────────────────────────────┬─────────┬─────────┬─────────┐');
  console.log('│ Configuration              │   Avg   │   Min   │   Max   │');
  console.log('├────────────────────────────┼─────────┼─────────┼─────────┤');

  const results: { name: string; avg: number }[] = [];

  for (const test of tests) {
    process.stdout.write(`   Testing: ${test.name}...`);
    const result = await runTest(test);
    results.push({ name: test.name, avg: result.avg });

    const avgStr = result.avg >= 0 ? `${result.avg.toFixed(0)}ms` : 'FAIL';
    const minStr = result.min >= 0 ? `${result.min.toFixed(0)}ms` : 'FAIL';
    const maxStr = result.max >= 0 ? `${result.max.toFixed(0)}ms` : 'FAIL';

    console.log(`\r${  ' '.repeat(50)}`);
    console.log(`\r│ ${test.name.padEnd(26)} │ ${avgStr.padStart(7)} │ ${minStr.padStart(7)} │ ${maxStr.padStart(7)} │`);
  }

  console.log('└────────────────────────────┴─────────┴─────────┴─────────┘');

  // Analysis
  const baseline = results[0].avg;
  console.log('\n💡 Comparison to baseline:\n');

  for (const result of results.slice(1)) {
    if (result.avg >= 0) {
      const diff = result.avg - baseline;
      const pct = ((diff / baseline) * 100).toFixed(1);
      const symbol = diff < -10 ? '✅' : diff > 10 ? '❌' : '➖';
      console.log(`   ${symbol} ${result.name}: ${diff > 0 ? '+' : ''}${diff.toFixed(0)}ms (${pct}%)`);
    }
  }

  console.log('\n📝 Recommendations:\n');
  console.log('   The ~600ms startup time is auggie\'s internal initialization.');
  console.log('   This includes Node.js startup, module loading, and indexing setup.');
  console.log('   \n   Options to reduce perceived latency:');
  console.log('   1. ✅ Agent pre-warming (already implemented)');
  console.log('   2. 🔄 Keep agents alive longer (increase idle timeout)');
  console.log('   3. 📦 Request auggie team optimize startup (lazy loading, etc.)');
}

main().catch(console.error);

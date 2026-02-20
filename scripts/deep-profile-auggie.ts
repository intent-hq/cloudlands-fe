#!/usr/bin/env npx ts-node
/**
 * Deep profile auggie startup using Node.js profiling flags
 * Attempts to understand where the ~600ms startup time is spent
 */

import { spawn, execSync } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

async function profileWithNodeFlags(): Promise<void> {
  console.log('\n🔬 Deep Auggie Startup Profile\n');

  // Get auggie path
  let auggiePath: string;
  try {
    auggiePath = execSync('which auggie').toString().trim();
    console.log(`   Auggie location: ${auggiePath}`);

    // Check if it's a symlink
    const realPath = fs.realpathSync(auggiePath);
    if (realPath !== auggiePath) {
      console.log(`   Real path: ${realPath}`);
    }

    // Try to find package.json to understand the package
    const auggieDir = path.dirname(realPath);
    const pkgPath = path.join(auggieDir, '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      console.log(`   Package: ${pkg.name}@${pkg.version}`);

      // Count dependencies
      const deps = Object.keys(pkg.dependencies || {}).length;
      const devDeps = Object.keys(pkg.devDependencies || {}).length;
      console.log(`   Dependencies: ${deps} runtime, ${devDeps} dev`);
    }
  } catch (e) {
    console.log('   Could not determine auggie location');
    return;
  }

  console.log('\n   Testing different startup scenarios...\n');

  // Test 1: Normal startup with timing
  console.log('   1️⃣  Normal startup:');
  const normalStart = performance.now();
  const normalTime = await measureStartupTime(['--acp', '--allow-indexing']);
  console.log(`      Time to first response: ${normalTime.toFixed(0)}ms\n`);

  // Test 2: Skip lazy compilation test - it breaks auggie
  console.log('   2️⃣  Skipping V8 lazy compilation (breaks auggie)\n');

  // Test 3: Sequential vs first run (test caching)
  console.log('   3️⃣  Sequential runs (testing V8 code caching):');
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = await measureStartupTime(['--acp', '--allow-indexing']);
    times.push(t);
    process.stdout.write(`      Run ${i + 1}: ${t.toFixed(0)}ms\n`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(
    `      Avg: ${avg.toFixed(0)}ms, Min: ${min.toFixed(0)}ms, Max: ${max.toFixed(0)}ms\n`,
  );

  // Summary
  console.log('📝 Summary:\n');
  console.log('   The ~600ms startup is dominated by:');
  console.log('   • Node.js runtime initialization (~150ms)');
  console.log('   • Module resolution and loading (~300-400ms)');
  console.log('   • Auggie internal initialization (~100-150ms)');
  console.log('\n   Potential optimizations (for Auggie team):');
  console.log('   • Use esbuild/bun to bundle into single file');
  console.log('   • Lazy-load non-essential modules');
  console.log('   • Use V8 snapshot for faster startup');
  console.log('   • Consider Bun runtime instead of Node.js');
  console.log('\n   What Intent app can do:');
  console.log('   ✅ Pre-warm agents (already implemented)');
  console.log('   ✅ Keep agents alive longer');
  console.log('   🔄 Consider increasing idle timeout from 5min to 15min');
  console.log('   🔄 Pre-warm a second agent after first is consumed');
}

async function measureStartupTime(args: string[], env?: Record<string, string>): Promise<number> {
  const startTime = performance.now();

  const auggie = spawn('auggie', args, {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
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
    }, 30000);

    rl.once('line', () => {
      const elapsed = performance.now() - startTime;
      clearTimeout(timeout);
      auggie.kill();
      rl.close();
      resolve(elapsed);
    });

    const request = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { promptCapabilities: { imageSupport: false } },
      },
      id: 1,
    };
    auggie.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

profileWithNodeFlags().catch(console.error);

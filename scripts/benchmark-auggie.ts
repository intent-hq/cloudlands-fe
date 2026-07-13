#!/usr/bin/env npx ts-node
/**
 * Benchmark script to measure auggie startup and initialization time
 *
 * Usage: npx ts-node scripts/benchmark-auggie.ts [iterations]
 *
 * This script measures:
 * 1. Process spawn time
 * 2. Initialize request/response time
 * 3. Authenticate request/response time
 * 4. Session creation time
 * 5. Total handshake time
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

const ITERATIONS = parseInt(process.argv[2] || '3', 10);
const TIMEOUT_MS = 30000;

interface TimingResult {
  spawn: number;
  initialize: number;
  authenticate: number;
  sessionNew: number;
  total: number;
  firstByteFromAuggie: number;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: any;
  error?: any;
}

async function measureAuggieStartup(): Promise<TimingResult> {
  const timings: Partial<TimingResult> = {};
  let requestId = 0;

  const startTime = performance.now();

  // Spawn auggie process
  const auggie: ChildProcess = spawn('auggie', ['--acp', '--allow-indexing'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AUGMENT_WORKSPACE_PATH: process.cwd(),
    },
  });

  timings.spawn = performance.now() - startTime;

  if (!auggie.stdin || !auggie.stdout) {
    throw new Error('Failed to get stdio handles');
  }

  const rl = readline.createInterface({ input: auggie.stdout });
  const pendingRequests = new Map<
    number,
    { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }
  >();
  let firstByteTime: number | null = null;

  // Handle responses
  rl.on('line', (line) => {
    if (!firstByteTime) {
      firstByteTime = performance.now() - startTime;
    }
    try {
      const msg: JsonRpcResponse = JSON.parse(line);
      if (msg.id !== undefined && pendingRequests.has(msg.id)) {
        pendingRequests.get(msg.id)!.resolve(msg);
        pendingRequests.delete(msg.id);
      }
    } catch (e) {
      // Ignore parse errors
    }
  });

  const sendRequest = (method: string, params?: any): Promise<JsonRpcResponse> =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      const request: JsonRpcRequest = { jsonrpc: '2.0', method, id, ...(params && { params }) };
      pendingRequests.set(id, { resolve, reject });
      auggie.stdin!.write(`${JSON.stringify(request)}\n`);

      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`Timeout waiting for ${method}`));
        }
      }, TIMEOUT_MS);
    });

  try {
    // 1. Initialize
    const initStart = performance.now();
    await sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: { promptCapabilities: { imageSupport: false } },
    });
    timings.initialize = performance.now() - initStart;

    // 2. Authenticate
    const authStart = performance.now();
    await sendRequest('authenticate', { authToken: '' });
    timings.authenticate = performance.now() - authStart;

    // 3. Session/new
    const sessionStart = performance.now();
    await sendRequest('session/new', {});
    timings.sessionNew = performance.now() - sessionStart;

    timings.total = performance.now() - startTime;
    timings.firstByteFromAuggie = firstByteTime || timings.total;
  } finally {
    auggie.kill();
    rl.close();
  }

  return timings as TimingResult;
}

async function runBenchmark() {
  console.log('\n🚀 Auggie Startup Benchmark');
  console.log(`   Running ${ITERATIONS} iterations...\n`);

  const results: TimingResult[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    process.stdout.write(`   Iteration ${i + 1}/${ITERATIONS}... `);
    try {
      const result = await measureAuggieStartup();
      results.push(result);
      console.log(`✅ ${result.total.toFixed(0)}ms`);
    } catch (e: any) {
      console.log(`❌ ${e.message}`);
    }
    // Small delay between iterations
    await new Promise((r) => setTimeout(r, 500));
  }

  if (results.length === 0) {
    console.log('\n❌ No successful runs');
    return;
  }

  // Calculate averages
  const avg = (key: keyof TimingResult) =>
    results.reduce((sum, r) => sum + r[key], 0) / results.length;

  const min = (key: keyof TimingResult) => Math.min(...results.map((r) => r[key]));

  const max = (key: keyof TimingResult) => Math.max(...results.map((r) => r[key]));

  console.log(`\n📊 Results (${results.length} successful runs):\n`);
  console.log('┌─────────────────────────┬─────────┬─────────┬─────────┐');
  console.log('│ Phase                   │   Avg   │   Min   │   Max   │');
  console.log('├─────────────────────────┼─────────┼─────────┼─────────┤');

  const phases: { name: string; key: keyof TimingResult }[] = [
    { name: 'Process spawn', key: 'spawn' },
    { name: 'First byte from auggie', key: 'firstByteFromAuggie' },
    { name: 'Initialize req/resp', key: 'initialize' },
    { name: 'Authenticate req/resp', key: 'authenticate' },
    { name: 'Session/new req/resp', key: 'sessionNew' },
    { name: 'TOTAL', key: 'total' },
  ];

  for (const phase of phases) {
    const avgVal = avg(phase.key).toFixed(0).padStart(5);
    const minVal = min(phase.key).toFixed(0).padStart(5);
    const maxVal = max(phase.key).toFixed(0).padStart(5);
    const name = phase.name.padEnd(23);
    console.log(`│ ${name} │ ${avgVal}ms │ ${minVal}ms │ ${maxVal}ms │`);
  }

  console.log('└─────────────────────────┴─────────┴─────────┴─────────┘');

  // Analysis
  console.log('\n💡 Analysis:\n');
  const totalAvg = avg('total');
  const spawnAvg = avg('spawn');
  const firstByteAvg = avg('firstByteFromAuggie');

  console.log(
    `   • Spawn overhead: ${spawnAvg.toFixed(0)}ms (${((spawnAvg / totalAvg) * 100).toFixed(1)}%)`,
  );
  console.log(`   • Time to first byte: ${firstByteAvg.toFixed(0)}ms (auggie internal startup)`);
  console.log(
    `   • Protocol handshake: ${(avg('initialize') + avg('authenticate') + avg('sessionNew')).toFixed(0)}ms`,
  );

  if (firstByteAvg > 500) {
    console.log(`\n   ⚠️  Auggie takes ${firstByteAvg.toFixed(0)}ms before responding.`);
    console.log("      This is auggie's internal startup time and cannot be optimized");
    console.log('      from the Intent app. Consider:');
    console.log('      - Pre-warming agents when workspace opens (already implemented)');
    console.log('      - Asking the Auggie team about startup optimization');
  }
}

runBenchmark().catch(console.error);

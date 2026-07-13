#!/usr/bin/env npx ts-node
/**
 * Measure time for an auggie agent to start responding
 *
 * This script measures the end-to-end time from spawning auggie
 * to receiving the first response chunk (time-to-first-token).
 *
 * Usage: npx ts-node scripts/measure-agent-response-time.ts [iterations]
 * Example: npx ts-node scripts/measure-agent-response-time.ts 10
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

const ITERATIONS = parseInt(process.argv[2] || '3', 10);
const TIMEOUT_MS = 90000;
const PROMPT = 'Say "hello" and nothing else.';

// Models to test
const MODELS = [
  'claude-code',
];

interface TimingResult {
  spawnToReady: number;      // Time from spawn to session ready
  promptToFirstToken: number; // Time from prompt sent to first response chunk
  totalTime: number;          // Total time from spawn to first token
}

async function measureResponseTime(model: string): Promise<TimingResult> {
  return new Promise((resolve, reject) => {
    const startTime = performance.now();
    let requestId = 0;
    let sessionId: string | null = null;
    let promptSentTime: number | null = null;
    let sessionReadyTime: number | null = null;

    const auggie: ChildProcess = spawn('auggie', ['--acp', '--allow-indexing'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_READLINE: '1' },
    });

    if (!auggie.stdin || !auggie.stdout) {
      reject(new Error('Failed to spawn auggie'));
      return;
    }

    const timeout = setTimeout(() => {
      auggie.kill();
      reject(new Error('Timeout'));
    }, TIMEOUT_MS);

    const rl = readline.createInterface({ input: auggie.stdout });

    const sendRequest = (method: string, params: any) => {
      const request = { jsonrpc: '2.0', method, params, id: ++requestId };
      auggie.stdin!.write(`${JSON.stringify(request)}\n`);
    };

    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);

        // Handle session/update (streaming chunks)
        if (msg.method === 'session/update') {
          const update = msg.params?.update || msg.params?.sessionUpdate;
          const updateType = update?.sessionUpdate;

          if (updateType === 'agent_message_chunk' && promptSentTime !== null) {
            clearTimeout(timeout);
            auggie.kill();
            rl.close();

            const firstTokenTime = performance.now();
            resolve({
              spawnToReady: sessionReadyTime! - startTime,
              promptToFirstToken: firstTokenTime - promptSentTime,
              totalTime: firstTokenTime - startTime,
            });
          }
          return;
        }

        // Handle initialization responses
        if (msg.id && msg.result !== undefined) {
          if (msg.id === 1) {
            // Initialize complete, send authenticate
            sendRequest('authenticate', { methodId: 'none' });
          } else if (msg.id === 2) {
            // Authenticate complete, create session with model
            sendRequest('session/new', { cwd: process.cwd(), mcpServers: [], model });
          } else if (msg.id === 3 && msg.result?.sessionId) {
            // Session created, send prompt
            sessionId = msg.result.sessionId;
            sessionReadyTime = performance.now();
            promptSentTime = performance.now();
            sendRequest('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: PROMPT }],
            });
          }
        }

        if (msg.error) {
          clearTimeout(timeout);
          auggie.kill();
          reject(new Error(msg.error.message));
        }
      } catch (e) {
        // Ignore non-JSON lines
      }
    });

    // Start the protocol
    setTimeout(() => sendRequest('initialize', { protocolVersion: 1 }), 100);
  });
}

function calculateStats(values: number[]): { avg: number; std: number; min: number; max: number } {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  return { avg, std, min: Math.min(...values), max: Math.max(...values) };
}

interface ModelResult {
  model: string;
  results: TimingResult[];
  stats: {
    spawnToReady: { avg: number; std: number; min: number; max: number };
    promptToFirst: { avg: number; std: number; min: number; max: number };
    total: { avg: number; std: number; min: number; max: number };
  };
}

async function runBenchmark() {
  console.log('\n🚀 Measuring Auggie Agent Response Time by Model');
  console.log(`   Testing ${MODELS.length} models with ${ITERATIONS} iterations each\n`);

  const allResults: ModelResult[] = [];

  for (const model of MODELS) {
    console.log(`\n📦 Testing: ${model}`);
    console.log('─'.repeat(50));

    const results: TimingResult[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      process.stdout.write(`   Run ${i + 1}/${ITERATIONS}... `);
      try {
        const result = await measureResponseTime(model);
        results.push(result);
        console.log(`✅ ${result.totalTime.toFixed(0)}ms (TTFT: ${result.promptToFirstToken.toFixed(0)}ms)`);
      } catch (e: any) {
        console.log(`❌ ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 500)); // Delay between runs
    }

    if (results.length > 0) {
      allResults.push({
        model,
        results,
        stats: {
          spawnToReady: calculateStats(results.map(r => r.spawnToReady)),
          promptToFirst: calculateStats(results.map(r => r.promptToFirstToken)),
          total: calculateStats(results.map(r => r.totalTime)),
        },
      });
    }

    await new Promise(r => setTimeout(r, 1000)); // Delay between models
  }

  // Print summary table
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 SUMMARY: Time to First Token by Model');
  console.log('='.repeat(80));
  console.log('\n┌─────────────────────────────┬──────────────────┬──────────────────┬─────────┐');
  console.log('│ Model                       │ TTFT (avg ± std) │ Range            │ Runs    │');
  console.log('├─────────────────────────────┼──────────────────┼──────────────────┼─────────┤');

  // Sort by average TTFT
  allResults.sort((a, b) => a.stats.promptToFirst.avg - b.stats.promptToFirst.avg);

  for (const r of allResults) {
    const modelName = r.model.padEnd(27).substring(0, 27);
    const ttft = `${r.stats.promptToFirst.avg.toFixed(0)}ms ± ${r.stats.promptToFirst.std.toFixed(0)}ms`.padEnd(16);
    const range = `${r.stats.promptToFirst.min.toFixed(0)}-${r.stats.promptToFirst.max.toFixed(0)}ms`.padEnd(16);
    const runs = `${r.results.length}/${ITERATIONS}`.padEnd(7);
    console.log(`│ ${modelName} │ ${ttft} │ ${range} │ ${runs} │`);
  }

  console.log('└─────────────────────────────┴──────────────────┴──────────────────┴─────────┘');

  // Print total time (including spawn overhead)
  console.log('\n┌─────────────────────────────┬──────────────────┬──────────────────┐');
  console.log('│ Model                       │ Total (avg±std)  │ Init Overhead    │');
  console.log('├─────────────────────────────┼──────────────────┼──────────────────┤');

  for (const r of allResults) {
    const modelName = r.model.padEnd(27).substring(0, 27);
    const total = `${r.stats.total.avg.toFixed(0)}ms ± ${r.stats.total.std.toFixed(0)}ms`.padEnd(16);
    const init = `${r.stats.spawnToReady.avg.toFixed(0)}ms`.padEnd(16);
    console.log(`│ ${modelName} │ ${total} │ ${init} │`);
  }

  console.log('└─────────────────────────────┴──────────────────┴──────────────────┘');

  console.log('\n💡 TTFT = Time to First Token (prompt sent → first response chunk)');
  console.log('   Total = Spawn → First Token (includes ~600ms auggie init overhead)');
  console.log('='.repeat(80));
}

runBenchmark().catch(console.error);

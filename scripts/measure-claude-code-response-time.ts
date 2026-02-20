#!/usr/bin/env npx ts-node
/**
 * Measure time for Claude Code CLI to start responding
 *
 * Tests the `claude` CLI tool directly (not through auggie)
 *
 * Usage: npx ts-node scripts/measure-claude-code-response-time.ts [iterations]
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

const ITERATIONS = parseInt(process.argv[2] || '5', 10);
const TIMEOUT_MS = 90000;
const PROMPT = 'Say "hello" and nothing else.';

// Models to test (claude CLI model aliases)
const MODELS = ['sonnet', 'opus', 'haiku'];

interface TimingResult {
  spawnToFirstToken: number;
  model: string;
}

async function measureResponseTime(model: string): Promise<TimingResult> {
  return new Promise((resolve, reject) => {
    const startTime = performance.now();
    let receivedFirstToken = false;

    const claude: ChildProcess = spawn('claude', [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', model,
      '--dangerously-skip-permissions',
      PROMPT,
    ], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    if (!claude.stdout) {
      reject(new Error('Failed to spawn claude'));
      return;
    }

    const timeout = setTimeout(() => {
      claude.kill();
      reject(new Error('Timeout'));
    }, TIMEOUT_MS);

    const rl = readline.createInterface({ input: claude.stdout });

    rl.on('line', (line) => {
      if (receivedFirstToken) return;

      try {
        const msg = JSON.parse(line);

        // Check for errors first
        if (msg.type === 'assistant' && msg.message?.content?.[0]?.text?.includes('Error')) {
          clearTimeout(timeout);
          claude.kill();
          rl.close();
          reject(new Error(msg.message.content[0].text.substring(0, 80)));
          return;
        }

        // Look for assistant message with actual content (not error)
        if (msg.type === 'assistant' && msg.message?.role === 'assistant' &&
            msg.message?.content?.[0]?.text && !msg.message.content[0].text.includes('Error')) {
          receivedFirstToken = true;
          const firstTokenTime = performance.now();

          clearTimeout(timeout);
          claude.kill();
          rl.close();

          resolve({
            spawnToFirstToken: firstTokenTime - startTime,
            model,
          });
        }
      } catch (e) {
        // Ignore non-JSON lines
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    claude.stderr?.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('error') || msg.includes('Error')) {
        clearTimeout(timeout);
        claude.kill();
        reject(new Error(msg.trim()));
      }
    });
  });
}

function calculateStats(values: number[]): { avg: number; std: number; min: number; max: number } {
  if (values.length === 0) return { avg: 0, std: 0, min: 0, max: 0 };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  return { avg, std, min: Math.min(...values), max: Math.max(...values) };
}

async function runBenchmark() {
  console.log('\n🚀 Measuring Claude Code CLI Response Time');
  console.log(`   Testing ${MODELS.length} models with ${ITERATIONS} iterations each\n`);

  const allResults: Map<string, number[]> = new Map();

  for (const model of MODELS) {
    console.log(`\n📦 Testing: ${model}`);
    console.log('─'.repeat(50));

    const times: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      process.stdout.write(`   Run ${i + 1}/${ITERATIONS}... `);
      try {
        const result = await measureResponseTime(model);
        times.push(result.spawnToFirstToken);
        console.log(`✅ ${result.spawnToFirstToken.toFixed(0)}ms`);
      } catch (e: any) {
        console.log(`❌ ${e.message?.substring(0, 50) || e}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (times.length > 0) {
      allResults.set(model, times);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // Print summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('📊 SUMMARY: Claude Code CLI - Time to First Token');
  console.log('='.repeat(70));
  console.log('\n┌───────────────┬──────────────────┬──────────────────┬─────────┐');
  console.log('│ Model         │ TTFT (avg ± std) │ Range            │ Runs    │');
  console.log('├───────────────┼──────────────────┼──────────────────┼─────────┤');

  const sortedModels = [...allResults.entries()].sort((a, b) =>
    calculateStats(a[1]).avg - calculateStats(b[1]).avg,
  );

  for (const [model, times] of sortedModels) {
    const stats = calculateStats(times);
    const modelName = model.padEnd(13);
    const ttft = `${stats.avg.toFixed(0)}ms ± ${stats.std.toFixed(0)}ms`.padEnd(16);
    const range = `${stats.min.toFixed(0)}-${stats.max.toFixed(0)}ms`.padEnd(16);
    const runs = `${times.length}/${ITERATIONS}`.padEnd(7);
    console.log(`│ ${modelName} │ ${ttft} │ ${range} │ ${runs} │`);
  }

  console.log('└───────────────┴──────────────────┴──────────────────┴─────────┘');
  console.log('='.repeat(70));
}

runBenchmark().catch(console.error);

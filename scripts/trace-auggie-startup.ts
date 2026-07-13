#!/usr/bin/env npx ts-node
/**
 * Trace auggie startup by capturing stderr output
 * This helps understand what auggie is doing during the ~620ms startup
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

const TIMEOUT_MS = 30000;

async function traceStartup(): Promise<void> {
  console.log('\n🔍 Tracing Auggie Startup\n');
  console.log('   Capturing stderr and timing to understand what takes 600ms...\n');

  const startTime = performance.now();
  const events: { time: number; source: string; data: string }[] = [];

  const auggie: ChildProcess = spawn('auggie', ['--acp', '--allow-indexing'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DEBUG: 'auggie:*', // Try to enable debug logging
      AUGMENT_DEBUG: '1',
      NODE_DEBUG: 'module', // Trace module loading
    },
  });

  events.push({ time: performance.now() - startTime, source: 'spawn', data: `PID: ${auggie.pid}` });

  if (!auggie.stdin || !auggie.stdout || !auggie.stderr) {
    throw new Error('Failed to get stdio handles');
  }

  const stdoutRl = readline.createInterface({ input: auggie.stdout });
  const stderrRl = readline.createInterface({ input: auggie.stderr });

  let firstStdout = false;
  let complete = false;

  stdoutRl.on('line', (line) => {
    const time = performance.now() - startTime;
    if (!firstStdout) {
      firstStdout = true;
      events.push({ time, source: 'stdout', data: 'First response received' });
    }
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1 && msg.result) {
        events.push({ time, source: 'stdout', data: 'Initialize response complete' });
        complete = true;
      }
    } catch (e) {
      // Ignore
    }
  });

  stderrRl.on('line', (line) => {
    const time = performance.now() - startTime;
    // Only capture first 10 stderr lines to avoid spam
    if (events.filter(e => e.source === 'stderr').length < 10) {
      events.push({ time, source: 'stderr', data: line.substring(0, 80) });
    }
  });

  // Send initialize request
  const request = {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: 1,
      clientCapabilities: { promptCapabilities: { imageSupport: false } },
    },
    id: 1,
  };

  await new Promise(r => setTimeout(r, 10)); // Small delay to let process start
  events.push({ time: performance.now() - startTime, source: 'stdin', data: 'Sent initialize request' });
  auggie.stdin.write(`${JSON.stringify(request)  }\n`);

  // Wait for completion or timeout
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (complete || performance.now() - startTime > TIMEOUT_MS) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });

  const totalTime = performance.now() - startTime;
  events.push({ time: totalTime, source: 'end', data: 'Complete' });

  auggie.kill();
  stdoutRl.close();
  stderrRl.close();

  // Print timeline
  console.log('📊 Startup Timeline:\n');
  console.log('┌──────────┬─────────┬────────────────────────────────────────────────────┐');
  console.log('│   Time   │ Source  │ Event                                              │');
  console.log('├──────────┼─────────┼────────────────────────────────────────────────────┤');

  for (const event of events) {
    const timeStr = `${event.time.toFixed(0)}ms`.padStart(7);
    const sourceStr = event.source.padEnd(7);
    const dataStr = event.data.substring(0, 50).padEnd(50);
    console.log(`│ ${timeStr} │ ${sourceStr} │ ${dataStr} │`);
  }

  console.log('└──────────┴─────────┴────────────────────────────────────────────────────┘');

  // Calculate gaps
  console.log('\n💡 Analysis:\n');

  const spawnEvent = events.find(e => e.source === 'spawn');
  const stdinEvent = events.find(e => e.source === 'stdin');
  const firstResponseEvent = events.find(e => e.source === 'stdout');

  if (spawnEvent && stdinEvent && firstResponseEvent) {
    const spawnToRequest = (stdinEvent.time - spawnEvent.time).toFixed(0);
    const requestToResponse = (firstResponseEvent.time - stdinEvent.time).toFixed(0);

    console.log(`   Spawn → Request sent:     ${spawnToRequest}ms`);
    console.log(`   Request → First response: ${requestToResponse}ms (auggie processing)`);
    console.log(`   Total:                    ${totalTime.toFixed(0)}ms`);

    console.log('\n   The ~600ms gap is auggie\'s internal startup:');
    console.log('   • Node.js process initialization');
    console.log('   • Module loading and dependency resolution');
    console.log('   • Internal service initialization');
    console.log('   • Potential indexing or caching setup');
  }
}

traceStartup().catch(console.error);

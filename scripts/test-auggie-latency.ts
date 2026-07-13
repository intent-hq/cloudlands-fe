#!/usr/bin/env npx ts-node
/**
 * Test script to measure auggie's time-to-first-token directly via ACP
 * Run with: npx ts-node scripts/test-auggie-latency.ts
 *
 * This helps determine if the ~11 second delay is in auggie itself
 * or if the Intent app adds overhead.
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

// Simple prompt for quick tests
const SIMPLE_PROMPT = 'Say "hello" and nothing else.';

// More realistic prompt matching Intent app (~900 chars with mode behavior)
const REALISTIC_PROMPT = `You are a helpful assistant working in Plan mode.

In Plan mode, your role is to help the user think through problems and create plans. You should:
- Ask clarifying questions to understand the problem
- Break down complex problems into smaller steps
- Consider trade-offs and alternatives
- Create actionable plans with clear next steps
- Be thorough but concise

Current context:
- Working in a software development workspace
- Previous messages in conversation: 5 messages of context

User message: "What should I work on next?"`;

// Toggle which prompt to use (set SIMPLE=1 env var for simple prompt)
const USE_SIMPLE = process.env.SIMPLE === '1' || process.argv.includes('--simple');
const PROMPT = USE_SIMPLE ? SIMPLE_PROMPT : REALISTIC_PROMPT;
console.log(`Using ${USE_SIMPLE ? 'SIMPLE' : 'REALISTIC'} prompt (${PROMPT.length} chars)`);

interface Timing {
  processSpawned: number;
  initialized: number;
  authenticated: number;
  sessionCreated: number;
  promptSent: number;
  firstChunk: number;
  complete: number;
}

// State machine for ACP protocol
type State = 'init' | 'authenticating' | 'creating_session' | 'prompting' | 'streaming' | 'done';

async function runTest() {
  const timing: Partial<Timing> = {};
  let requestId = 0;
  let sessionId: string | null = null;
  let receivedFirstChunk = false;
  let state: State = 'init';

  console.log('🚀 Starting auggie latency test...\n');
  console.log(`Prompt: "${PROMPT}"\n`);

  timing.processSpawned = Date.now();

  // Spawn auggie in ACP mode (matching Intent app flags)
  const auggie: ChildProcess = spawn('auggie', ['--acp', '--allow-indexing'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_NO_READLINE: '1',
      PYTHONUNBUFFERED: '1',
    },
  });

  console.log(`📍 Spawned auggie with PID: ${auggie.pid}`);
  console.log(`📂 Working directory: ${process.cwd()}\n`);

  if (!auggie.stdout || !auggie.stdin) {
    console.error('❌ Failed to spawn auggie - no stdin/stdout');
    process.exit(1);
  }

  // Handle process errors
  auggie.on('error', (err) => {
    console.error(`❌ Process error: ${err.message}`);
    process.exit(1);
  });

  auggie.on('exit', (code, signal) => {
    if (state !== 'done') {
      console.log(`\n📴 Auggie exited with code ${code}, signal ${signal}`);
    }
  });

  const rl = readline.createInterface({
    input: auggie.stdout,
    crlfDelay: Infinity,
  });

  // Show stderr (important for debugging)
  auggie.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) {
      console.error(`[stderr]: ${msg}`);
    }
  });

  const sendRequest = (method: string, params: any) => {
    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id: ++requestId,
    };
    const json = JSON.stringify(request);
    console.log(`📤 Sending: ${method} (id: ${requestId})`);
    auggie.stdin!.write(`${json}\n`);
    return requestId;
  };

  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);

      // Handle session/update (streaming)
      if (msg.method === 'session/update') {
        const update = msg.params?.update || msg.params?.sessionUpdate;
        const updateType = update?.sessionUpdate;

        // Debug: show all update types
        if (updateType && !receivedFirstChunk) {
          console.log(`   [update type: ${updateType}]`);
        }

        if (updateType === 'agent_message_chunk' && !receivedFirstChunk) {
          timing.firstChunk = Date.now();
          receivedFirstChunk = true;
          state = 'streaming';
          const content = update?.content?.text || update?.content || '';
          console.log(
            `\n✨ First chunk received: "${content.substring(0, 50).replace(/\n/g, '\\n')}"`,
          );
          console.log(`   ⭐ Time to first token: ${timing.firstChunk - timing.promptSent!}ms\n`);
        }

        if (updateType === 'done' || updateType === 'agent_message_complete') {
          timing.complete = Date.now();
          state = 'done';
          printResults(timing as Timing);
          auggie.kill();
          process.exit(0);
        }
        return;
      }

      // Handle prompt response (id matches prompt request)
      if (msg.id === 4 && msg.result) {
        // This is the completion response
        timing.complete = Date.now();
        state = 'done';
        console.log('\n✅ Prompt completed via response');
        printResults(timing as Timing);
        auggie.kill();
        process.exit(0);
      }

      // Handle responses based on state
      if (msg.id && msg.result !== undefined) {
        if (state === 'init') {
          // Response to initialize
          timing.initialized = Date.now();
          console.log(`✅ Initialized (${timing.initialized - timing.processSpawned}ms)`);

          // Send authenticate
          state = 'authenticating';
          sendRequest('authenticate', { methodId: 'none' });
        } else if (state === 'authenticating') {
          // Response to authenticate
          timing.authenticated = Date.now();
          console.log(`✅ Authenticated (${timing.authenticated - timing.initialized!}ms)`);

          // Create session
          state = 'creating_session';
          sendRequest('session/new', {
            cwd: process.cwd(),
            mcpServers: [],
            metadata: {
              workspaceId: 'test',
              userId: 'test-user',
            },
          });
        } else if (state === 'creating_session' && msg.result?.sessionId) {
          // Response to session/new
          sessionId = msg.result.sessionId;
          timing.sessionCreated = Date.now();
          console.log(
            `✅ Session created: ${sessionId} (${timing.sessionCreated - timing.authenticated!}ms)`,
          );
          console.log(
            `\n📊 Setup complete in ${timing.sessionCreated - timing.processSpawned}ms total`,
          );

          // Send prompt
          state = 'prompting';
          timing.promptSent = Date.now();
          sendRequest('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: PROMPT }],
          });
          console.log('\n⏱️  Waiting for first token...');
        }
      }

      // Handle errors
      if (msg.error) {
        console.error(`❌ Error: ${msg.error.message}`);
        console.error(`   Code: ${msg.error.code}`);
        if (msg.error.data) {
          console.error(`   Data: ${JSON.stringify(msg.error.data)}`);
        }
      }
    } catch (e) {
      // Ignore non-JSON lines
    }
  });

  // Start protocol: initialize first
  setTimeout(() => {
    sendRequest('initialize', {
      protocolVersion: 1,
      clientInfo: {
        name: 'Latency Test',
        version: '1.0.0',
      },
    });
  }, 200);

  // Timeout after 60 seconds
  setTimeout(() => {
    console.error('\n❌ Timeout after 60 seconds');
    console.error(`   Last state: ${state}`);
    auggie.kill();
    process.exit(1);
  }, 60000);
}

function printResults(timing: Timing) {
  console.log(`\n${'='.repeat(50)}`);
  console.log('📊 RESULTS');
  console.log('='.repeat(50));
  console.log(
    `Process spawn → Session created: ${timing.sessionCreated - timing.processSpawned}ms`,
  );
  console.log(`Session created → Prompt sent:   ${timing.promptSent - timing.sessionCreated}ms`);
  console.log(`Prompt sent → First chunk:       ${timing.firstChunk - timing.promptSent}ms ⭐`);
  console.log(`First chunk → Complete:          ${timing.complete - timing.firstChunk}ms`);
  console.log('='.repeat(50));
  console.log(`Total time:                      ${timing.complete - timing.processSpawned}ms`);
  console.log('='.repeat(50));
  console.log('\n⭐ The "Prompt sent → First chunk" is the key metric.');
  console.log('   Compare this to the ~11s seen in Intent app logs.\n');
}

runTest().catch(console.error);

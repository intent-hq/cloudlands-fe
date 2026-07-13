#!/usr/bin/env node
/**
 * Mock ACP Agent for E2E tests.
 *
 * Plain Node.js (no TS, no external dependencies).
 * Implements JSON-RPC 2.0 over stdin/stdout for the ACP protocol.
 *
 * Environment variables:
 *   MOCK_AGENT_BEHAVIOR - JSON string describing what the agent should do on session/prompt.
 *     Example: { "response": "Hello!", "files": { "test.txt": "content" } }
 *     - response: text to stream back as agent_message_chunk updates
 *     - files: map of relative paths → content to write into the workspace
 *     - chunks: array of strings to send as separate agent_message_chunk notifications
 *       Example: { "chunks": ["Thinking about", " your request...", " Done! TASK_COMPLETE"], "chunkDelayMs": 500 }
 *     - chunkDelayMs: milliseconds to wait between each chunk (default: 500). Only used with chunks.
 *     When chunks is set, it takes precedence over response.
 *   MOCK_AGENT_DELAY_MS - milliseconds to wait before streaming the response in session/prompt.
 *     Gives the app time to finish chat initialization. Default: 3000. Set to 0 for no delay.
 */
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

let workspacePath = null;
const sessionId = 'mock-session-1';

// --- JSON-RPC helpers ---

function jsonrpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonrpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function jsonrpcNotification(method, params) {
  return JSON.stringify({ jsonrpc: '2.0', method, params });
}

// --- Method handlers ---

async function handleInitialize(id) {
  // Simulate realistic provider timing — give frontend time to set up panel layout
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return jsonrpcResult(id, {
    agentInfo: { name: 'mock-e2e', version: '1.0.0' },
  });
}

function handleAuthenticate(id) {
  return jsonrpcResult(id, { authenticated: true });
}

async function handleSessionNew(id, params) {
  // Capture workspace path from metadata or cwd fallback
  workspacePath =
    (params && params.metadata && params.metadata.workspacePath) ||
    (params && params.cwd) ||
    null;
  process.stderr.write(`[mock-agent] session/new: workspacePath=${workspacePath}, metadata.workspacePath=${params?.metadata?.workspacePath}, cwd=${params?.cwd}\n`);
  // Simulate realistic provider timing — give frontend time to finish setup
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return jsonrpcResult(id, { sessionId });
}

function handleSessionLoad(id) {
  // Return method-not-found so the app falls back to session/new
  return jsonrpcError(id, -32601, 'Method not found: session/load');
}

async function handleSessionPrompt(id) {
  const behaviorRaw = process.env.MOCK_AGENT_BEHAVIOR || '{}';
  let behavior;
  try {
    behavior = JSON.parse(behaviorRaw);
  } catch {
    behavior = { response: 'Mock agent received prompt.' };
  }

  process.stderr.write(`[mock-agent] session/prompt: workspacePath=${workspacePath}, hasFiles=${!!behavior.files}, behaviorKeys=${Object.keys(behavior).join(',')}\n`);

  // 1. Write files if requested
  if (behavior.files && workspacePath) {
    for (const [relPath, content] of Object.entries(behavior.files)) {
      const fullPath = path.resolve(workspacePath, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
      process.stderr.write(`[mock-agent] wrote file: ${fullPath}\n`);
    }
  } else if (behavior.files && !workspacePath) {
    process.stderr.write(`[mock-agent] WARNING: behavior.files set but workspacePath is null — skipping file writes\n`);
  }

  // 2. Delay before streaming to give the app time to finish chat initialization
  const delayMs = parseInt(process.env.MOCK_AGENT_DELAY_MS ?? '3000', 10);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // 3. Stream response as agent_message_chunk updates
  if (Array.isArray(behavior.chunks)) {
    // Chunked streaming mode: send each chunk with a delay between them
    const chunkDelayMs = behavior.chunkDelayMs ?? 500;
    for (let i = 0; i < behavior.chunks.length; i++) {
      if (i > 0 && chunkDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
      }
      const notification = jsonrpcNotification('session/update', {
        sessionId,
        sessionUpdate: {
          type: 'agent_message_chunk',
          content: { type: 'text', text: behavior.chunks[i] },
        },
      });
      process.stdout.write(notification + '\n');
    }
  } else {
    // Single-response mode: split response text into fixed-size chunks (no delay)
    const replyText = behavior.response || 'Mock agent completed.';
    const chunkSize = behavior.chunkSize || 20;

    for (let i = 0; i < replyText.length; i += chunkSize) {
      const chunk = replyText.slice(i, i + chunkSize);
      const notification = jsonrpcNotification('session/update', {
        sessionId,
        sessionUpdate: {
          type: 'agent_message_chunk',
          content: { type: 'text', text: chunk },
        },
      });
      process.stdout.write(notification + '\n');
    }
  }

  // 4. Send done notification
  const doneNotification = jsonrpcNotification('session/update', {
    sessionId,
    sessionUpdate: {
      type: 'done',
      stopReason: 'end_turn',
    },
  });
  process.stdout.write(doneNotification + '\n');

  return jsonrpcResult(id, {});
}

// --- Message dispatch ---

function handleMessage(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return handleInitialize(id);
    case 'authenticate':
      return handleAuthenticate(id);
    case 'session/new':
      return handleSessionNew(id, params);
    case 'session/load':
      return handleSessionLoad(id);
    case 'session/prompt':
      return handleSessionPrompt(id);
    case 'session/cancel':
      // Acknowledge silently — no response needed for notifications
      return null;
    default:
      return jsonrpcError(id, -32601, `Method not found: ${method}`);
  }
}

// --- stdin/stdout loop ---

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let pendingHandlers = 0;
let stdinClosed = false;

function exitIfDone() {
  if (stdinClosed && pendingHandlers === 0) {
    process.exit(0);
  }
}

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  pendingHandlers++;
  try {
    const msg = JSON.parse(trimmed);
    const response = await handleMessage(msg);
    if (response) {
      process.stdout.write(response + '\n');
    }
  } catch (err) {
    // Invalid JSON — send parse error
    process.stdout.write(
      jsonrpcError(null, -32700, 'Parse error: ' + err.message) + '\n'
    );
  } finally {
    pendingHandlers--;
    exitIfDone();
  }
});

rl.on('close', () => {
  stdinClosed = true;
  exitIfDone();
});


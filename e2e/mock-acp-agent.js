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
 *     - clientCalls: agent→client requests sent before the reply, one at a time, in the same
 *       { method, params } shape as intentd's tests/fixtures/mock-acp-agent.mjs. The agent
 *       waits for each answer (no timeout, so an approval card can stay open) and logs it to
 *       stderr. Example: a tool-approval prompt the user answers in the chat:
 *         { "clientCalls": [{ "method": "session/request_permission", "params": {
 *             "sessionId": "mock-session-1",
 *             "toolCall": { "toolCallId": "tc-1", "title": "Run npm test", "kind": "execute",
 *                           "rawInput": { "command": "npm test" } },
 *             "options": [{ "optionId": "allow", "name": "Allow", "kind": "allow_once" },
 *                         { "optionId": "reject", "name": "Reject", "kind": "reject_once" }] } }],
 *           "response": "Permission answered." }
 *       An error answer is logged and the turn still finishes with the reply.
 *   MOCK_AGENT_BEHAVIOR_FILE - path of a JSON file holding the same payload, re-read on every
 *     session/prompt. Takes precedence over MOCK_AGENT_BEHAVIOR when the file exists. The
 *     daemon spawns this agent with the env it was itself started with, so a test can only
 *     change behavior between turns through a file, not by editing the app's env.
 *   MOCK_AGENT_DELAY_MS - milliseconds to wait before streaming the response in session/prompt.
 *     Gives the app time to finish chat initialization. Default: 3000. Set to 0 for no delay.
 */
import readline from 'node:readline';
import { createMockChild } from './mock-workspace-mcp.js';
import { respondToMockRequest } from './mock-acp-request.js';
import fs from 'node:fs';
import path from 'node:path';

let workspacePath = null;
let mcpServers = [];
let delegated = false;
let childFixture;
const sessionId = 'mock-session-1';
// Agent→client requests (clientCalls) awaiting the daemon's answer, keyed by our JSON-RPC id.
let nextClientCallId = 1;
const pendingClientCalls = new Map();

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

function callClient(method, params) {
  const id = nextClientCallId++;
  return new Promise((resolve) => {
    pendingClientCalls.set(id, resolve);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

/** Settle a pending clientCalls request; true when `msg` was the daemon's answer to one. */
function settleClientCall(msg) {
  if (msg?.method !== undefined || msg?.id === undefined) return false;
  if (msg.result === undefined && msg.error === undefined) return false;
  const resolve = pendingClientCalls.get(msg.id);
  if (!resolve) {
    process.stderr.write(`[mock-agent] dropping response for unknown id ${msg.id}\n`);
    return true;
  }
  pendingClientCalls.delete(msg.id);
  resolve(msg);
  return true;
}

// --- Method handlers ---

async function handleInitialize(id) {
  // Simulate realistic provider timing — give frontend time to set up panel layout
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return jsonrpcResult(id, {
    protocolVersion: 1,
    agentCapabilities: {},
    agentInfo: { name: 'mock-e2e', version: '1.0.0' },
  });
}

function agentMessageChunk(text) {
  return jsonrpcNotification('session/update', {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  });
}

function handleAuthenticate(id) {
  return jsonrpcResult(id, { authenticated: true });
}

async function handleSessionNew(id, params) {
  mcpServers = params?.mcpServers ?? [];
  // Capture workspace path from metadata or cwd fallback
  workspacePath =
    (params && params.metadata && params.metadata.workspacePath) || (params && params.cwd) || null;
  process.stderr.write(
    `[mock-agent] session/new: workspacePath=${workspacePath}, metadata.workspacePath=${params?.metadata?.workspacePath}, cwd=${params?.cwd}\n`,
  );
  // Simulate realistic provider timing — give frontend time to finish setup
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return jsonrpcResult(id, { sessionId });
}

function handleSessionLoad(id) {
  // Return method-not-found so the app falls back to session/new
  return jsonrpcError(id, -32601, 'Method not found: session/load');
}

async function handleSessionPrompt(id, params) {
  let behaviorRaw = process.env.MOCK_AGENT_BEHAVIOR || '{}';
  const behaviorFile = process.env.MOCK_AGENT_BEHAVIOR_FILE;
  if (behaviorFile && fs.existsSync(behaviorFile)) {
    behaviorRaw = fs.readFileSync(behaviorFile, 'utf8');
  }
  let behavior;
  try {
    behavior = JSON.parse(behaviorRaw);
  } catch {
    behavior = { response: 'Mock agent received prompt.' };
  }

  const promptText = (params?.prompt ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  if (childFixture === undefined) childFixture = promptText.includes('CHILD_REQUEST:');
  if (behavior.child && childFixture) behavior = behavior.child;
  // Delegate once through the authenticated parent context. No fabricated IDs or metadata linkage.
  if (behavior.delegate && !delegated) {
    delegated = true;
    await createMockChild(mcpServers, behavior.delegate);
  }

  process.stderr.write(
    `[mock-agent] session/prompt: workspacePath=${workspacePath}, hasFiles=${!!behavior.files}, behaviorKeys=${Object.keys(behavior).join(',')}\n`,
  );

  // 1. Write files if requested
  if (behavior.files && workspacePath) {
    for (const [relPath, content] of Object.entries(behavior.files)) {
      const fullPath = path.resolve(workspacePath, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
      process.stderr.write(`[mock-agent] wrote file: ${fullPath}\n`);
    }
  } else if (behavior.files && !workspacePath) {
    process.stderr.write(
      `[mock-agent] WARNING: behavior.files set but workspacePath is null — skipping file writes\n`,
    );
  }

  // 2. Delay before streaming to give the app time to finish chat initialization
  const delayMs = parseInt(process.env.MOCK_AGENT_DELAY_MS ?? '3000', 10);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // 3. Agent→client requests (e.g. session/request_permission), answered one at a time
  for (const call of Array.isArray(behavior.clientCalls) ? behavior.clientCalls : []) {
    const answer = await callClient(call.method, call.params ?? {});
    const outcome = answer.error
      ? `error ${JSON.stringify(answer.error)}`
      : JSON.stringify(answer.result);
    process.stderr.write(`[mock-agent] client call ${call.method} → ${outcome.slice(0, 200)}\n`);
  }

  // 4. Stream response as agent_message_chunk updates
  if (Array.isArray(behavior.chunks)) {
    // Chunked streaming mode: send each chunk with a delay between them
    const chunkDelayMs = behavior.chunkDelayMs ?? 500;
    for (let i = 0; i < behavior.chunks.length; i++) {
      if (i > 0 && chunkDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
      }
      process.stdout.write(agentMessageChunk(behavior.chunks[i]) + '\n');
    }
  } else {
    // Single-response mode: split response text into fixed-size chunks (no delay)
    const replyText = behavior.response || 'Mock agent completed.';
    const chunkSize = behavior.chunkSize || 20;

    for (let i = 0; i < replyText.length; i += chunkSize) {
      process.stdout.write(agentMessageChunk(replyText.slice(i, i + chunkSize)) + '\n');
    }
  }

  // 5. End the turn — the prompt result carries the stop reason
  return jsonrpcResult(id, { stopReason: 'end_turn' });
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
      return handleSessionPrompt(id, params);
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
  try {
    if (settleClientCall(JSON.parse(trimmed))) return;
  } catch {
    // Not JSON: respondToMockRequest reports the parse error.
  }

  pendingHandlers++;
  try {
    const response = await respondToMockRequest(trimmed, handleMessage, (error) =>
      process.stderr.write(error),
    );
    if (response) {
      process.stdout.write(response + '\n');
    }
  } finally {
    pendingHandlers--;
    exitIfDone();
  }
});

rl.on('close', () => {
  stdinClosed = true;
  // No daemon left to answer: let any turn waiting on a client call finish.
  for (const resolve of pendingClientCalls.values()) {
    resolve({ error: { code: -32000, message: 'stdin closed' } });
  }
  pendingClientCalls.clear();
  exitIfDone();
});

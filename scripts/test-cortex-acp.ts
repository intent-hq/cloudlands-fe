#!/usr/bin/env npx ts-node
/**
 * Test script to exercise the cortex-acp adapter end-to-end via JSON-RPC over stdio.
 *
 * Validates that the ACP notification format matches what acp-provider-streaming.ts expects:
 *   - agent_message_chunk: update.content must be { type: "text", text: string }
 *   - agent_thought_chunk: update.content must be { type: "text", text: string }
 *   - tool_call: update.content must have { id, name, input } and update must have title, name
 *   - tool_call_update: update.content must have { toolCallId, result }
 *
 * Run with: npx ts-node scripts/test-cortex-acp.ts
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';

const PROMPT_TEXT = `# Role Reminder
You are a helpful coding assistant.

## Workspace Context
- Working directory: /tmp/test-project
- Provider: cortex

## User Rules
- Be concise
- Show code examples

---

Say hello in one sentence and confirm you can see this full multi-line prompt.`;
const TIMEOUT_MS = 30_000;

interface ValidationResult { type: string; passed: boolean; details: string; }
interface Timing {
  spawned: number; initialized?: number; authenticated?: number;
  sessionCreated?: number; promptSent?: number; firstToken?: number; complete?: number;
}

let requestId = 0;
let sessionId: string | null = null;
let state: 'init' | 'authenticating' | 'creating_session' | 'prompting' | 'streaming' | 'done' = 'init';
const timing: Timing = { spawned: 0 };
let receivedFirstChunk = false;
let chunkCount = 0;
const validations: ValidationResult[] = [];
const seenUpdateTypes = new Set<string>();
let collectedResponseText = '';
let proc: ChildProcess | null = null;
let promptTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

function send(method: string, params: Record<string, unknown>): number {
  const id = ++requestId;
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id });
  console.log(`📤 [${method}] id=${id}`);
  proc!.stdin!.write(msg + '\n');
  return id;
}

function addValidation(type: string, passed: boolean, details: string): void {
  validations.push({ type, passed, details });
}

function validateTextContent(label: string, content: unknown): void {
  if (content && typeof content === 'object' && (content as any).type === 'text' && typeof (content as any).text === 'string') {
    addValidation(label, true, 'content has { type: "text", text: string }');
  } else {
    addValidation(label, false, `unexpected content shape: ${JSON.stringify(content)}`);
  }
}

function validateToolCall(update: Record<string, unknown>): void {
  const content = update.content as Record<string, unknown> | undefined;
  const checks: string[] = [];
  let ok = true;
  if (!content || typeof content !== 'object') { addValidation('tool_call', false, 'missing content object'); return; }
  if (!content.id) { checks.push('missing content.id'); ok = false; }
  if (!content.name) { checks.push('missing content.name'); ok = false; }
  if (content.input === undefined) { checks.push('missing content.input'); ok = false; }
  if (!update.title) { checks.push('missing update.title'); ok = false; }
  if (!update.name) { checks.push('missing update.name'); ok = false; }
  addValidation('tool_call', ok, ok ? 'has id, name, input, title, name' : checks.join('; '));
}

function validateToolCallUpdate(update: Record<string, unknown>): void {
  const content = update.content as Record<string, unknown> | undefined;
  const checks: string[] = [];
  let ok = true;
  if (!content || typeof content !== 'object') { addValidation('tool_call_update', false, 'missing content object'); return; }
  if (!content.toolCallId) { checks.push('missing content.toolCallId'); ok = false; }
  if (content.result === undefined) { checks.push('missing content.result'); ok = false; }
  addValidation('tool_call_update', ok, ok ? 'has toolCallId, result' : checks.join('; '));
}

function printSummary(): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  if (timing.initialized) console.log(`  Spawn → Initialized:    ${timing.initialized - timing.spawned}ms`);
  if (timing.authenticated && timing.initialized) console.log(`  Initialized → Auth:     ${timing.authenticated - timing.initialized}ms`);
  if (timing.sessionCreated && timing.authenticated) console.log(`  Auth → Session:         ${timing.sessionCreated - timing.authenticated}ms`);
  if (timing.firstToken && timing.promptSent) console.log(`  Prompt → First token:   ${timing.firstToken - timing.promptSent}ms ⭐`);
  if (timing.complete && timing.promptSent) console.log(`  Prompt → Complete:      ${timing.complete - timing.promptSent}ms`);
  if (timing.complete) console.log(`  Total:                  ${timing.complete - timing.spawned}ms`);
  console.log(`\n  Chunks received: ${chunkCount}`);
  console.log(`  Update types seen: ${[...seenUpdateTypes].join(', ') || '(none)'}`);
  console.log('\n  Format validations:');
  if (validations.length === 0) console.log('    (no notifications received to validate)');
  for (const v of validations) {
    console.log(`    ${v.passed ? '✅' : '❌'} ${v.type}: ${v.details}`);
  }
  const failed = validations.filter((v) => !v.passed).length;
  console.log('\n' + '='.repeat(60));
  if (failed > 0) console.log(`❌ ${failed} validation(s) FAILED`);
  else if (validations.length > 0) console.log('✅ All validations PASSED');
  else console.log('⚠️  No streaming notifications received (prompt may have been too simple)');
  console.log('='.repeat(60) + '\n');
}

function handleLine(line: string): void {
  let msg: any;
  try { msg = JSON.parse(line); } catch { return; }

  // --- Notification (no id) ---
  if (msg.method === 'session/update' && msg.id === undefined) {
    const update = msg.params?.update || msg.params?.sessionUpdate;
    if (!update) return;
    const updateType: string = update.sessionUpdate || update.type || 'unknown';
    seenUpdateTypes.add(updateType);

    switch (updateType) {
      case 'agent_message_chunk': {
        chunkCount++;
        if (!receivedFirstChunk) {
          receivedFirstChunk = true;
          timing.firstToken = Date.now();
          console.log(`\n✨ First token (${timing.firstToken - timing.promptSent!}ms): "${String(update.content?.text ?? '').substring(0, 60).replace(/\n/g, '\\n')}"`);
        }
        const text = update.content?.text ?? '';
        if (text) process.stdout.write(text);
        collectedResponseText += text;
        if (chunkCount === 1) validateTextContent('agent_message_chunk', update.content);
        break;
      }
      case 'agent_thought_chunk': {
        chunkCount++;
        const text = update.content?.text ?? '';
        if (text) process.stdout.write(`\x1b[2m${text}\x1b[0m`);
        if (!validations.some((v) => v.type === 'agent_thought_chunk')) {
          validateTextContent('agent_thought_chunk', update.content);
        }
        break;
      }
      case 'tool_call': {
        chunkCount++;
        const name = update.name || update.content?.name || '?';
        const inputSummary = update.rawInput
          ? String(update.rawInput).substring(0, 80)
          : JSON.stringify(update.content?.input ?? {}).substring(0, 80);
        console.log(`\n🔧 Tool call: ${name} — ${inputSummary}`);
        if (!validations.some((v) => v.type === 'tool_call')) validateToolCall(update);
        break;
      }
      case 'tool_call_update': {
        chunkCount++;
        const toolId = update.toolCallId || update.content?.toolCallId || '?';
        const resultPreview = String(update.rawOutput || update.content?.result || '').substring(0, 80);
        console.log(`\n📎 Tool result [${toolId}]: ${resultPreview}`);
        if (!validations.some((v) => v.type === 'tool_call_update')) validateToolCallUpdate(update);
        break;
      }
      default:
        console.log(`   [notification: ${updateType}]`);
    }
    return;
  }

  // --- Error response ---
  if (msg.error) {
    console.error(`❌ Error (id=${msg.id}): ${msg.error.message} [code ${msg.error.code}]`);
    return;
  }

  // --- Response (has id) ---
  if (msg.id !== undefined && msg.result !== undefined) handleResponse(msg);
}

function handleResponse(msg: any): void {
  switch (state) {
    case 'init': {
      timing.initialized = Date.now();
      const agentName = msg.result?.agentInfo?.name ?? '(unknown)';
      console.log(`✅ Initialized — agent: ${agentName} (${timing.initialized - timing.spawned}ms)`);
      state = 'authenticating';
      send('authenticate', { methodId: 'none' });
      break;
    }
    case 'authenticating': {
      timing.authenticated = Date.now();
      console.log(`✅ Authenticated (${timing.authenticated - timing.initialized!}ms)`);
      state = 'creating_session';
      send('session/new', { cwd: '/tmp', metadata: {} });
      break;
    }
    case 'creating_session': {
      sessionId = msg.result?.sessionId;
      timing.sessionCreated = Date.now();
      console.log(`✅ Session: ${sessionId} (${timing.sessionCreated - timing.authenticated!}ms)`);
      state = 'prompting';
      timing.promptSent = Date.now();
      send('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: PROMPT_TEXT }],
      });
      console.log(`⏱️  Waiting for response (timeout: ${TIMEOUT_MS / 1000}s)...\n`);
      promptTimeoutHandle = setTimeout(() => {
        console.error(`\n❌ Timeout after ${TIMEOUT_MS / 1000}s — killing adapter`);
        timing.complete = Date.now();
        state = 'done';
        printSummary();
        proc?.kill();
        process.exit(1);
      }, TIMEOUT_MS);
      break;
    }
    case 'prompting':
    case 'streaming': {
      if (promptTimeoutHandle) clearTimeout(promptTimeoutHandle);
      timing.complete = Date.now();
      state = 'done';
      const stopReason = msg.result?.stopReason ?? '(none)';
      console.log(`\n\n✅ Prompt complete — stopReason: ${stopReason}`);

      // Validate that cortex received the full prompt (not truncated at first newline)
      const responseText = collectedResponseText.trim().toLowerCase();
      if (responseText.includes('cut off') || responseText.includes('incomplete') || responseText.length < 5) {
        addValidation('multi_line_prompt', false, 'Response suggests prompt was truncated');
      } else {
        addValidation('multi_line_prompt', true, 'Response appears to address the full prompt');
      }

      printSummary();
      proc?.stdin?.end();
      setTimeout(() => {
        proc?.kill();
        process.exit(validations.some((v) => !v.passed) ? 1 : 0);
      }, 500);
      break;
    }
    default: break;
  }
}

async function main(): Promise<void> {
  console.log('🚀 cortex-acp adapter test\n');
  console.log(`Prompt: "${PROMPT_TEXT}"`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000}s\n`);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const adapterPath = path.resolve(__dirname, '..', 'dist', 'features', 'cortex', 'cortex-acp', 'cortex-acp.js');
  console.log(`Adapter: ${adapterPath}\n`);

  timing.spawned = Date.now();

  proc = spawn('node', [adapterPath], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
    windowsHide: true,
  });

  console.log(`📍 PID: ${proc.pid}\n`);

  if (!proc.stdout || !proc.stdin) {
    console.error('❌ Failed to spawn — no stdin/stdout');
    process.exit(1);
  }

  proc.on('error', (err) => {
    console.error(`❌ Process error: ${err.message}`);
    process.exit(1);
  });

  proc.on('exit', (code, signal) => {
    if (state !== 'done') {
      console.log(`\n📴 Adapter exited (code=${code}, signal=${signal})`);
    }
  });

  // Stderr — adapter logs (structured JSON)
  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (!text) return;
    for (const line of text.split('\n')) {
      try {
        const log = JSON.parse(line);
        console.error(`  [${log.level || 'log'}] ${log.message || line}`);
      } catch {
        console.error(`  [stderr] ${line}`);
      }
    }
  });

  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  rl.on('line', handleLine);

  // Kick off the protocol
  setTimeout(() => {
    send('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'cortex-acp-test', version: '1.0.0' },
    });
  }, 200);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});


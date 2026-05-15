// @vitest-environment node

/**
 * Integration tests for session-trimmer.
 *
 * Tests the trimSession function both with a known session file on disk
 * and with real auggie processes (create session, prompt, trim, reload).
 *
 * Run with: npx vitest run src/features/agent/main/agent-providers/__tests__/session-trimmer-integration.test.ts
 */

import {
  describe,
  it,
  expect,
  afterEach,
  beforeAll,
} from 'vitest';
import {
  execFile,
  spawn,
  type ChildProcess,
} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { promisify } from 'util';
import { trimSession } from '../session-trimmer';

const execFileAsync = promisify(execFile);
const TEST_MODEL_ID = 'code-review-local';

// ---------------------------------------------------------------------------
// Helper: AuggieProcess (reused from auggie-session-integration.test.ts)
// ---------------------------------------------------------------------------

class AuggieProcess {
  private proc: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private notificationQueue: any[] = [];
  private notificationWaiters: Array<{ method: string; resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private rl: readline.Interface;

  constructor(auggiePath: string, workspaceRoot: string) {
    this.proc = spawn(auggiePath, ['--acp', '--allow-indexing', '--workspace-root', workspaceRoot], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line) => this.handleLine(line));
    this.proc.stderr?.resume();
  }

  private handleLine(line: string) {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      resolve(msg);
      return;
    }
    for (let i = 0; i < this.notificationWaiters.length; i++) {
      const w = this.notificationWaiters[i];
      if (msg.method === w.method) {
        clearTimeout(w.timer);
        this.notificationWaiters.splice(i, 1);
        w.resolve(msg);
        return;
      }
    }
    this.notificationQueue.push(msg);
  }

  async sendRequest(method: string, params: any, timeoutMs = 30_000): Promise<any> {
    const id = ++this.requestId;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject,
      });
      this.proc.stdin!.write(msg + '\n');
    });
  }

  sendNotification(method: string, params: any) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.proc.stdin!.write(msg + '\n');
  }

  async shutdown(timeoutMs = 10_000): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.kill(); resolve(); }, timeoutMs);
      this.proc.on('exit', () => { clearTimeout(timer); resolve(); });
      try { this.proc.stdin!.end(); } catch { /* ignore */ }
    });
  }

  kill() {
    try { this.rl.close(); } catch { /* ignore */ }
    try { this.proc.kill('SIGTERM'); } catch { /* ignore */ }
  }

  get pid() { return this.proc.pid; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initAndAuth(proc: AuggieProcess) {
  await proc.sendRequest('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'IntentTest', version: '1.0.0' },
  });
  await proc.sendRequest('authenticate', { methodId: 'none' });
}

async function maybeSetTestModel(proc: AuggieProcess, sessionId: string | undefined, availableModels?: any[]) {
  if (!sessionId) return;
  if (!Array.isArray(availableModels)) return;
  if (!availableModels.some((model) => model?.modelId === TEST_MODEL_ID)) return;

  await proc.sendRequest('session/set_model', {
    sessionId,
    modelId: TEST_MODEL_ID,
  });
}

async function initAuthAndNewSession(proc: AuggieProcess, workspaceRoot: string) {
  await initAndAuth(proc);
  const sessionRes = await proc.sendRequest('session/new', {
    cwd: workspaceRoot,
    metadata: { workspaceId: 'test' },
    mcpServers: [],
  });
  await maybeSetTestModel(
    proc,
    sessionRes?.result?.sessionId as string | undefined,
    sessionRes?.result?.models?.availableModels,
  );
  return sessionRes?.result?.sessionId as string;
}

async function sendPrompt(proc: AuggieProcess, sessionId: string, text: string) {
  return proc.sendRequest('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text }],
  }, 60_000);
}

// ---------------------------------------------------------------------------
// Detect auggie availability
// ---------------------------------------------------------------------------

let auggiePath: string | null = null;
try {
  const { stdout } = await execFileAsync('which', ['auggie'], { encoding: 'utf-8' });
  auggiePath = stdout.trim() || null;
} catch {
  auggiePath = null;
}

// Check auggie version — integration tests require >= 0.18.0 for session/load support
let auggieVersion: string | null = null;
if (auggiePath) {
  try {
    const { stdout } = await execFileAsync(auggiePath, ['--version'], { encoding: 'utf-8' });
    auggieVersion = stdout.trim() || null;
  } catch {
    auggieVersion = null;
  }
}

function isAuggieVersionSufficient(version: string | null): boolean {
  if (!version) return false;
  // Version format: "0.18.0 (commit xyz)" or "0.18.0"
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major > 0 || (major === 0 && minor >= 18);
}

const SESSIONS_DIR = path.join(os.homedir(), '.augment', 'sessions');
const KNOWN_SESSION_ID = 'fd1c8ad1-2792-4a00-8c78-7dc3bbe03f8f';

// ---------------------------------------------------------------------------
// Tests: trimSession function (no auggie process needed)
// ---------------------------------------------------------------------------

describe('trimSession', () => {
  const createdSessionFiles: string[] = [];

  afterEach(() => {
    for (const f of createdSessionFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    createdSessionFiles.length = 0;
  });

  it('trims 1 user turn from a 2-turn session', () => {
    const knownSessionPath = path.join(SESSIONS_DIR, `${KNOWN_SESSION_ID}.json`);
    if (!fs.existsSync(knownSessionPath)) {
      console.warn(`Skipping: known session file not found at ${knownSessionPath}`);
      return;
    }

    const newId = trimSession(KNOWN_SESSION_ID, 1);
    createdSessionFiles.push(path.join(SESSIONS_DIR, `${newId}.json`));

    expect(newId).toBeTruthy();
    expect(newId).not.toBe(KNOWN_SESSION_ID);

    const trimmed = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${newId}.json`), 'utf-8'));
    expect(trimmed.sessionId).toBe(newId);
    expect(trimmed.chatHistory).toHaveLength(1);

    const remainingNodes = trimmed.chatHistory[0]?.exchange?.request_nodes;
    expect(remainingNodes.some((n: any) => n.type === 0)).toBe(true);
  });

  it('throws when trying to remove more turns than exist', () => {
    const knownSessionPath = path.join(SESSIONS_DIR, `${KNOWN_SESSION_ID}.json`);
    if (!fs.existsSync(knownSessionPath)) {
      console.warn(`Skipping: known session file not found at ${knownSessionPath}`);
      return;
    }

    expect(() => trimSession(KNOWN_SESSION_ID, 3)).toThrow(/only 2 user turn/i);
  });

  it('throws when trying to remove all turns', () => {
    const knownSessionPath = path.join(SESSIONS_DIR, `${KNOWN_SESSION_ID}.json`);
    if (!fs.existsSync(knownSessionPath)) {
      console.warn(`Skipping: known session file not found at ${knownSessionPath}`);
      return;
    }

    expect(() => trimSession(KNOWN_SESSION_ID, 2)).toThrow(/cannot remove all/i);
  });

  it('throws for nonexistent session', () => {
    expect(() => trimSession('nonexistent-fake-session-id', 1)).toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: trim + session/load with real auggie process
// ---------------------------------------------------------------------------

const describeOrSkip = auggiePath && isAuggieVersionSufficient(auggieVersion) ? describe : describe.skip;

describeOrSkip('session trimmer integration with auggie', { timeout: 120_000 }, () => {
  const processes: AuggieProcess[] = [];
  const createdSessionFiles: string[] = [];
  let workspaceRoot: string;

  function spawnAuggie(): AuggieProcess {
    const proc = new AuggieProcess(auggiePath!, workspaceRoot);
    processes.push(proc);
    return proc;
  }

  beforeAll(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auggie-trim-test-'));
  });

  afterEach(() => {
    for (const proc of processes) proc.kill();
    processes.length = 0;
    for (const f of createdSessionFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    createdSessionFiles.length = 0;
  });

  it('create 3-prompt session, trim last 1, session/load, prompt again', async () => {
    const proc1 = spawnAuggie();
    const sessionId = await initAuthAndNewSession(proc1, workspaceRoot);
    expect(sessionId).toBeTruthy();

    await sendPrompt(proc1, sessionId, 'Say just the word alpha');
    await sendPrompt(proc1, sessionId, 'Say just the word beta');
    await sendPrompt(proc1, sessionId, 'Say just the word gamma');

    await proc1.shutdown();

    const trimmedId = trimSession(sessionId, 1);
    createdSessionFiles.push(path.join(SESSIONS_DIR, `${trimmedId}.json`));

    const trimmed = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${trimmedId}.json`), 'utf-8'));
    const userTurnCount = trimmed.chatHistory.filter((entry: any) => {
      const nodes = entry?.exchange?.request_nodes;
      return Array.isArray(nodes) && nodes.some((n: any) => n.type === 0);
    }).length;
    expect(userTurnCount).toBe(2);

    const proc2 = spawnAuggie();
    await initAndAuth(proc2);

    const loadRes = await proc2.sendRequest('session/load', {
      sessionId: trimmedId,
      cwd: workspaceRoot,
      mcpServers: [],
    }, 30_000);
    await maybeSetTestModel(proc2, trimmedId, loadRes?.result?.models?.availableModels);
    expect(loadRes.error).toBeUndefined();
    expect(loadRes.result).toBeDefined();

    const promptRes = await sendPrompt(proc2, trimmedId, 'Say just the word delta');
    expect(promptRes.result).toBeDefined();
    expect(promptRes.result.stopReason).toBe('end_turn');
    expect(promptRes.error).toBeUndefined();
  });

  it('create 3-prompt session, trim last 2, session/load works', async () => {
    const proc1 = spawnAuggie();
    const sessionId = await initAuthAndNewSession(proc1, workspaceRoot);

    await sendPrompt(proc1, sessionId, 'Say just the word one');
    await sendPrompt(proc1, sessionId, 'Say just the word two');
    await sendPrompt(proc1, sessionId, 'Say just the word three');

    await proc1.shutdown();

    const trimmedId = trimSession(sessionId, 2);
    createdSessionFiles.push(path.join(SESSIONS_DIR, `${trimmedId}.json`));

    const trimmed = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${trimmedId}.json`), 'utf-8'));
    const userTurnCount = trimmed.chatHistory.filter((entry: any) => {
      const nodes = entry?.exchange?.request_nodes;
      return Array.isArray(nodes) && nodes.some((n: any) => n.type === 0);
    }).length;
    expect(userTurnCount).toBe(1);

    const proc2 = spawnAuggie();
    await initAndAuth(proc2);

    const loadRes = await proc2.sendRequest('session/load', {
      sessionId: trimmedId,
      cwd: workspaceRoot,
      mcpServers: [],
    }, 30_000);
    await maybeSetTestModel(proc2, trimmedId, loadRes?.result?.models?.availableModels);
    expect(loadRes.error).toBeUndefined();

    const promptRes = await sendPrompt(proc2, trimmedId, 'Say just the word four');
    expect(promptRes.result).toBeDefined();
    expect(promptRes.result.stopReason).toBe('end_turn');
  });
});


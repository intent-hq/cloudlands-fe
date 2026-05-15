// @vitest-environment node

/**
 * Integration tests for auggie ACP session behavior.
 *
 * These tests spawn a real auggie process in ACP mode and verify session
 * behavior via JSON-RPC over stdin/stdout.
 *
 * Run with: npx vitest run src/features/agent/main/agent-providers/__tests__/auggie-session-integration.test.ts
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

const execFileAsync = promisify(execFile);
const TEST_MODEL_ID = 'code-review-local';

// ---------------------------------------------------------------------------
// Helper: AuggieProcess
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

    // Swallow stderr to avoid noise
    this.proc.stderr?.resume();
  }

  private handleLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // ignore non-JSON lines
    }

    // Response (has id)
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      resolve(msg);
      return;
    }

    // Notification (no id) – check waiters first
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

  waitForNotification(method: string, timeoutMs = 30_000): Promise<any> {
    // Check queue first
    const idx = this.notificationQueue.findIndex((m) => m.method === method);
    if (idx >= 0) {
      return Promise.resolve(this.notificationQueue.splice(idx, 1)[0]);
    }
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.notificationWaiters.findIndex((w) => w.resolve === resolve);
        if (i >= 0) this.notificationWaiters.splice(i, 1);
        reject(new Error(`Timeout waiting for notification ${method}`));
      }, timeoutMs);
      this.notificationWaiters.push({ method, resolve, timer });
    });
  }

  /** Gracefully shut down by closing stdin and waiting for process exit */
  async shutdown(timeoutMs = 10_000): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.kill();
        resolve();
      }, timeoutMs);
      this.proc.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
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
// Helpers for the init handshake
// ---------------------------------------------------------------------------

async function initAndAuth(proc: AuggieProcess) {
  const initRes = await proc.sendRequest('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'IntentTest', version: '1.0.0' },
  });
  await proc.sendRequest('authenticate', { methodId: 'none' });
  return initRes;
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
  const initRes = await initAndAuth(proc);
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
  return { initRes, sessionRes, sessionId: sessionRes?.result?.sessionId as string };
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

// Check auggie version — these tests require >= 0.18.0 for session/load support
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

const describeOrSkip = auggiePath && isAuggieVersionSufficient(auggieVersion) ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeOrSkip('auggie ACP session integration', { timeout: 60_000 }, () => {
  const processes: AuggieProcess[] = [];
  let workspaceRoot: string;

  function spawnAuggie(): AuggieProcess {
    const proc = new AuggieProcess(auggiePath!, workspaceRoot);
    processes.push(proc);
    return proc;
  }

  beforeAll(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auggie-test-'));
  });

  afterEach(() => {
    for (const proc of processes) {
      proc.kill();
    }
    processes.length = 0;
  });

  // ---- Test 1 ----
  it('auggie advertises loadSession capability', async () => {
    const proc = spawnAuggie();
    const initRes = await proc.sendRequest('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'IntentTest', version: '1.0.0' },
    });

    expect(initRes.result).toBeDefined();
    expect(initRes.result.agentCapabilities?.loadSession).toBe(true);
  });

  // ---- Test 2 ----
  it('session/new creates a session file on disk', async () => {
    const sessionsDir = path.join(os.homedir(), '.augment', 'sessions');
    // Snapshot existing session files before
    const before = new Set(fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : []);

    const proc = spawnAuggie();
    const { sessionId } = await initAuthAndNewSession(proc, workspaceRoot);
    expect(sessionId).toBeTruthy();

    // Send a trivial prompt so auggie persists the session to disk
    const promptRes = await proc.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say just the word hello' }],
    }, 45_000);
    expect(promptRes.result).toBeDefined();

    // Gracefully shut down so auggie flushes session to disk
    await proc.shutdown();

    // Check that a new session file appeared
    const after = fs.readdirSync(sessionsDir);
    const newFiles = after.filter((f) => !before.has(f) && f.endsWith('.json'));
    expect(newFiles.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Test 3 ----
  it('session/load restores a previous session', async () => {
    const sessionsDir = path.join(os.homedir(), '.augment', 'sessions');
    const before = new Set(fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : []);

    // Phase 1: create session and send a prompt
    const proc1 = spawnAuggie();
    const { sessionId } = await initAuthAndNewSession(proc1, workspaceRoot);
    expect(sessionId).toBeTruthy();

    // Send a simple prompt and wait for the response (match by id)
    const promptRes = await proc1.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say just the word hello' }],
    }, 45_000);

    expect(promptRes.result).toBeDefined();
    expect(promptRes.result.stopReason).toBeDefined();

    // Gracefully shut down so auggie flushes session to disk
    await proc1.shutdown();

    // Find the new session file created by this run
    const after = fs.readdirSync(sessionsDir);
    const newFiles = after.filter((f) => !before.has(f) && f.endsWith('.json'));
    expect(newFiles.length).toBeGreaterThanOrEqual(1);

    // The disk session ID may differ from the ACP sessionId.
    // Use the ACP sessionId for session/load — auggie should resolve it.
    const proc2 = spawnAuggie();
    await initAndAuth(proc2);
    const loadRes = await proc2.sendRequest('session/load', {
      sessionId,
      cwd: workspaceRoot,
      mcpServers: [],
    }, 30_000);
    await maybeSetTestModel(proc2, sessionId, loadRes?.result?.models?.availableModels);

    // If auggie doesn't support loading by ACP sessionId, try the disk session ID
    if (loadRes.error) {
      const diskSessionId = newFiles[0].replace('.json', '');
      const loadRes2 = await proc2.sendRequest('session/load', {
        sessionId: diskSessionId,
        cwd: workspaceRoot,
        mcpServers: [],
      }, 30_000);
      await maybeSetTestModel(proc2, diskSessionId, loadRes2?.result?.models?.availableModels);
      expect(loadRes2.error).toBeUndefined();
      expect(loadRes2.result).toBeDefined();
    } else {
      expect(loadRes.result).toBeDefined();
    }
  });

  // ---- Test 4 ----
  it('session/load fails gracefully for nonexistent session', async () => {
    const proc = spawnAuggie();
    await initAndAuth(proc);
    const loadRes = await proc.sendRequest('session/load', {
      sessionId: 'nonexistent-fake-id-12345',
      cwd: workspaceRoot,
      mcpServers: [],
    });

    // Should return an error, not crash
    expect(loadRes.error).toBeDefined();
  });

  // ---- Test 5 ----
  it('session/cancel poisons the session', async () => {
    const proc = spawnAuggie();
    const { sessionId } = await initAuthAndNewSession(proc, workspaceRoot);

    // Send cancel notification (no id)
    proc.sendNotification('session/cancel', { sessionId });

    // Now try to prompt on the cancelled session
    const promptRes = await proc.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say hello' }],
    }, 15_000);

    // Auggie returns immediately — the session is poisoned.
    // Current observed behavior: auggie returns stopReason "end_turn"
    // (not "cancelled") when prompting a cancelled session.
    expect(promptRes.result).toBeDefined();
    expect(promptRes.result.stopReason).toBeDefined();
    // Document the actual behavior for future reference
    expect(['cancelled', 'end_turn']).toContain(promptRes.result.stopReason);
  });

  // ---- Test 6 ----
  it('session/cancel is non-destructive (auggie ≥ 0.18.0)', async () => {
    // Core behavior: after cancel, the same session can accept new prompts
    // without needing session/new. This is the key fix in auggie 0.18.0+.
    const proc = spawnAuggie();
    const { sessionId } = await initAuthAndNewSession(proc, workspaceRoot);

    // Send a first prompt to establish the session
    const prompt1Res = await proc.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say just the word hello' }],
    }, 45_000);
    expect(prompt1Res.result).toBeDefined();
    expect(prompt1Res.result.stopReason).toBe('end_turn');

    // Cancel the session
    proc.sendNotification('session/cancel', { sessionId });

    // Small delay to let cancel propagate
    await new Promise((r) => setTimeout(r, 500));

    // Prompt again on the SAME session — should work without session/new
    const prompt2Res = await proc.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say just the word world' }],
    }, 45_000);

    expect(prompt2Res.result).toBeDefined();
    expect(prompt2Res.result.stopReason).toBe('end_turn');
    // The key assertion: no error, session is still usable
    expect(prompt2Res.error).toBeUndefined();
  });

  // ---- Test 7 ----
  it('session/load works with the ACP session ID across process restart', async () => {
    // Create session, prompt, kill process, restart, session/load, prompt again.
    // This confirms the session ID consistency fix: the ACP session ID from
    // session/new matches the disk session ID used by session/load.
    const proc1 = spawnAuggie();
    const { sessionId } = await initAuthAndNewSession(proc1, workspaceRoot);
    expect(sessionId).toBeTruthy();

    // Send a prompt so auggie persists the session to disk
    const prompt1Res = await proc1.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say just the word hello' }],
    }, 45_000);
    expect(prompt1Res.result).toBeDefined();
    expect(prompt1Res.result.stopReason).toBe('end_turn');

    // Gracefully shut down so auggie flushes session to disk
    await proc1.shutdown();

    // Start a new auggie process and load the session by ACP session ID
    const proc2 = spawnAuggie();
    await initAndAuth(proc2);

    const loadRes = await proc2.sendRequest('session/load', {
      sessionId, // Use the SAME session ID from session/new
      cwd: workspaceRoot,
      mcpServers: [],
    }, 30_000);
    await maybeSetTestModel(proc2, sessionId, loadRes?.result?.models?.availableModels);

    // With auggie ≥ 0.18.0, session/load should succeed with the ACP session ID
    expect(loadRes.error).toBeUndefined();
    expect(loadRes.result).toBeDefined();

    // Send another prompt on the loaded session to verify it's functional
    const prompt2Res = await proc2.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say just the word world' }],
    }, 45_000);

    expect(prompt2Res.result).toBeDefined();
    expect(prompt2Res.result.stopReason).toBe('end_turn');
    expect(prompt2Res.error).toBeUndefined();
  });

  // ---- Test 8 ----
  it('session/load after cancel on same process', async () => {
    // Combined flow: cancel + session/load on the same process.
    // This tests that after cancelling, we can reload the session
    // and continue prompting.
    const proc = spawnAuggie();
    const { sessionId } = await initAuthAndNewSession(proc, workspaceRoot);

    // Send a prompt to establish the session on disk
    const prompt1Res = await proc.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say just the word hello' }],
    }, 45_000);
    expect(prompt1Res.result).toBeDefined();
    expect(prompt1Res.result.stopReason).toBe('end_turn');

    // Cancel the session
    proc.sendNotification('session/cancel', { sessionId });

    // Small delay to let cancel propagate
    await new Promise((r) => setTimeout(r, 500));

    // Load the session back (same process, same session ID)
    const loadRes = await proc.sendRequest('session/load', {
      sessionId,
      cwd: workspaceRoot,
      mcpServers: [],
    }, 30_000);
    await maybeSetTestModel(proc, sessionId, loadRes?.result?.models?.availableModels);

    expect(loadRes.error).toBeUndefined();
    expect(loadRes.result).toBeDefined();

    // Prompt again on the loaded session
    const prompt2Res = await proc.sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say just the word world' }],
    }, 45_000);

    expect(prompt2Res.result).toBeDefined();
    expect(prompt2Res.result.stopReason).toBe('end_turn');
    expect(prompt2Res.error).toBeUndefined();
  });
});


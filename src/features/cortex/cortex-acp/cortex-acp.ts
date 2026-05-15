#!/usr/bin/env node
/**
 * cortex-acp — ACP adapter for Snowflake Cortex
 *
 * Speaks Agent Client Protocol (JSON-RPC 2.0) over stdio on the Intent-facing side.
 * Spawns a `cortex` child process per prompt using `--print` mode, translating
 * between Cortex's stream-json protocol and ACP session updates.
 * Multi-turn conversations use `--resume <session_id>` to continue context.
 *
 * Usage: node cortex-acp.js
 */

import {
  spawn,
  type ChildProcess,
} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CortexContentBlock {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result';
  thinking?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface CortexEvent {
  type: 'assistant' | 'user' | 'result' | 'system';
  subtype?: string;
  message?: { content: CortexContentBlock[]; model?: string };
  result?: string;
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: string | number;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
}

interface AcpMcpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  type?: 'http' | 'sse';
  url?: string;
  headers?: Array<{ name: string; value: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORTEX_MCP_CONFIG_PATH = path.join(os.homedir(), '.snowflake', 'cortex', 'mcp.json');
const MCP_KEY_PREFIX = 'intent';
const ADAPTER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Logging (stderr only — stdout is reserved for JSON-RPC)
// ---------------------------------------------------------------------------

function log(level: string, msg: string, data?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), level, msg, ...data };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function sendResponse(id: string | number, result: unknown): void {
  const resp: JsonRpcResponse = { jsonrpc: '2.0', result, id };
  process.stdout.write(JSON.stringify(resp) + '\n');
}

function sendError(id: string | number, code: number, message: string): void {
  const resp: JsonRpcResponse = { jsonrpc: '2.0', error: { code, message }, id };
  process.stdout.write(JSON.stringify(resp) + '\n');
}

function sendNotification(method: string, params: unknown): void {
  const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
  process.stdout.write(JSON.stringify(notif) + '\n');
}

// ---------------------------------------------------------------------------
// MCP config management
// ---------------------------------------------------------------------------

function readMcpConfig(): Record<string, Record<string, McpServerEntry>> {
  try {
    if (fs.existsSync(CORTEX_MCP_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CORTEX_MCP_CONFIG_PATH, 'utf-8'));
    }
  } catch (err) {
    log('warn', 'Failed to read MCP config', { error: String(err) });
  }
  return {};
}

function writeMcpConfig(config: Record<string, Record<string, McpServerEntry>>): void {
  const dir = path.dirname(CORTEX_MCP_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CORTEX_MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

function injectMcpServers(servers: AcpMcpServer[]): void {
  if (servers.length === 0) return;

  const config = readMcpConfig();
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  for (const server of servers) {
    const key = `${MCP_KEY_PREFIX}-${server.name}`;
    if (server.command) {
      const entry: McpServerEntry = { command: server.command, args: server.args };
      if (server.env && server.env.length > 0) {
        entry.env = {};
        for (const { name, value } of server.env) {
          entry.env[name] = value;
        }
      }
      config.mcpServers[key] = entry;
    } else if (server.url) {
      config.mcpServers[key] = { type: server.type || 'sse', url: server.url };
    }
  }

  writeMcpConfig(config);
  log('info', 'Injected MCP servers into cortex config', {
    serverCount: servers.length,
    path: CORTEX_MCP_CONFIG_PATH,
  });
}

function cleanupMcpServers(): void {
  try {
    const config = readMcpConfig();
    if (!config.mcpServers) return;

    let removed = 0;
    for (const key of Object.keys(config.mcpServers)) {
      if (key === MCP_KEY_PREFIX || key.startsWith(`${MCP_KEY_PREFIX}-`)) {
        delete config.mcpServers[key];
        removed++;
      }
    }

    if (removed > 0) {
      writeMcpConfig(config);
      log('info', 'Cleaned up MCP servers from cortex config', { removed });
    }
  } catch (err) {
    log('warn', 'Failed to cleanup MCP config', { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Tool kind mapping
// ---------------------------------------------------------------------------

type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';

function getToolKind(toolName: string): ToolKind {
  const n = toolName.toLowerCase();
  if (n === 'read' || n.includes('read')) return 'read';
  if (n === 'write' || n.includes('write') || n.includes('edit')) return 'edit';
  if (n === 'glob' || n.includes('search') || n.includes('find') || n.includes('grep')) return 'search';
  if (n === 'bash' || n.includes('exec') || n.includes('run') || n.includes('shell')) return 'execute';
  if (n.includes('think')) return 'think';
  if (n.includes('fetch') || n.includes('http') || n.includes('web')) return 'fetch';
  if (n.includes('delete') || n.includes('remove')) return 'delete';
  if (n.includes('move') || n.includes('rename')) return 'move';
  return 'other';
}

function getToolLocations(toolName: string, input: Record<string, unknown>): Array<{ path: string }> {
  const locations: Array<{ path: string }> = [];
  if (input.file_path && typeof input.file_path === 'string') {
    locations.push({ path: input.file_path });
  }
  if (input.path && typeof input.path === 'string') {
    locations.push({ path: input.path });
  }
  if (input.pattern && typeof input.pattern === 'string') {
    locations.push({ path: input.pattern });
  }
  return locations;
}

// ---------------------------------------------------------------------------
// Cortex process manager
// ---------------------------------------------------------------------------

class CortexProcess {
  private proc: ChildProcess | null = null;
  private sessionId: string | null = null;
  private workingDir: string;
  private model: string | null;
  private stdoutBuffer = '';
  private onEvent: (event: CortexEvent) => void;
  private onExit: (code: number | null, signal: string | null) => void;
  private killed = false;

  constructor(opts: {
    workingDir: string;
    model: string | null;
    onEvent: (event: CortexEvent) => void;
    onExit: (code: number | null, signal: string | null) => void;
  }) {
    this.workingDir = opts.workingDir;
    this.model = opts.model;
    this.onEvent = opts.onEvent;
    this.onExit = opts.onExit;
  }

  get cortexSessionId(): string | null {
    return this.sessionId;
  }

  get isAlive(): boolean {
    return this.proc !== null && !this.killed && this.proc.exitCode === null;
  }

  spawn(prompt: string, resumeSessionId?: string): void {
    const args = ['--output-format', 'stream-json', '--dangerously-allow-all-tool-calls'];
    if (this.model) {
      args.push('--model', this.model);
    }
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }
    args.push('-w', this.workingDir);
    args.push('--print', prompt);

    log('info', 'Spawning cortex process', { args: args.map((a, i) => args[i - 1] === '--print' ? `<prompt ${a.length} chars>` : a), cwd: this.workingDir });

    this.killed = false;
    this.stdoutBuffer = '';
    this.proc = spawn('cortex', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: this.workingDir,
      env: { ...process.env, TERM: 'dumb' },
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    this.proc.stdout?.on('data', (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      this.processBuffer();
    });

    this.proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        log('debug', 'cortex stderr', { text: text.substring(0, 500) });
      }
    });

    this.proc.on('error', (err) => {
      log('error', 'cortex process error', { error: err.message });
      this.proc = null;
      if (!this.killed) {
        this.onExit(null, null);
      }
    });

    this.proc.on('exit', (code, signal) => {
      log('info', 'cortex process exited', { code, signal: signal ?? undefined });
      this.proc = null;
      if (!this.killed) {
        this.onExit(code, signal);
      }
    });
  }

  kill(): void {
    if (this.proc && this.proc.exitCode === null) {
      this.killed = true;
      // Note: On Windows, SIGTERM triggers an unconditional process termination
      // (equivalent to SIGKILL). There is no graceful shutdown on Windows.
      this.proc.kill('SIGTERM');
      log('info', 'Killed cortex process');
    }
  }

  private processBuffer(): void {
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Cortex echoes prompt text and control sequences on stdout before JSON events.
      // Silently skip any line that doesn't look like JSON.
      if (!trimmed.startsWith('{')) continue;
      try {
        const event = JSON.parse(trimmed) as CortexEvent;
        if (event.session_id && !this.sessionId) {
          this.sessionId = event.session_id;
          log('info', 'Captured cortex session ID', { sessionId: this.sessionId });
        }
        this.onEvent(event);
      } catch (err) {
        log('warn', 'Failed to parse cortex event', {
          line: trimmed.substring(0, 200),
          error: String(err),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

class CortexAcpAdapter {
  private cortex: CortexProcess | null = null;
  private acpSessionId: string | null = null;
  private cortexSessionId: string | null = null;
  private cortexConfig: { workingDir: string; model: string | null } | null = null;
  private promptResolve: ((value: void) => void) | null = null;
  private promptReject: ((reason: Error) => void) | null = null;
  private currentPromptRequestId: string | number | null = null;
  private mcpServersInjected = false;

  // ---- ACP method dispatch ----

  async handleRequest(req: JsonRpcRequest): Promise<void> {
    log('debug', 'Received request', { method: req.method, id: req.id });

    try {
      switch (req.method) {
        case 'initialize':
          this.handleInitialize(req);
          break;
        case 'authenticate':
          this.handleAuthenticate(req);
          break;
        case 'session/new':
          this.handleSessionNew(req);
          break;
        case 'session/prompt':
          await this.handleSessionPrompt(req);
          break;
        default:
          if (req.id !== undefined) {
            sendError(req.id, -32601, `Method not found: ${req.method}`);
          }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('error', 'Request handler error', { method: req.method, error: msg });
      if (req.id !== undefined) {
        sendError(req.id, -32603, msg);
      }
    }
  }

  handleNotification(notif: JsonRpcRequest): void {
    log('debug', 'Received notification', { method: notif.method });

    switch (notif.method) {
      case 'session/cancel':
        this.handleCancel();
        break;
      default:
        log('debug', 'Ignoring unknown notification', { method: notif.method });
    }
  }

  // ---- initialize ----

  private handleInitialize(req: JsonRpcRequest): void {
    sendResponse(req.id!, {
      protocolVersion: 1,
      agentInfo: {
        name: 'Snowflake Cortex',
        version: ADAPTER_VERSION,
        description: 'ACP adapter for Snowflake Cortex coding agent',
      },
      instructions: null,
      promptCapabilities: {},
      sessionCapabilities: { models: true },
    });
  }

  // ---- authenticate (no-op) ----

  private handleAuthenticate(req: JsonRpcRequest): void {
    sendResponse(req.id!, {});
  }

  // ---- session/new ----

  private handleSessionNew(req: JsonRpcRequest): void {
    const params = (req.params || {}) as Record<string, unknown>;
    const metadata = (params.metadata || {}) as Record<string, unknown>;

    // Extract working directory from params
    const workingDir =
      (params.cwd as string) ||
      (metadata.workspacePath as string) ||
      process.cwd();

    // Extract model from metadata
    const model = (metadata.model as string) || null;

    // Generate ACP session ID
    this.acpSessionId = `cortex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Inject MCP servers if provided
    const mcpServers = params.mcpServers as AcpMcpServer[] | undefined;
    if (mcpServers && mcpServers.length > 0) {
      injectMcpServers(mcpServers);
      this.mcpServersInjected = true;
    }

    // Don't spawn cortex yet — wait for first prompt (--print mode)
    this.cortexConfig = { workingDir, model };

    log('info', 'Session created', {
      sessionId: this.acpSessionId,
      workingDir,
      model: model ?? 'default',
      mcpServers: mcpServers?.length ?? 0,
    });

    sendResponse(req.id!, { sessionId: this.acpSessionId });
  }

  // ---- session/prompt ----

  private async handleSessionPrompt(req: JsonRpcRequest): Promise<void> {
    if (!this.cortexConfig || !this.acpSessionId) {
      sendError(req.id!, -32001, 'No active session');
      return;
    }

    const params = (req.params || {}) as Record<string, unknown>;
    const prompt = params.prompt as Array<{ type: string; text?: string }>;

    // Extract text from the prompt content blocks
    let promptText = '';
    if (Array.isArray(prompt)) {
      for (const block of prompt) {
        if (block.type === 'text' && block.text) {
          promptText += block.text;
        }
      }
    }

    if (!promptText) {
      sendError(req.id!, -32602, 'Empty prompt');
      return;
    }

    this.currentPromptRequestId = req.id!;

    // Get resume session ID from previous invocation (if any)
    const resumeId = this.cortexSessionId ?? undefined;

    // Spawn a NEW cortex process for this prompt (--print mode: one process per prompt)
    this.cortex = new CortexProcess({
      workingDir: this.cortexConfig.workingDir,
      model: this.cortexConfig.model,
      onEvent: (event) => this.handleCortexEvent(event),
      onExit: (code, signal) => this.handleCortexExit(code, signal),
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.promptResolve = resolve;
        this.promptReject = reject;
        this.cortex!.spawn(promptText, resumeId);
      });

      sendResponse(req.id!, { stopReason: 'end_turn' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(req.id!, -32603, `Prompt failed: ${msg}`);
    } finally {
      this.currentPromptRequestId = null;
      this.promptResolve = null;
      this.promptReject = null;
    }
  }

  // ---- session/cancel ----

  private handleCancel(): void {
    if (this.cortex) {
      this.cortex.kill();
      log('info', 'Cancelled: killed cortex process');
    }
    if (this.promptResolve) {
      // Resolve the pending prompt — the response will indicate cancellation
      this.currentPromptRequestId = null;
      const resolve = this.promptResolve;
      this.promptResolve = null;
      this.promptReject = null;
      resolve();
    }
  }

  // ---- Cortex event → ACP session/update translation ----

  private handleCortexEvent(event: CortexEvent): void {
    if (!this.acpSessionId) return;

    // Capture cortex session ID for --resume on follow-up prompts
    if (event.session_id && !this.cortexSessionId) {
      this.cortexSessionId = event.session_id;
      log('info', 'Captured cortex session ID on adapter', { sessionId: this.cortexSessionId });
    }

    switch (event.type) {
      case 'assistant': {
        const blocks = event.message?.content || [];
        for (const block of blocks) {
          switch (block.type) {
            case 'thinking':
              if (block.thinking) {
                sendNotification('session/update', {
                  sessionId: this.acpSessionId,
                  update: {
                    type: 'agent_thought_chunk',
                    content: { type: 'text', text: block.thinking },
                  },
                });
              }
              break;

            case 'text':
              if (block.text) {
                sendNotification('session/update', {
                  sessionId: this.acpSessionId,
                  update: {
                    type: 'agent_message_chunk',
                    content: { type: 'text', text: block.text },
                  },
                });
              }
              break;

            case 'tool_use':
              if (block.id && block.name) {
                const input = block.input || {};
                sendNotification('session/update', {
                  sessionId: this.acpSessionId,
                  update: {
                    type: 'tool_call',
                    toolCallId: block.id,
                    title: block.name,
                    name: block.name,
                    kind: getToolKind(block.name),
                    status: 'in_progress',
                    content: { id: block.id, name: block.name, input },
                    locations: getToolLocations(block.name, input),
                    rawInput: input,
                  },
                });
              }
              break;
          }
        }
        break;
      }

      case 'user': {
        // tool_result events — update the corresponding tool call
        const blocks = event.message?.content || [];
        for (const block of blocks) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const status = block.is_error ? 'failed' : 'completed';
            sendNotification('session/update', {
              sessionId: this.acpSessionId,
              update: {
                type: 'tool_call_update',
                toolCallId: block.tool_use_id,
                status,
                content: { toolCallId: block.tool_use_id, result: block.content || '' },
                rawOutput: block.content || '',
              },
            });
          }
        }
        break;
      }

      case 'result': {
        // Prompt is complete — resolve the pending promise
        log('info', 'Cortex prompt completed', {
          cost: event.cost_usd,
          duration: event.duration_ms,
          numTurns: event.num_turns,
        });
        if (this.promptResolve) {
          const resolve = this.promptResolve;
          this.promptResolve = null;
          this.promptReject = null;
          resolve();
        }
        break;
      }

      case 'system':
        log('info', 'Cortex system event', { subtype: event.subtype });
        break;

      default:
        log('debug', 'Unknown cortex event type', { type: event.type });
    }
  }

  // ---- Handle cortex process exit ----
  // In --print mode, cortex exits after completing the response.
  // Exit code 0 = normal completion; non-zero = error.

  private handleCortexExit(code: number | null, signal: string | null): void {
    log('info', 'Cortex process exited', { code, signal: signal ?? undefined });

    if (code === 0) {
      // Normal exit in --print mode — resolve the pending prompt if not already resolved
      if (this.promptResolve) {
        const resolve = this.promptResolve;
        this.promptResolve = null;
        this.promptReject = null;
        resolve();
      }
    } else {
      // Abnormal exit — reject the pending prompt
      if (this.promptReject) {
        const reject = this.promptReject;
        this.promptResolve = null;
        this.promptReject = null;
        reject(new Error(`Cortex process exited with code=${code}, signal=${signal}`));
      }
    }
  }

  // ---- Cleanup ----

  cleanup(): void {
    if (this.cortex) {
      this.cortex.kill();
      this.cortex = null;
    }
    if (this.mcpServersInjected) {
      cleanupMcpServers();
      this.mcpServersInjected = false;
    }
    log('info', 'Adapter cleanup complete');
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('info', 'cortex-acp adapter starting', { version: ADAPTER_VERSION, pid: process.pid });

  const adapter = new CortexAcpAdapter();

  // Read JSON-RPC messages from stdin (one per line)
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      log('warn', 'Failed to parse JSON-RPC message', {
        line: trimmed.substring(0, 200),
        error: String(err),
      });
      return;
    }

    if (msg.jsonrpc !== '2.0') {
      log('warn', 'Invalid JSON-RPC version', { version: msg.jsonrpc });
      return;
    }

    // Requests have an `id`, notifications do not
    if (msg.id !== undefined) {
      await adapter.handleRequest(msg);
    } else {
      adapter.handleNotification(msg);
    }
  });

  rl.on('close', () => {
    log('info', 'stdin closed, shutting down');
    adapter.cleanup();
    process.exit(0);
  });

  // Graceful shutdown on signals
  const shutdown = () => {
    log('info', 'Received shutdown signal');
    adapter.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log('error', 'Fatal error', { error: String(err) });
  process.exit(1);
});


/**
 * Terminal IPC Handler
 *
 * Routes every terminal spawn through the daemon's `terminal.*` RPC surface
 * (PROTOCOL §5.13) via `getBackendClient()`. Local `node-pty` /
 * `child_process` spawning has been retired — the daemon owns the PTY host,
 * including for remote workspaces (the daemon runs on the remote host).
 *
 * The renderer IPC contract on `TERMINAL_CHANNELS.*` is preserved: request /
 * response shapes, buffered-output replay, and the terminal:* Redux domain
 * actions all continue to flow. On backend disconnection or RPC failure we
 * degrade honestly — the handler returns `{ success: false, error }` rather
 * than falling back to a local child.
 */
import { ipcMain } from 'electron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../../../shared/logger';
import type { WorkspaceId } from '../../../shared/types';
import { TERMINAL_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  TerminalProfessionalCreateSchema,
  TerminalProfessionalListSchema,
  TerminalProfessionalWriteSchema,
  TerminalProfessionalResizeSchema,
  TerminalProfessionalInfoSchema,
  TerminalProfessionalRefreshSchema,
  TerminalProfessionalDisposeSchema,
  TerminalProfessionalGetBufferSchema,
  TerminalCreateWithCommandSchema,
} from '../../../main/ipc-schemas';
import { workspaceService } from '$features/workspace/main/workspace.service';
import { WorkspaceConfig } from '$shared/main/config';
import { createWorkspaceId } from '$shared/types/branded-ids';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  terminalProfessionalData,
  terminalProfessionalExit,
  terminalDisposed,
  terminalCreated,
} from '../../../store/main/slices/terminal-events/terminal-events-slice';
import { getBackendClient, onBackendReconnected } from '../../backend/main/backend.ipc';
import type { JsonRpcNotification } from '../../backend/main/json-rpc-client';

const logger = new Logger('Terminal-IPC');

const OUTPUT_BUFFER_LIMIT_BYTES = 512 * 1024;
const WORKSPACE_INFO_RETRY_DELAY_MS = 300;
const WORKSPACE_INFO_MAX_RETRIES = 5;

function encodeBase64(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64');
}

function decodeBase64(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  try {
    return Buffer.from(input, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/** Minimal workspace lookup for cwd resolution; SSH branch is gone. */
async function getWorkspaceInfo(
  workspaceId: string,
): Promise<{ workspacePath?: string; scope?: string }> {
  for (let attempt = 0; attempt <= WORKSPACE_INFO_MAX_RETRIES; attempt++) {
    try {
      const workspace = await workspaceService.getWorkspace(createWorkspaceId(workspaceId));
      if (!workspace.ok) {
        if (attempt < WORKSPACE_INFO_MAX_RETRIES) {
          await delay(WORKSPACE_INFO_RETRY_DELAY_MS);
          continue;
        }
        return {};
      }
      const data = workspace.data;
      const workspacePath = data.worktreePath || data.repositoryPath || data.path;
      if (!workspacePath && attempt < WORKSPACE_INFO_MAX_RETRIES) {
        await delay(WORKSPACE_INFO_RETRY_DELAY_MS);
        continue;
      }
      return { workspacePath, scope: data.scope };
    } catch (error) {
      if (attempt < WORKSPACE_INFO_MAX_RETRIES) {
        await delay(WORKSPACE_INFO_RETRY_DELAY_MS);
        continue;
      }
      logger.error('[Terminal] Failed to get workspace info', error as Error);
      return {};
    }
  }
  return {};
}

function ensureDirectoryExists(dirPath: string): string | null {
  try {
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return null;
    return dirPath;
  } catch {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return dirPath;
    } catch (error) {
      logger.error(`[Terminal] Failed to create directory ${dirPath}:`, error as Error);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Daemon-backed terminal registry
// ---------------------------------------------------------------------------

interface DaemonTerminalInfo {
  id: string;
  workspaceId: string;
  cwd: string;
  title: string;
  isExecutingCommand: boolean;
  currentCommand: string;
}

class DaemonTerminal {
  readonly id: string;
  readonly workspaceId: string;
  readonly cwd: string;
  title: string;
  daemonTerminalId: string;
  private outputChunks: string[] = [];
  private outputBytes = 0;
  private disposed = false;
  exitCode: number | null | undefined;
  signal: string | null | undefined;

  constructor(params: {
    id: string;
    workspaceId: string;
    cwd: string;
    title?: string;
    daemonTerminalId: string;
  }) {
    this.id = params.id;
    this.workspaceId = params.workspaceId;
    this.cwd = params.cwd;
    this.title = params.title || 'Terminal';
    this.daemonTerminalId = params.daemonTerminalId;
  }

  get isAlive(): boolean {
    return !this.disposed && this.exitCode === undefined;
  }
  get isDisposed(): boolean {
    return this.disposed;
  }
  appendOutput(chunk: string): void {
    if (!chunk) return;
    this.outputChunks.push(chunk);
    this.outputBytes += chunk.length;
    while (this.outputBytes > OUTPUT_BUFFER_LIMIT_BYTES && this.outputChunks.length > 0) {
      const removed = this.outputChunks.shift();
      if (removed) this.outputBytes -= removed.length;
    }
  }
  getBufferedOutput(): string {
    return this.outputChunks.join('');
  }
  markExit(exitCode: number | null, signal: string | null): void {
    this.exitCode = exitCode;
    this.signal = signal;
  }
  markDisposed(): void {
    this.disposed = true;
  }
  getInfo(): DaemonTerminalInfo {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      cwd: this.cwd,
      title: this.title,
      isExecutingCommand: this.isAlive,
      currentCommand: '',
    };
  }
}


class DaemonTerminalRegistry {
  private terminals = new Map<string, DaemonTerminal>();
  private byDaemonId = new Map<string, string>();
  private subscriptionId: string | undefined;
  private notificationListener: ((n: JsonRpcNotification) => void) | undefined;
  /**
   * Sticky reconnect listener, installed on first `ensureSubscription()` so we
   * never register more than one hook against `getBackendClient()`. On daemon
   * restart the in-memory subscription registry is dropped; we replay
   * `events.subscribe(['terminal:data', 'terminal:exit'])` on the same client
   * (the notification listener persists across reconnects) so live output /
   * exit continues to flow (RESUB-1).
   */
  private reconnectDisposer: (() => void) | undefined;

  getTerminal(id: string): DaemonTerminal | undefined {
    return this.terminals.get(id);
  }
  getWorkspaceTerminals(workspaceId: string): DaemonTerminal[] {
    return Array.from(this.terminals.values()).filter(
      (t) => t.workspaceId === workspaceId && !t.isDisposed,
    );
  }
  register(terminal: DaemonTerminal): void {
    this.terminals.set(terminal.id, terminal);
    this.byDaemonId.set(terminal.daemonTerminalId, terminal.id);
    void this.ensureSubscription();
  }
  async dispose(id: string): Promise<boolean> {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (terminal.isAlive) {
      try {
        await getBackendClient().request('terminal.kill', {
          terminalId: terminal.daemonTerminalId,
        });
      } catch (error) {
        logger.warn('[Terminal] terminal.kill failed', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    terminal.markDisposed();
    this.byDaemonId.delete(terminal.daemonTerminalId);
    this.terminals.delete(id);
    return true;
  }
  async disposeAll(): Promise<void> {
    const ids = Array.from(this.terminals.keys());
    await Promise.all(ids.map((id) => this.dispose(id).catch(() => false)));
    this.terminals.clear();
    this.byDaemonId.clear();
  }
  disposeAllSync(): void {
    for (const terminal of this.terminals.values()) {
      if (terminal.isAlive) {
        getBackendClient()
          .request('terminal.kill', { terminalId: terminal.daemonTerminalId })
          .catch(() => {});
      }
    }
    this.terminals.clear();
    this.byDaemonId.clear();
  }
  private async ensureSubscription(): Promise<void> {
    if (this.subscriptionId || this.notificationListener) return;
    const client = getBackendClient();
    const listener = (n: JsonRpcNotification): void => {
      if (n.method !== 'events.event') return;
      const params = n.params as { subscriptionId?: unknown; event?: unknown } | undefined;
      const subId =
        typeof params?.subscriptionId === 'string' ? params.subscriptionId : undefined;
      if (this.subscriptionId !== undefined && subId !== this.subscriptionId) return;
      const event = params?.event as
        | {
            type?: unknown;
            data?: {
              terminalId?: unknown;
              chunk?: unknown;
              exitCode?: unknown;
              signal?: unknown;
            };
          }
        | undefined;
      if (!event) return;
      const type = typeof event.type === 'string' ? event.type : '';
      if (!type.startsWith('terminal:')) return;
      const daemonId =
        typeof event.data?.terminalId === 'string' ? event.data.terminalId : undefined;
      if (!daemonId) return;
      const localId = this.byDaemonId.get(daemonId);
      if (!localId) return;
      const terminal = this.terminals.get(localId);
      if (!terminal) return;
      if (type === 'terminal:data') {
        const chunk = decodeBase64(event.data?.chunk);
        if (chunk) {
          terminal.appendOutput(chunk);
          mainDispatch(terminalProfessionalData({ terminalId: localId, data: chunk }));
        }
      } else if (type === 'terminal:exit') {
        const exitCode =
          typeof event.data?.exitCode === 'number' ? event.data.exitCode : null;
        const signal = typeof event.data?.signal === 'string' ? event.data.signal : null;
        terminal.markExit(exitCode, signal);
        mainDispatch(terminalProfessionalExit({ terminalId: localId, exitCode, signal }));
      }
    };
    this.notificationListener = listener;
    client.on('notification', listener);
    if (!this.reconnectDisposer) {
      this.reconnectDisposer = onBackendReconnected(() => {
        // The notification listener persists across reconnects (same singleton
        // client). Drop the stale id first — it belonged to the previous
        // connection and would never match a fresh notification's
        // `subscriptionId` tag — then re-issue subscribe. Do NOT call
        // `ensureSubscription()` again; the notification-listener guard would
        // either skip it or double-register the listener depending on state.
        this.subscriptionId = undefined;
        if (this.terminals.size === 0) return;
        void this.doSubscribe(getBackendClient());
      });
    }
    await this.doSubscribe(client);
  }

  private async doSubscribe(client: ReturnType<typeof getBackendClient>): Promise<void> {
    try {
      const result = await client.request<{ subscriptionId?: string }>('events.subscribe', {
        eventTypes: ['terminal:data', 'terminal:exit'],
      });
      this.subscriptionId = result?.subscriptionId;
    } catch (error) {
      logger.warn('[Terminal] events.subscribe failed; live output will not stream', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const registry = new DaemonTerminalRegistry();

/**
 * Backwards-compatible export shim used by MCP `ws.terminal.*` in
 * `ws-misc-api.ts`. Preserves the small surface those callers rely on
 * (`getTerminal`, `getWorkspaceTerminals`, `getInfo()`, `getBufferedOutput()`)
 * without exposing the daemon-backed internals.
 */
export const terminalManager = {
  getTerminal(id: string) {
    const t = registry.getTerminal(id);
    if (!t) return null;
    return {
      disposed: t.isDisposed,
      isAlive: t.isAlive,
      getInfo: () => t.getInfo(),
      getBufferedOutput: () => t.getBufferedOutput(),
    };
  },
  getWorkspaceTerminals(workspaceId: string) {
    return registry.getWorkspaceTerminals(workspaceId).map((t) => ({
      disposed: t.isDisposed,
      isAlive: t.isAlive,
      getInfo: () => t.getInfo(),
      getBufferedOutput: () => t.getBufferedOutput(),
    }));
  },
  disposeTerminal(id: string) {
    return registry.dispose(id);
  },
  disposeAll() {
    return registry.disposeAll();
  },
  disposeAllSync() {
    registry.disposeAllSync();
  },
};

// ---------------------------------------------------------------------------
// Core spawn helper — delegates to `terminal.create` (PROTOCOL §5.13)
// ---------------------------------------------------------------------------

async function spawnDaemonTerminal(params: {
  id: string;
  workspaceId: string;
  cwd: string;
  cols: number;
  rows: number;
  command?: string;
  env?: Record<string, string>;
  title?: string;
}): Promise<
  { ok: true; terminal: DaemonTerminal } | { ok: false; error: string }
> {
  try {
    const request: Record<string, unknown> = {
      workspaceId: params.workspaceId,
      cols: params.cols,
      rows: params.rows,
      cwd: params.cwd,
    };
    if (params.command) request.command = params.command;
    if (params.env && Object.keys(params.env).length > 0) request.env = params.env;
    const result = await getBackendClient().request<{ terminalId?: unknown }>(
      'terminal.create',
      request,
    );
    if (typeof result?.terminalId !== 'string' || result.terminalId.length === 0) {
      return {
        ok: false,
        error: `terminal.create returned no terminalId: ${JSON.stringify(result)}`,
      };
    }
    const terminal = new DaemonTerminal({
      id: params.id,
      workspaceId: params.workspaceId,
      cwd: params.cwd,
      title: params.title,
      daemonTerminalId: result.terminalId,
    });
    registry.register(terminal);
    return { ok: true, terminal };
  } catch (error) {
    logger.error('[Terminal] terminal.create failed', error as Error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function generateTerminalId(): string {
  return `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}


// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerTerminalHandlers() {
  logger.info('[Terminal] Registering terminal IPC handlers (daemon-backed)');

  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_CREATE,
    createSafeValidatedHandler(
      TerminalProfessionalCreateSchema,
      async (_, validated) => {
        const { terminalId: providedId, workspaceId, cwd, cols = 80, rows = 24 } = validated;

        if (providedId) {
          const existing = registry.getTerminal(providedId);
          if (existing && existing.isAlive) {
            if (existing.workspaceId !== workspaceId) {
              logger.warn(
                `[Terminal] Terminal ${providedId} belongs to workspace ${existing.workspaceId}, not ${workspaceId}. Creating new terminal.`,
              );
            } else {
              try {
                await getBackendClient().request('terminal.resize', {
                  terminalId: existing.daemonTerminalId,
                  cols,
                  rows,
                });
              } catch (error) {
                logger.warn('[Terminal] terminal.resize on reconnect failed', {
                  id: providedId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
              return { success: true, terminalId: providedId, reconnected: true };
            }
          }
        }

        let workingDir = cwd;
        if (!workingDir) {
          if (workspaceId === '__root__') {
            workingDir = os.homedir();
          } else {
            const info = await getWorkspaceInfo(workspaceId);
            if (info.workspacePath) {
              workingDir = info.scope
                ? path.join(info.workspacePath, info.scope)
                : info.workspacePath;
            }
          }
        }
        if (!workingDir) {
          workingDir = WorkspaceConfig.paths.workspace(workspaceId);
        }
        const validatedCwd = ensureDirectoryExists(workingDir);
        if (!validatedCwd) {
          return {
            success: false,
            error: `WORKSPACE_NOT_READY: could not access working directory ${workingDir}`,
          };
        }

        const localId = providedId || generateTerminalId();
        const spawn = await spawnDaemonTerminal({
          id: localId,
          workspaceId,
          cwd: validatedCwd,
          cols,
          rows,
        });
        if (!spawn.ok) return { success: false, error: spawn.error };
        return { success: true, terminalId: localId, cwd: validatedCwd };
      },
      TERMINAL_CHANNELS.PROFESSIONAL_CREATE,
    ),
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_LIST,
    createSafeValidatedHandler(
      TerminalProfessionalListSchema,
      async (_, validated) => {
        try {
          const { workspaceId } = validated;
          const terminals = registry.getWorkspaceTerminals(workspaceId).map((t) => ({
            id: t.id,
            workspaceId: t.workspaceId,
            cwd: t.cwd,
            isExecuting: t.isAlive,
          }));
          return { success: true, terminals };
        } catch (error) {
          logger.error('[Terminal] Error listing terminals', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list terminals',
            terminals: [],
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_LIST,
    ),
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_WRITE,
    createSafeValidatedHandler(
      TerminalProfessionalWriteSchema,
      async (_, validated) => {
        const { terminalId, data } = validated;
        const terminal = registry.getTerminal(terminalId);
        if (!terminal) return { success: false, error: `Terminal not found: ${terminalId}` };
        if (!terminal.isAlive) return { success: false, error: 'Terminal is disposed' };
        try {
          await getBackendClient().request('terminal.write', {
            terminalId: terminal.daemonTerminalId,
            data: encodeBase64(data),
          });
          return { success: true };
        } catch (error) {
          logger.error('[Terminal] terminal.write failed', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_WRITE,
    ),
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_RESIZE,
    createSafeValidatedHandler(
      TerminalProfessionalResizeSchema,
      async (_, validated) => {
        const { terminalId, cols, rows } = validated;
        const terminal = registry.getTerminal(terminalId);
        if (!terminal) return { success: false, error: `Terminal not found: ${terminalId}` };
        if (!terminal.isAlive) return { success: false, error: 'Terminal is disposed' };
        try {
          await getBackendClient().request('terminal.resize', {
            terminalId: terminal.daemonTerminalId,
            cols,
            rows,
          });
          return { success: true };
        } catch (error) {
          logger.error('[Terminal] terminal.resize failed', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_RESIZE,
    ),
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_INFO,
    createSafeValidatedHandler(
      TerminalProfessionalInfoSchema,
      async (_, validated) => {
        const { terminalId } = validated;
        const terminal = registry.getTerminal(terminalId);
        if (!terminal) return { success: false, error: `Terminal not found: ${terminalId}` };
        return { success: true, info: terminal.getInfo() };
      },
      TERMINAL_CHANNELS.PROFESSIONAL_INFO,
    ),
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_GET_BUFFER,
    createSafeValidatedHandler(
      TerminalProfessionalGetBufferSchema,
      async (_, validated) => {
        const { terminalId } = validated;
        const terminal = registry.getTerminal(terminalId);
        if (!terminal) return { success: false, error: 'Terminal not found' };
        return { success: true, buffer: terminal.getBufferedOutput() };
      },
      TERMINAL_CHANNELS.PROFESSIONAL_GET_BUFFER,
    ),
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_REFRESH,
    createSafeValidatedHandler(
      TerminalProfessionalRefreshSchema,
      async (_, validated) => {
        const { terminalId } = validated;
        const terminal = registry.getTerminal(terminalId);
        if (!terminal) return { success: false, error: 'Terminal not found' };
        if (!terminal.isAlive) return { success: false, error: 'Terminal is disposed' };
        try {
          await getBackendClient().request('terminal.write', {
            terminalId: terminal.daemonTerminalId,
            data: encodeBase64('\r'),
          });
          return { success: true };
        } catch (error) {
          logger.error('[Terminal] terminal.write (refresh) failed', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_REFRESH,
    ),
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_DISPOSE,
    createSafeValidatedHandler(
      TerminalProfessionalDisposeSchema,
      async (_, validated) => {
        try {
          await registry.dispose(validated.terminalId);
          return { success: true };
        } catch (error) {
          logger.error('[Terminal] Error disposing terminal', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_DISPOSE,
    ),
  );

  ipcMain.handle(
    TERMINAL_CHANNELS.CREATE_WITH_COMMAND,
    createSafeValidatedHandler(
      TerminalCreateWithCommandSchema,
      async (_, validated) => {
        const { workspaceId, command, cwd, title, env, pasteOnly } = validated;
        try {
          let workingDir = cwd;
          if (!workingDir) {
            if (workspaceId === '__root__') {
              workingDir = os.homedir();
            } else {
              const info = await getWorkspaceInfo(workspaceId);
              if (info.workspacePath) {
                workingDir = info.scope
                  ? path.join(info.workspacePath, info.scope)
                  : info.workspacePath;
              }
              if (!workingDir) workingDir = WorkspaceConfig.paths.workspace(workspaceId);
            }
          }
          const validatedCwd = ensureDirectoryExists(workingDir);
          if (!validatedCwd) {
            return {
              ok: false,
              error:
                'WORKSPACE_NOT_READY: The workspace directory does not exist yet. Please wait for workspace initialization to complete.',
            };
          }
          const result = await createTerminalFromBackend({
            workspaceId: workspaceId as WorkspaceId,
            cwd: validatedCwd,
            title: title || `Command: ${command.substring(0, 30)}`,
            initialCommand: command,
            pasteOnly,
            env,
          });
          return { ok: result.success, terminalId: result.terminalId, error: result.error };
        } catch (error) {
          logger.error('[Terminal] terminal:createWithCommand failed', error as Error);
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
      TERMINAL_CHANNELS.CREATE_WITH_COMMAND,
    ),
  );

  logger.info('[Terminal] IPC handlers registered (daemon-backed)');
}


// ---------------------------------------------------------------------------
// Backend-facing spawn used by other main-process code
// ---------------------------------------------------------------------------

/**
 * Create a terminal via the daemon and dispatch `terminalCreated` so the
 * renderer's terminal tabs pick it up. Used by workspace setup and by the
 * `terminal:createWithCommand` handler above.
 */
export async function createTerminalFromBackend(options: {
  workspaceId: WorkspaceId;
  cwd: string;
  title?: string;
  initialCommand?: string;
  /**
   * When `true`, `initialCommand` is typed into the PTY prompt but NOT
   * executed — no trailing carriage return is sent. Lets users review the
   * command (e.g. `npm install -g …`) before pressing Enter.
   */
  pasteOnly?: boolean;
  env?: Record<string, string>;
}): Promise<{ terminalId: string; success: boolean; error?: string }> {
  const { workspaceId, cwd, title, initialCommand, pasteOnly, env } = options;
  const workspaceInfo =
    workspaceId === '__root__'
      ? { workspacePath: undefined as string | undefined, scope: undefined as string | undefined }
      : await getWorkspaceInfo(workspaceId);
  let terminalCwd = cwd;
  if (workspaceInfo.scope && workspaceInfo.workspacePath) {
    terminalCwd = path.join(workspaceInfo.workspacePath, workspaceInfo.scope);
  }
  const validatedCwd = ensureDirectoryExists(terminalCwd);
  if (!validatedCwd) {
    return {
      terminalId: '',
      success: false,
      error:
        'WORKSPACE_NOT_READY: The workspace directory does not exist yet. Please wait for workspace initialization to complete.',
    };
  }
  const localId = generateTerminalId();
  const spawn = await spawnDaemonTerminal({
    id: localId,
    workspaceId,
    cwd: validatedCwd,
    cols: 80,
    rows: 24,
    env,
    title: title || 'Terminal',
  });
  if (!spawn.ok) {
    return { terminalId: '', success: false, error: spawn.error };
  }
  mainDispatch(
    terminalCreated({
      terminalId: localId,
      workspaceId,
      title: title || 'Terminal',
      cwd: validatedCwd,
      createdAt: new Date().toISOString(),
      background: !!initialCommand,
    }),
  );
  logger.info('[Terminal] Backend terminal created via daemon', {
    terminalId: localId,
    daemonTerminalId: spawn.terminal.daemonTerminalId,
    workspaceId,
    cwd: validatedCwd,
  });
  if (initialCommand) {
    const client = getBackendClient();
    // Give the shell a beat to render its prompt before feeding input,
    // matching the previous local-pty behaviour.
    setTimeout(() => {
      const payload = pasteOnly ? initialCommand : `${initialCommand}\r`;
      client
        .request('terminal.write', {
          terminalId: spawn.terminal.daemonTerminalId,
          data: encodeBase64(payload),
        })
        .catch((error) => {
          logger.error('[Terminal] initial command write failed', error as Error);
        });
    }, 500);
  }
  return { terminalId: localId, success: true };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function cleanupTerminals(): Promise<void> {
  logger.info('[Terminal] Cleaning up all terminals');
  await registry.disposeAll();
}

export function cleanupTerminalsSync(): void {
  logger.info('[Terminal] Cleaning up all terminals (sync)');
  registry.disposeAllSync();
}

export async function cleanupWorkspaceTerminals(workspaceId: WorkspaceId): Promise<void> {
  const terminals = registry.getWorkspaceTerminals(workspaceId);
  if (terminals.length === 0) return;
  logger.info('[Terminal] Cleaning up workspace terminals', {
    workspaceId,
    count: terminals.length,
  });
  await Promise.all(
    terminals.map(async (t) => {
      const ok = await registry.dispose(t.id).catch(() => false);
      if (ok) {
        mainDispatch(terminalDisposed({ terminalId: t.id, workspaceId }));
      }
    }),
  );
}

export const setupTerminalIPC = registerTerminalHandlers;

/**
 * Terminal Handler for ACP Server
 *
 * Delegates terminal lifecycle to the intentd daemon's interactive `terminal.*`
 * surface (PROTOCOL §5.13). This is a thin bridge: the daemon owns the PTY,
 * buffers scrollback, and streams output; this handler adapts the ACP
 * `terminal/*` shapes and locally buffers pushed output/exit-status so the ACP
 * client's synchronous getters and `waitForExit` still resolve.
 */

import { randomUUID } from 'crypto';
import type { TerminalExitStatus } from '../../../types';
import { Logger } from '../../../../../shared/logger';
import { getBackendClient, onBackendReconnected } from '../../../../backend/main/backend.ipc';
import type { JsonRpcNotification } from '../../../../backend/main/json-rpc-client';

const logger = new Logger('ACPTerminalHandler');

/** Default PTY dimensions for non-interactive ACP terminals. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

interface Terminal {
  id: string;
  daemonTerminalId: string;
  output: string[];
  exitStatus?: TerminalExitStatus;
  exitWaiters: Array<(status: TerminalExitStatus) => void>;
  createdAt: Date;
}

/**
 * Detect commands that are likely long-running dev servers or watchers.
 * Returns a descriptive reason if matched, or null if the command looks safe.
 */
export function isLikelyLongRunningCommand(command: string, args?: string[]): string | null {
  const full = [command, ...(args || [])].join(' ');

  if (/\b(npm|yarn|pnpm|bun)\b.*\b(run\s+)?(dev|start|serve)\b/i.test(full)) {
    return 'Dev server command detected (e.g., npm run dev). Use workspace script tools instead: list_scripts → create_script → start_script.';
  }

  if (/\b(vite|next\s+dev|nuxt\s+dev|storybook)\b/i.test(full)) {
    return 'Dev server tool detected (e.g., vite, next dev). Use workspace script tools instead: list_scripts → create_script → start_script.';
  }

  if (/\bdocker\s+compose\s+up\b/i.test(full) && !/\s-d\b/.test(full)) {
    return 'docker compose up without -d runs in foreground. Use workspace script tools instead: list_scripts → create_script → start_script.';
  }

  if (/\s--watch\b/i.test(full)) {
    return 'Command uses --watch flag (long-running). Use workspace script tools instead: list_scripts → create_script → start_script.';
  }

  return null;
}

/** POSIX-style single-quote escape for a single argv element. */
function shellQuote(arg: string): string {
  if (arg.length === 0) return "''";
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Combine command + args into a single shell command line. */
function buildCommandLine(command: string, args?: string[]): string {
  if (!args || args.length === 0) return command;
  return [command, ...args.map(shellQuote)].join(' ');
}

/** Node Buffer → base64 (main-process safe). */
function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/** base64 → utf-8 string; invalid input folds to `""`. */
function decodeBase64(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

interface DaemonEventEnvelope {
  type?: string;
  data?: {
    terminalId?: string;
    chunk?: string;
    exitCode?: number;
    signal?: string;
  };
}

function extractEvent(params: unknown): DaemonEventEnvelope | null {
  if (!params || typeof params !== 'object') return null;
  const outer = params as { event?: unknown };
  if (outer.event && typeof outer.event === 'object') return outer.event as DaemonEventEnvelope;
  return null;
}

function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === 'string' ? id : undefined;
}

export class TerminalHandler {
  private terminals = new Map<string, Terminal>();
  private byDaemonId = new Map<string, string>();
  private subscriptionId?: string;
  private notificationListener?: (n: JsonRpcNotification) => void;
  /**
   * Sticky reconnect listener, installed on first `ensureSubscription()` so we
   * never register more than one hook against `getBackendClient()`. On daemon
   * restart the in-memory subscription registry is dropped; we replay the
   * `events.subscribe(['terminal:data', 'terminal:exit'])` call so ACP
   * terminals keep streaming output / exit-status after the reconnect
   * (RESUB-1). Cleared on `dropSubscription()` (handler dispose).
   */
  private reconnectDisposer?: () => void;

  constructor(
    private workspacePath: string,
    private scope?: string,
    private workspaceId?: string,
  ) {}

  /**
   * Create a new terminal on the daemon and start streaming its output.
   */
  async createTerminal(
    command: string,
    args?: string[],
    cwd?: string | null,
    env?: Record<string, string> | null,
  ): Promise<string> {
    const terminalId = `term_${randomUUID()}`;

    const workingDir =
      cwd || (this.scope && this.workspacePath ? `${this.workspacePath}/${this.scope}` : this.workspacePath);

    const longRunningWarning = isLikelyLongRunningCommand(command, args);
    if (longRunningWarning) {
      logger.warn('Long-running command detected in terminal', {
        terminalId,
        command,
        args,
        warning: longRunningWarning,
      });
    }


    if (env && Object.keys(env).length > 0) {
      logger.warn(
        '[Terminal] `env` param is not forwarded to the daemon — `terminal.create` (PROTOCOL §5.13) does not accept env yet. Falling back to the daemon default environment.',
        { terminalId, envKeys: Object.keys(env) },
      );
    }

    logger.info('Creating terminal via terminal.create', {
      terminalId,
      command,
      args,
      cwd: workingDir,
    });

    if (!this.workspaceId) {
      throw new Error('TerminalHandler requires workspaceId to spawn terminals via the daemon');
    }

    const commandLine = buildCommandLine(command, args);

    let daemonTerminalId: string;
    try {
      const result = await getBackendClient().request<{ terminalId?: unknown }>(
        'terminal.create',
        {
          workspaceId: this.workspaceId,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
          ...(workingDir ? { cwd: workingDir } : {}),
          command: commandLine,
        },
      );
      if (typeof result?.terminalId !== 'string' || result.terminalId.length === 0) {
        throw new Error(`terminal.create returned no terminalId: ${JSON.stringify(result)}`);
      }
      daemonTerminalId = result.terminalId;
    } catch (error) {
      logger.error('[Terminal] terminal.create failed', error as Error);
      throw error;
    }

    const terminal: Terminal = {
      id: terminalId,
      daemonTerminalId,
      output: longRunningWarning ? [`⚠️ WARNING: ${longRunningWarning}\n`] : [],
      exitWaiters: [],
      createdAt: new Date(),
    };

    this.terminals.set(terminalId, terminal);
    this.byDaemonId.set(daemonTerminalId, terminalId);

    await this.ensureSubscription();

    return terminalId;
  }

  /**
   * Write data to terminal stdin (base64-framed on the wire).
   */
  async writeToTerminal(terminalId: string, data: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`Terminal not found: ${terminalId}`);
    if (terminal.exitStatus) throw new Error(`Terminal has already exited: ${terminalId}`);

    await getBackendClient().request('terminal.write', {
      terminalId: terminal.daemonTerminalId,
      data: encodeBase64(data),
    });
  }

  /**
   * Wait for terminal to exit.
   */
  async waitForExit(terminalId: string): Promise<TerminalExitStatus> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`Terminal not found: ${terminalId}`);

    if (terminal.exitStatus) return terminal.exitStatus;

    return new Promise((resolve) => {
      terminal.exitWaiters.push(resolve);
    });
  }

  /**
   * Kill a terminal on the daemon.
   */
  async killTerminal(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`Terminal not found: ${terminalId}`);
    if (terminal.exitStatus) return;

    try {
      await getBackendClient().request('terminal.kill', {
        terminalId: terminal.daemonTerminalId,
      });
      logger.info('Terminal killed', { terminalId });
    } catch (error) {
      logger.warn('[Terminal] terminal.kill failed', {
        terminalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Get buffered terminal output. */
  getOutput(terminalId: string): string[] {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`Terminal not found: ${terminalId}`);
    return terminal.output;
  }

  /** Get terminal status. */
  getStatus(terminalId: string): { running: boolean; exitStatus?: TerminalExitStatus } {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`Terminal not found: ${terminalId}`);
    return { running: !terminal.exitStatus, exitStatus: terminal.exitStatus };
  }

  /** Release a terminal (kill if running, drop local state). */
  async releaseTerminal(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    if (!terminal.exitStatus) {
      await this.killTerminal(terminalId).catch(() => {});
    }

    this.byDaemonId.delete(terminal.daemonTerminalId);
    this.terminals.delete(terminalId);
    logger.info('Terminal released', { terminalId });
  }

  /** Get all terminal IDs. */
  getAllTerminalIds(): string[] {
    return Array.from(this.terminals.keys());
  }

  /** Clean up all terminals and drop the daemon subscription. */
  async dispose(): Promise<void> {
    logger.info('Disposing all terminals', { count: this.terminals.size });

    for (const [terminalId, terminal] of this.terminals.entries()) {
      if (!terminal.exitStatus) {
        await this.killTerminal(terminalId).catch(() => {});
      }
    }

    this.terminals.clear();
    this.byDaemonId.clear();
    await this.dropSubscription();
  }

  // --------------------------------------------------------------------------
  // Daemon event routing
  // --------------------------------------------------------------------------

  private async ensureSubscription(): Promise<void> {
    if (this.subscriptionId || this.notificationListener) return;

    const client = getBackendClient();
    const listener = (n: JsonRpcNotification): void => {
      if (n.method !== 'events.event') return;
      const tag = extractSubscriptionId(n.params);
      if (this.subscriptionId !== undefined && tag !== this.subscriptionId) return;
      const event = extractEvent(n.params);
      if (!event || typeof event.type !== 'string') return;
      if (!event.type.startsWith('terminal:')) return;
      const daemonId = event.data?.terminalId;
      if (typeof daemonId !== 'string') return;
      const terminalId = this.byDaemonId.get(daemonId);
      if (!terminalId) return;
      const terminal = this.terminals.get(terminalId);
      if (!terminal) return;

      switch (event.type) {
        case 'terminal:data': {
          const chunk = decodeBase64(event.data?.chunk);
          if (chunk) terminal.output.push(chunk);
          break;
        }
        case 'terminal:exit': {
          const exitStatus: TerminalExitStatus = {
            exitCode: typeof event.data?.exitCode === 'number' ? event.data.exitCode : null,
            signal: typeof event.data?.signal === 'string' ? event.data.signal : null,
          };
          terminal.exitStatus = exitStatus;
          const waiters = terminal.exitWaiters.splice(0);
          for (const waiter of waiters) waiter(exitStatus);
          logger.info('Terminal exited', { terminalId, ...exitStatus });
          break;
        }
      }
    };
    this.notificationListener = listener;
    client.on('notification', listener);
    if (!this.reconnectDisposer) {
      this.reconnectDisposer = onBackendReconnected(() => {
        // Notification listener persists on the same singleton client across
        // reconnects — only re-issue the subscribe. Drop the stale id first
        // so the notification-scope gate does not accept a foreign
        // subscription's copies that happen to share the old id (RESUB-1).
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
        ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
      });
      this.subscriptionId = result?.subscriptionId;
    } catch (error) {
      logger.warn('[Terminal] events.subscribe failed for terminal:* — output/exit will not stream', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async dropSubscription(): Promise<void> {
    const client = getBackendClient();
    if (this.notificationListener) {
      client.off('notification', this.notificationListener);
      this.notificationListener = undefined;
    }
    if (this.reconnectDisposer) {
      try {
        this.reconnectDisposer();
      } catch {
        // Best-effort; the client may already be disposed.
      }
      this.reconnectDisposer = undefined;
    }
    if (this.subscriptionId) {
      const id = this.subscriptionId;
      this.subscriptionId = undefined;
      try {
        await client.request('events.unsubscribe', { subscriptionId: id });
      } catch (error) {
        logger.warn('[Terminal] events.unsubscribe failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

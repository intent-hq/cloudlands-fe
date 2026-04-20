/**
 * Script Process Manager
 *
 * Manages spawning, lifecycle, output buffering, auto-restart, PID tracking,
 * and URL detection for workspace scripts. One instance per workspace,
 * accessed via getScriptProcessManager(workspaceId).
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { createShellEnv } from '../../../shared/git/git-env';
import { killProcessTree } from '../../../shared/main/process-tree-kill';
import { ScriptOutputBuffer, OutputLine } from './script-output-buffer';

const logger = new Logger('ScriptProcessManager');

// ============================================================================
// Types (inline until Task 1 types are available for import)
// ============================================================================

export type ScriptMode = 'service' | 'command';

export interface WorkspaceScript {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  mode: ScriptMode;
  category?: 'dev' | 'build' | 'test' | 'lint' | 'typecheck' | 'format' | 'storybook' | 'other';
  source: 'auto-detected' | 'user';
  autoStart?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ScriptRuntimeState {
  status: 'idle' | 'running' | 'exited';
  pid?: number;
  exitCode?: number | null;
  startedAt?: string;
  stoppedAt?: string;
  restartCount: number;
  error?: string;
  detectedUrl?: string;
}

// ============================================================================
// Constants
// ============================================================================

const AUTO_RESTART_DELAY_MS = 1000;
const AUTO_RESTART_MAX_RETRIES = 5;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;
const PID_FILE_NAME = 'scripts.pid';

/** URL detection regex for common local dev server URLs. */
const URL_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)(?:\/[^\s)}\]"']*)?/gi;

// ============================================================================
// PID File Types
// ============================================================================

interface PidEntry {
  scriptId: string;
  pid: number;
  startTime: number;
}

interface PidFile {
  entries: PidEntry[];
}

// ============================================================================
// Shell Detection (mirrors terminal.ipc.ts findValidShell — not exported there)
// ============================================================================

function shellExists(shellPath: string): boolean {
  try {
    if (process.platform === 'win32') {
      fs.accessSync(shellPath, fs.constants.F_OK);
      return true;
    } else {
      fs.accessSync(shellPath, fs.constants.F_OK | fs.constants.X_OK);
      return true;
    }
  } catch {
    if (!path.isAbsolute(shellPath) && !shellPath.includes(path.sep)) {
      const pathEnv = process.env.PATH || '';
      const pathDirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');
      for (const dir of pathDirs) {
        const fullPath = path.join(dir, shellPath);
        try {
          if (process.platform === 'win32') {
            for (const ext of ['', '.exe', '.cmd', '.bat']) {
              try {
                fs.accessSync(fullPath + ext, fs.constants.F_OK);
                return true;
              } catch {
                /* continue */
              }
            }
          } else {
            fs.accessSync(fullPath, fs.constants.F_OK | fs.constants.X_OK);
            return true;
          }
        } catch {
          /* continue */
        }
      }
    }
    return false;
  }
}

function findValidShell(): string {
  if (process.platform === 'win32') {
    const windowsShells = [
      process.env.COMSPEC,
      'powershell.exe',
      'cmd.exe',
      path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe'),
    ].filter(Boolean) as string[];
    for (const shell of windowsShells) {
      if (shellExists(shell)) return shell;
    }
    return 'cmd.exe';
  }
  const shells = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
    '/usr/bin/zsh',
    '/usr/bin/bash',
    'zsh',
    'bash',
    'sh',
  ].filter(Boolean) as string[];
  for (const shell of shells) {
    if (shellExists(shell)) return shell;
  }
  return '/bin/sh';
}

function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64');
}

/**
 * Build shell args based on the detected shell type.
 * - PowerShell/pwsh: -NoProfile -NoLogo -NonInteractive -EncodedCommand <utf16le-base64>
 * - cmd.exe: /c
 * - /bin/sh: -c (no -l, not reliably supported)
 * - zsh/bash: -l -c (login shell for PATH via nvm/fnm)
 */
function getShellArgs(shell: string, command: string): string[] {
  const shellBase = path.basename(shell).toLowerCase().replace(/\.exe$/, '');

  if (process.platform === 'win32') {
    if (shellBase === 'powershell' || shellBase === 'pwsh') {
      return [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-EncodedCommand',
        encodePowerShellCommand(command),
      ];
    }
    // cmd.exe or other Windows shells
    return ['/c', command];
  }

  // Unix: /bin/sh doesn't support -l reliably
  if (shellBase === 'sh') {
    return ['-c', command];
  }
  // zsh/bash: use -l (login shell) to pick up nvm/fnm PATH
  return ['-l', '-c', command];
}

// ============================================================================
// Internal Types
// ============================================================================

interface ManagedScript {
  script: WorkspaceScript;
  state: ScriptRuntimeState;
  process: ChildProcess | null;
  buffer: ScriptOutputBuffer;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stoppedByUser: boolean;
  killTimer: ReturnType<typeof setTimeout> | null;
  processStartTime: number | null;
}

export type ScriptStateChangeCallback = (scriptId: string, state: ScriptRuntimeState) => void;
export type ScriptOutputCallback = (scriptId: string, lines: OutputLine[]) => void;

// ============================================================================
// ScriptProcessManager
// ============================================================================

export class ScriptProcessManager {
  private readonly workspaceId: string;
  private readonly workspacePath: string;
  private readonly metadataPath: string;
  private scripts: Map<string, ManagedScript> = new Map();
  private onStateChange: ScriptStateChangeCallback | null = null;
  private onOutput: ScriptOutputCallback | null = null;

  constructor(workspaceId: string, workspacePath: string, metadataPath: string) {
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
    this.metadataPath = metadataPath;
  }

  /** Set callback for state changes. */
  setStateChangeCallback(cb: ScriptStateChangeCallback): void {
    this.onStateChange = cb;
  }

  /** Set callback for output batches. */
  setOutputCallback(cb: ScriptOutputCallback): void {
    this.onOutput = cb;
  }

  /** Start a script. Creates the managed entry if needed. */
  start(script: WorkspaceScript): void {
    let managed = this.scripts.get(script.id);
    if (managed) {
      if (managed.state.status === 'running') {
        logger.warn(`[Scripts] Script "${script.name}" is already running`, { scriptId: script.id });
        return;
      }
      managed.script = script;
      managed.stoppedByUser = false;
    } else {
      managed = this.createManagedScript(script);
      this.scripts.set(script.id, managed);
    }
    this.spawnProcess(managed);
  }

  /** Stop a running script. Graceful: SIGTERM → 5s → SIGKILL. */
  async stop(scriptId: string): Promise<void> {
    const managed = this.scripts.get(scriptId);
    if (!managed) return;

    // Cancel pending restart
    if (managed.restartTimer) {
      clearTimeout(managed.restartTimer);
      managed.restartTimer = null;
    }
    managed.stoppedByUser = true;

    if (managed.state.status !== 'running' || !managed.process) {
      managed.state.status = 'idle';
      this.emitStateChange(managed);
      return;
    }

    const pid = managed.process.pid;
    if (!pid) return;

    logger.info(`[Scripts] Stopping "${managed.script.name}" (PID: ${pid})`);
    killProcessTree(pid, 'SIGTERM');

    managed.killTimer = setTimeout(() => {
      managed.killTimer = null;
      if (managed.process && !managed.process.killed) {
        logger.warn(`[Scripts] Force-killing "${managed.script.name}"`);
        const killPid = managed.process.pid;
        if (killPid) killProcessTree(killPid, 'SIGKILL');
      }
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
  }

  /** Update the in-memory script definition for a managed script. */
  updateDefinition(scriptId: string, updatedScript: WorkspaceScript): void {
    const managed = this.scripts.get(scriptId);
    if (managed) {
      managed.script = updatedScript;
    }
  }

  /** Restart a script (stop then start). */
  async restart(scriptId: string): Promise<void> {
    const managed = this.scripts.get(scriptId);
    if (!managed) return;

    await this.stop(scriptId);
    // Wait for exit
    await new Promise<void>((resolve) => {
      const check = () => {
        if (managed.state.status !== 'running') resolve();
        else setTimeout(check, 100);
      };
      check();
    });

    managed.stoppedByUser = false;
    managed.state.restartCount = 0;
    this.spawnProcess(managed);
  }

  /** Get runtime state. */
  getState(scriptId: string): ScriptRuntimeState | undefined {
    return this.scripts.get(scriptId)?.state;
  }

  /** Get output buffer. */
  getBuffer(scriptId: string): ScriptOutputBuffer | undefined {
    return this.scripts.get(scriptId)?.buffer;
  }

  /** Get all managed script IDs. */
  getManagedScriptIds(): string[] {
    return Array.from(this.scripts.keys());
  }

  /** Remove a script from management. */
  async remove(scriptId: string): Promise<void> {
    const managed = this.scripts.get(scriptId);
    if (!managed) return;
    if (managed.state.status === 'running') await this.stop(scriptId);
    managed.buffer.dispose();
    this.scripts.delete(scriptId);
    this.removePidEntry(scriptId);
  }

  /** Clean up stale PIDs on startup. Cannot reliably verify PID ownership cross-platform,
   *  so we only remove entries from the PID file without killing processes. */
  cleanupStalePids(): void {
    const pidFile = this.readPidFile();
    if (!pidFile || pidFile.entries.length === 0) return;

    logger.info(`[Scripts] Clearing ${pidFile.entries.length} stale PID entries (not killing — cannot verify PID ownership)`);
    for (const entry of pidFile.entries) {
      if (this.isProcessAlive(entry.pid)) {
        logger.warn(`[Scripts] PID ${entry.pid} (script: ${entry.scriptId}) is still alive but may have been reused by another process — skipping kill`);
      }
    }
    // Clear the PID file without killing
    this.writePidFile({ entries: [] });
  }

  /** Dispose all scripts and clean up. */
  async dispose(): Promise<void> {
    logger.info(`[Scripts] Disposing ScriptProcessManager for workspace ${this.workspaceId}`);
    const ids = Array.from(this.scripts.keys());
    for (const id of ids) {
      await this.remove(id);
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private createManagedScript(script: WorkspaceScript): ManagedScript {
    const buffer = new ScriptOutputBuffer();
    buffer.onBatch((lines) => {
      if (this.onOutput) {
        this.onOutput(script.id, lines);
      }
    });

    return {
      script,
      state: {
        status: 'idle',
        restartCount: 0,
      },
      process: null,
      buffer,
      restartTimer: null,
      stoppedByUser: false,
      killTimer: null,
      processStartTime: null,
    };
  }

  private spawnProcess(managed: ManagedScript): void {
    const { script } = managed;
    const shell = findValidShell();

    // Clear stale detected URL so a fresh run can detect a new one
    managed.state.detectedUrl = undefined;

    // Resolve cwd: script.cwd is relative to workspace repo root
    const cwd = script.cwd
      ? path.resolve(this.workspacePath, script.cwd)
      : this.workspacePath;

    // Validate cwd stays within workspace root to prevent path traversal
    const normalizedCwd = path.resolve(cwd);
    const normalizedWorkspace = path.resolve(this.workspacePath);
    if (!normalizedCwd.startsWith(normalizedWorkspace + path.sep) && normalizedCwd !== normalizedWorkspace) {
      const errMsg = `Script "${script.name}" cwd escapes workspace root: ${script.cwd}`;
      logger.error(`[Scripts] ${errMsg}`);
      managed.state.status = 'exited';
      managed.state.error = errMsg;
      this.emitStateChange(managed);
      return;
    }

    // Build environment
    const env = createShellEnv({
      FORCE_COLOR: '1',
      TERM: 'xterm-256color',
      ...script.env,
    });

    // Build shell args based on detected shell type
    const shellArgs = getShellArgs(shell, script.command);

    logger.info(`[Scripts] Spawning "${script.name}": ${shell} [command: ${script.command}]`, {
      cwd,
      scriptId: script.id,
      mode: script.mode,
    });

    try {
      const child = spawn(shell, shellArgs, {
        cwd,
        env: env as Record<string, string>,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: false,
      });

      managed.process = child;
      managed.processStartTime = Date.now();
      managed.state.status = 'running';
      managed.state.pid = child.pid;
      managed.state.startedAt = new Date().toISOString();
      managed.state.exitCode = undefined;
      managed.state.stoppedAt = undefined;
      managed.state.error = undefined;

      // Write PID file
      if (child.pid) {
        this.addPidEntry(script.id, child.pid, managed.processStartTime);
      }

      this.emitStateChange(managed);

      // Handle stdin EPIPE (child exits before consuming input)
      if (child.stdin) {
        child.stdin.on('error', (error) => {
          const msg = error instanceof Error ? error.message : String(error);
          if (!msg.includes('EPIPE')) {
            logger.error(`[Scripts] Stdin error for "${script.name}":`, error);
          }
        });
      }

      // Capture stdout
      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        managed.buffer.append(text, 'stdout');
        this.detectUrl(managed, text);
      });

      // Capture stderr
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        managed.buffer.append(text, 'stderr');
        this.detectUrl(managed, text);
      });

      // Handle exit
      child.on('exit', (code, signal) => {
        this.handleExit(managed, code, signal);
      });

      child.on('error', (error) => {
        logger.error(`[Scripts] Process error for "${script.name}":`, error);
        managed.state.status = 'exited';
        managed.state.error = error.message;
        managed.state.stoppedAt = new Date().toISOString();
        managed.process = null;
        this.removePidEntry(script.id);
        this.emitStateChange(managed);
      });
    } catch (error) {
      logger.error(`[Scripts] Failed to spawn "${script.name}":`, error as Error);
      managed.state.status = 'exited';
      managed.state.error = (error as Error).message;
      this.emitStateChange(managed);
    }
  }

  private handleExit(managed: ManagedScript, code: number | null, signal: string | null): void {
    const { script } = managed;

    // Clear kill timer if set
    if (managed.killTimer) {
      clearTimeout(managed.killTimer);
      managed.killTimer = null;
    }

    // Flush any pending output before emitting exit state
    managed.buffer.flush();

    managed.process = null;
    managed.state.status = 'exited';
    managed.state.exitCode = code;
    managed.state.stoppedAt = new Date().toISOString();
    this.removePidEntry(script.id);

    logger.info(`[Scripts] "${script.name}" exited`, {
      code,
      signal,
      stoppedByUser: managed.stoppedByUser,
      mode: script.mode,
    });

    this.emitStateChange(managed);

    // Auto-restart logic for service mode
    const runDuration = managed.processStartTime ? Date.now() - managed.processStartTime : 0;
    const tooFast = runDuration < 2000; // Less than 2 seconds = likely config error

    if (tooFast && script.mode === 'service' && !managed.stoppedByUser) {
      managed.buffer.addSeparator(
        `Exited too quickly (${runDuration}ms) — not restarting. Check your configuration.`,
      );
      managed.buffer.flush();
    } else if (
      script.mode === 'service' &&
      !managed.stoppedByUser &&
      managed.state.restartCount < AUTO_RESTART_MAX_RETRIES
    ) {
      managed.state.restartCount++;
      logger.info(
        `[Scripts] Auto-restarting "${script.name}" (attempt ${managed.state.restartCount}/${AUTO_RESTART_MAX_RETRIES})`,
      );

      managed.restartTimer = setTimeout(() => {
        managed.restartTimer = null;
        // Double-check stoppedByUser hasn't been set during the delay
        if (!managed.stoppedByUser) {
          managed.buffer.addSeparator(
            `Restarting (attempt ${managed.state.restartCount}/${AUTO_RESTART_MAX_RETRIES})`,
          );
          this.spawnProcess(managed);
        }
      }, AUTO_RESTART_DELAY_MS);
    }
  }

  private detectUrl(managed: ManagedScript, text: string): void {
    if (managed.state.detectedUrl) return; // Already detected
    if (managed.script.mode !== 'service') return; // Only for services

    // Strip ANSI escape codes before matching
    const clean = text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    const match = clean.match(URL_REGEX);
    if (match) {
      managed.state.detectedUrl = match[0];
      logger.info(`[Scripts] Detected URL for "${managed.script.name}": ${match[0]}`);
      this.emitStateChange(managed);
    }
  }

  private emitStateChange(managed: ManagedScript): void {
    if (this.onStateChange) {
      this.onStateChange(managed.script.id, { ...managed.state });
    }
  }

  // ==========================================================================
  // PID File Management
  // ==========================================================================

  private get pidFilePath(): string {
    return path.join(this.metadataPath, PID_FILE_NAME);
  }

  private readPidFile(): PidFile | null {
    try {
      const raw = fs.readFileSync(this.pidFilePath, 'utf-8');
      return JSON.parse(raw) as PidFile;
    } catch {
      return null;
    }
  }

  private writePidFile(pidFile: PidFile): void {
    try {
      fs.mkdirSync(path.dirname(this.pidFilePath), { recursive: true });
      fs.writeFileSync(this.pidFilePath, JSON.stringify(pidFile, null, 2), 'utf-8');
    } catch (error) {
      logger.error('[Scripts] Failed to write PID file:', error as Error);
    }
  }

  private addPidEntry(scriptId: string, pid: number, startTime: number): void {
    const pidFile = this.readPidFile() || { entries: [] };
    // Remove existing entry for this script
    pidFile.entries = pidFile.entries.filter((e) => e.scriptId !== scriptId);
    pidFile.entries.push({ scriptId, pid, startTime });
    this.writePidFile(pidFile);
  }

  private removePidEntry(scriptId: string): void {
    const pidFile = this.readPidFile();
    if (!pidFile) return;
    pidFile.entries = pidFile.entries.filter((e) => e.scriptId !== scriptId);
    this.writePidFile(pidFile);
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Singleton Accessor
// ============================================================================

const instances = new Map<string, ScriptProcessManager>();

/**
 * Get the ScriptProcessManager for a workspace.
 * Creates a new instance if one doesn't exist.
 */
export function getScriptProcessManager(
  workspaceId: string,
  workspacePath?: string,
  metadataPath?: string,
): ScriptProcessManager {
  let instance = instances.get(workspaceId);
  if (!instance) {
    if (!workspacePath || !metadataPath) {
      throw new Error(
        `ScriptProcessManager for workspace "${workspaceId}" not initialized. ` +
          'Provide workspacePath and metadataPath on first call.',
      );
    }
    instance = new ScriptProcessManager(workspaceId, workspacePath, metadataPath);
    instances.set(workspaceId, instance);
    logger.info(`[Scripts] Created ScriptProcessManager for workspace ${workspaceId}`);
  }
  return instance;
}

/**
 * Remove and dispose the ScriptProcessManager for a workspace.
 */
export async function disposeScriptProcessManager(workspaceId: string): Promise<void> {
  const instance = instances.get(workspaceId);
  if (instance) {
    await instance.dispose();
    instances.delete(workspaceId);
    logger.info(`[Scripts] Disposed ScriptProcessManager for workspace ${workspaceId}`);
  }
}

/**
 * Dispose all ScriptProcessManager instances (app shutdown).
 */
export async function disposeAllScriptProcessManagers(): Promise<void> {
  const ids = Array.from(instances.keys());
  for (const id of ids) {
    await disposeScriptProcessManager(id);
  }
}

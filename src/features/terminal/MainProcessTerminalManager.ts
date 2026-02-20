/**
 * Professional Terminal Implementation
 *
 * This follows the pattern used by VS Code, Hyper, and other professional
 * Electron terminal applications. Key principles:
 *
 * 1. One PTY instance per terminal (not per command)
 * 2. Direct I/O between XTerm.js and PTY
 * 3. Shell integration for command detection
 * 4. Natural terminal behavior (including echo)
 */

import type { IPty } from 'node-pty';
import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '../../shared/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TerminalOptions {
  id?: string; // Optional unique terminal ID
  workspaceId: string;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  title?: string; // Display name for the terminal
}

export interface ShellIntegrationMarkers {
  COMMAND_START: string;
  COMMAND_EXECUTED: string;
  COMMAND_FINISHED: string;
  CWD_CHANGED: string;
}

export class ProfessionalTerminal extends EventEmitter {
  private pty: IPty | null = null;
  private id: string;
  private workspaceId: string;
  private cwd: string;
  private title: string;
  private isDisposed = false;
  private isDisposing = false; // Track if dispose is in progress
  private currentCommand = '';
  private isExecutingCommand = false;
  private logger = new Logger('ProfessionalTerminal');

  // Store disposables for cleanup
  private ptyDataDisposable: { dispose: () => void } | null = null;
  private ptyExitDisposable: { dispose: () => void } | null = null;

  // Output buffer to store data for replay when renderer connects
  private outputBuffer: string[] = [];
  private outputBufferBytes = 0;
  private static readonly MAX_BUFFER_BYTES = 512 * 1024; // 512KB max buffer size

  // Timeout for graceful shutdown (ms)
  private static readonly GRACEFUL_SHUTDOWN_TIMEOUT = 1000;

  // Shell integration markers (VS Code style)
  private readonly markers: ShellIntegrationMarkers = {
    COMMAND_START: '\x1b]633;A\x07',
    COMMAND_EXECUTED: '\x1b]633;B\x07',
    COMMAND_FINISHED: '\x1b]633;D\x07',
    CWD_CHANGED: '\x1b]633;P;Cwd=',
  };

  constructor(options: TerminalOptions) {
    super();
    // Use provided ID or generate a unique one
    this.id = options.id || `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    this.workspaceId = options.workspaceId;
    this.cwd = options.cwd || process.cwd();
    this.title = options.title || 'Terminal';
  }

  /**
   * Initialize the terminal with a PTY instance
   * This should be called from the main process
   */
  async initialize(ptyInstance: IPty): Promise<void> {
    if (this.isDisposed || this.isDisposing) {
      throw new Error('Terminal is disposed');
    }

    this.pty = ptyInstance;
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for the PTY
   */
  private setupEventHandlers(): void {
    if (!this.pty) return;

    // Forward PTY output to listeners
    // Store disposable for cleanup
    this.ptyDataDisposable = this.pty.onData((data: string) => {
      // Don't process data if we're disposing
      if (this.isDisposing || this.isDisposed) return;

      this.logger.debug(`[ProfessionalTerminal] PTY data for ${this.id}: ${data.length} bytes`);

      // Buffer the data for replay when renderer connects
      this.outputBuffer.push(data);
      this.outputBufferBytes += data.length;

      // Trim buffer if it exceeds max size
      while (
        this.outputBufferBytes > ProfessionalTerminal.MAX_BUFFER_BYTES &&
        this.outputBuffer.length > 0
      ) {
        const removed = this.outputBuffer.shift();
        if (removed) {
          this.outputBufferBytes -= removed.length;
        }
      }

      // Parse for shell integration markers
      this.parseShellIntegration(data);

      // Emit raw data for XTerm.js to render
      this.emit('data', data);
    });

    // Handle PTY exit
    // Store disposable for cleanup
    this.ptyExitDisposable = this.pty.onExit(({ exitCode, signal }) => {
      // Don't process exit if we're already disposing
      if (this.isDisposing || this.isDisposed) return;

      this.emit('exit', { exitCode, signal });
      this.dispose();
    });
  }

  /**
   * Parse shell integration markers from output
   */
  private parseShellIntegration(data: string): void {
    if (data.includes(this.markers.COMMAND_START)) {
      this.isExecutingCommand = false;
      this.emit('command:start');
    }

    if (data.includes(this.markers.COMMAND_EXECUTED)) {
      this.isExecutingCommand = true;
      this.emit('command:executed', this.currentCommand);
    }

    if (data.includes(this.markers.COMMAND_FINISHED)) {
      this.isExecutingCommand = false;
      this.emit('command:finished');
    }

    // Detect CWD changes
    const cwdMatch = data.match(/\x1b\]633;P;Cwd=([^\x07]+)\x07/);
    if (cwdMatch) {
      this.cwd = cwdMatch[1];
      this.emit('cwd:changed', this.cwd);
    }
  }

  /**
   * Write data to the terminal (from user input)
   */
  write(data: string): void {
    if (!this.pty || this.isDisposed || this.isDisposing) {
      throw new Error('Cannot write to disposed terminal');
    }

    // Track commands for debugging
    if (data === '\r' || data === '\n') {
      // User pressed enter, command is being executed
      this.currentCommand = '';
    } else if (data.charCodeAt(0) === 127) {
      // Backspace
      this.currentCommand = this.currentCommand.slice(0, -1);
    } else if (data.charCodeAt(0) >= 32) {
      // Regular character
      this.currentCommand += data;
    }

    // Write directly to PTY, wrapped in try-catch to prevent native fatal errors
    // from node-pty's NAPI layer from crashing the entire process (AUGMENT-INTENT-9)
    try {
      this.pty.write(data);
    } catch (e) {
      this.logger.error(
        `Error writing to PTY ${this.id}:`,
        e instanceof Error ? e : new Error(String(e)),
      );
      // Don't re-throw - the terminal may be in a bad state but we shouldn't crash the app
    }
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    if (!this.pty || this.isDisposed || this.isDisposing) return;

    // Wrap in try-catch to prevent native fatal errors from node-pty's NAPI layer
    // from crashing the entire process (AUGMENT-INTENT-9)
    try {
      this.pty.resize(cols, rows);
    } catch (e) {
      this.logger.error(
        `Error resizing PTY ${this.id}:`,
        e instanceof Error ? e : new Error(String(e)),
      );
    }
  }

  /**
   * Get terminal information
   */
  getInfo() {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      cwd: this.cwd,
      title: this.title,
      isExecutingCommand: this.isExecutingCommand,
      currentCommand: this.currentCommand,
    };
  }

  /**
   * Set the terminal display title
   */
  setTitle(title: string) {
    this.title = title;
  }

  /**
   * Get buffered output for replay when renderer connects
   * Returns all buffered data as a single string and clears the buffer
   */
  getBufferedOutput(): string {
    const output = this.outputBuffer.join('');
    // Don't clear the buffer - allow multiple replays if needed
    return output;
  }

  /**
   * Dispose of the terminal gracefully.
   * This method properly cleans up PTY event listeners before killing to prevent
   * Napi::Error crashes during app shutdown (see AUGMENT-INTENT-8).
   *
   * The async version waits for the PTY to exit gracefully with a timeout.
   */
  async dispose(): Promise<void> {
    if (this.isDisposed || this.isDisposing) return;

    this.isDisposing = true;

    if (this.pty) {
      try {
        // 1. First, dispose of event listeners to stop receiving callbacks
        // This is critical to prevent Napi::Error during cleanup
        if (this.ptyDataDisposable) {
          try {
            this.ptyDataDisposable.dispose();
          } catch {
            // Ignore - listener may already be removed
          }
          this.ptyDataDisposable = null;
        }

        if (this.ptyExitDisposable) {
          try {
            this.ptyExitDisposable.dispose();
          } catch {
            // Ignore - listener may already be removed
          }
          this.ptyExitDisposable = null;
        }

        // 2. Wait for a microtask to let any in-flight callbacks complete
        await new Promise((resolve) => setImmediate(resolve));

        // 3. Kill the PTY with graceful shutdown
        // node-pty's kill() sends SIGTERM by default, which allows the process to cleanup
        await this.killPtyGracefully();
      } catch (e) {
        this.logger.error(
          'Error during PTY cleanup:',
          e instanceof Error ? e : new Error(String(e)),
        );
      } finally {
        this.pty = null;
      }
    }

    this.isDisposed = true;
    this.isDisposing = false;

    // Clean up the terminal's history file
    try {
      const historyFile = path.join(os.homedir(), 'intent', '.history', `terminal-${this.id}`);

      if (fs.existsSync(historyFile)) {
        fs.unlinkSync(historyFile);
        this.logger.info(`Cleaned up history file: ${historyFile}`);
      }
    } catch (error) {
      this.logger.warn('Failed to clean up history file:', error);
    }

    // Clear output buffer
    this.outputBuffer = [];
    this.outputBufferBytes = 0;

    this.emit('disposed');
    this.removeAllListeners();
  }

  /**
   * Synchronous dispose for backwards compatibility.
   * Prefer disposeAsync() for graceful shutdown.
   */
  disposeSync(): void {
    if (this.isDisposed || this.isDisposing) return;

    this.isDisposing = true;
    this.isDisposed = true;

    // Clean up listeners first
    if (this.ptyDataDisposable) {
      try {
        this.ptyDataDisposable.dispose();
      } catch {
        // Ignore
      }
      this.ptyDataDisposable = null;
    }

    if (this.ptyExitDisposable) {
      try {
        this.ptyExitDisposable.dispose();
      } catch {
        // Ignore
      }
      this.ptyExitDisposable = null;
    }

    if (this.pty) {
      try {
        this.pty.kill();
      } catch (e) {
        this.logger.error('Error killing PTY:', e instanceof Error ? e : new Error(String(e)));
      }
      this.pty = null;
    }

    // Clear output buffer
    this.outputBuffer = [];
    this.outputBufferBytes = 0;

    this.emit('disposed');
    this.removeAllListeners();
    this.isDisposing = false;
  }

  /**
   * Kill PTY gracefully with timeout.
   * Sends SIGTERM first, then SIGKILL if the process doesn't exit in time.
   */
  private async killPtyGracefully(): Promise<void> {
    if (!this.pty) return;

    const pty = this.pty;

    return new Promise<void>((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      // Set up exit handler before sending signal
      const exitHandler = pty.onExit(() => {
        try {
          exitHandler.dispose();
        } catch {
          // Ignore
        }
        clearTimeout(forceKillTimeout);
        cleanup();
      });

      // Set a timeout for force kill
      const forceKillTimeout = setTimeout(() => {
        this.logger.warn(`PTY ${this.id} did not exit gracefully, force killing`);
        try {
          exitHandler.dispose();
        } catch {
          // Ignore
        }
        try {
          // SIGKILL cannot be caught, will force termination
          pty.kill('SIGKILL');
        } catch {
          // PTY may already be dead
        }
        cleanup();
      }, ProfessionalTerminal.GRACEFUL_SHUTDOWN_TIMEOUT);

      // Send SIGTERM for graceful shutdown
      try {
        pty.kill('SIGTERM');
      } catch {
        // PTY may already be dead
        clearTimeout(forceKillTimeout);
        try {
          exitHandler.dispose();
        } catch {
          // Ignore
        }
        cleanup();
      }
    });
  }

  /**
   * Check if terminal is disposed
   */
  get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Check if terminal is currently being disposed
   */
  get disposing(): boolean {
    return this.isDisposing;
  }

  /**
   * Check if terminal is alive and can accept commands
   */
  get isAlive(): boolean {
    return !this.isDisposed && !this.isDisposing && this.pty !== null;
  }
}

/**
 * Terminal Manager for the main process
 */
export class TerminalManager {
  private terminals = new Map<string, ProfessionalTerminal>();

  /**
   * Create a new terminal
   */
  createTerminal(options: TerminalOptions): ProfessionalTerminal {
    const terminal = new ProfessionalTerminal(options);
    this.terminals.set(terminal.getInfo().id, terminal);

    // Clean up when terminal is disposed
    terminal.on('disposed', () => {
      this.terminals.delete(terminal.getInfo().id);
    });

    return terminal;
  }

  /**
   * Get a terminal by ID
   */
  getTerminal(id: string): ProfessionalTerminal | undefined {
    return this.terminals.get(id);
  }

  /**
   * Get all terminals for a workspace
   */
  getWorkspaceTerminals(workspaceId: string): ProfessionalTerminal[] {
    return Array.from(this.terminals.values()).filter(
      (t) => t.getInfo().workspaceId === workspaceId && !t.disposed,
    );
  }

  /**
   * Dispose a single terminal and remove it from the manager (async)
   */
  async disposeTerminal(id: string): Promise<boolean> {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return false;
    }
    await terminal.dispose();
    this.terminals.delete(id);
    return true;
  }

  /**
   * Dispose a single terminal synchronously (for use when async is not possible)
   */
  disposeTerminalSync(id: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return false;
    }
    terminal.disposeSync();
    this.terminals.delete(id);
    return true;
  }

  /**
   * Dispose all terminals gracefully (async).
   * This is the preferred method for app shutdown as it properly
   * cleans up PTY processes and prevents Napi::Error crashes.
   */
  async disposeAll(): Promise<void> {
    const logger = new Logger('TerminalManager');
    const count = this.terminals.size;

    if (count === 0) {
      logger.info('[TerminalManager] No terminals to dispose');
      return;
    }

    logger.info(`[TerminalManager] Disposing all ${count} terminals gracefully`);

    // Dispose all terminals in parallel with a timeout
    const disposePromises = Array.from(this.terminals.values()).map(async (terminal) => {
      try {
        await terminal.dispose();
      } catch (error) {
        logger.error('[TerminalManager] Failed to dispose terminal:', error);
      }
    });

    // Wait for all disposals with a global timeout
    const GLOBAL_TIMEOUT = 3000; // 3 seconds max for all terminals
    try {
      await Promise.race([
        Promise.all(disposePromises),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            logger.warn('[TerminalManager] Global dispose timeout reached, forcing cleanup');
            resolve();
          }, GLOBAL_TIMEOUT);
        }),
      ]);
    } catch (error) {
      logger.error('[TerminalManager] Error during batch dispose:', error);
    }

    this.terminals.clear();
    logger.info(`[TerminalManager] Disposed ${count} terminals`);
  }

  /**
   * Dispose all terminals synchronously (for emergency cleanup).
   * Use disposeAll() instead when possible for graceful shutdown.
   */
  disposeAllSync(): void {
    const logger = new Logger('TerminalManager');
    logger.info(`[TerminalManager] Disposing all ${this.terminals.size} terminals (sync)`);
    // Snapshot values to avoid modifying the map during iteration
    // (disposeSync emits 'disposed' which deletes from the map)
    const terminals = Array.from(this.terminals.values());
    for (const terminal of terminals) {
      try {
        terminal.disposeSync();
      } catch (error) {
        logger.error('[TerminalManager] Failed to dispose terminal:', error);
      }
    }
    this.terminals.clear();
  }
}

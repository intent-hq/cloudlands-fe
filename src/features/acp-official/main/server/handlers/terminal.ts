/**
 * Terminal Handler for ACP Server
 *
 * Manages terminal sessions for command execution within the workspace.
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { TerminalExitStatus } from '../../../types';
import { Logger } from '../../../../../shared/logger';
import { killChildProcessTree } from '../../../../../shared/main/process-tree-kill';

const logger = new Logger('ACPTerminalHandler');

// Centralized git environment to prevent credential prompts
import { gitEnv } from '../../../../../shared/git/git-env';

interface Terminal {
  id: string;
  process: ChildProcess;
  output: string[];
  exitStatus?: TerminalExitStatus;
  createdAt: Date;
}

export class TerminalHandler {
  private terminals = new Map<string, Terminal>();

  constructor(private workspacePath: string, private scope?: string) {}

  /**
   * Create a new terminal
   */
  async createTerminal(
    command: string,
    args?: string[],
    cwd?: string | null,
    env?: Record<string, string> | null,
  ): Promise<string> {
    const terminalId = `term_${randomUUID()}`;

    // Use workspace path as default cwd, applying scope if present
    let workingDir = cwd || this.workspacePath;
    if (!cwd && this.scope && this.workspacePath) {
      workingDir = path.join(this.workspacePath, this.scope);
    }

    // Merge environment variables with gitEnv to prevent credential prompts
    const processEnv = {
      ...process.env,
      ...gitEnv,
      ...(env || {}),
    };

    logger.info('Creating terminal', {
      terminalId,
      command,
      args,
      cwd: workingDir,
    });

    // Spawn the process
    const childProcess = spawn(command, args || [], {
      cwd: workingDir,
      env: processEnv,
      shell: true,
      windowsHide: true,
    });

    const terminal: Terminal = {
      id: terminalId,
      process: childProcess,
      output: [],
      createdAt: new Date(),
    };

    // Capture stdout
    childProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      terminal.output.push(text);
      logger.debug('Terminal stdout', { terminalId, data: text });
    });

    // Capture stderr
    childProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      terminal.output.push(text);
      logger.debug('Terminal stderr', { terminalId, data: text });
    });

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      terminal.exitStatus = {
        exitCode: code,
        signal,
      };
      logger.info('Terminal exited', { terminalId, code, signal });
    });

    // Handle process error
    childProcess.on('error', (error) => {
      logger.error('Terminal error', error, { terminalId });
      terminal.exitStatus = {
        exitCode: 1,
        signal: null,
      };
    });

    this.terminals.set(terminalId, terminal);

    return terminalId;
  }

  /**
   * Write data to terminal stdin
   */
  async writeToTerminal(terminalId: string, data: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    if (terminal.exitStatus) {
      throw new Error(`Terminal has already exited: ${terminalId}`);
    }

    terminal.process.stdin?.write(data);
  }

  /**
   * Wait for terminal to exit
   */
  async waitForExit(terminalId: string): Promise<TerminalExitStatus> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    // If already exited, return immediately
    if (terminal.exitStatus) {
      return terminal.exitStatus;
    }

    // Wait for process to exit
    return new Promise((resolve) => {
      terminal.process.on('exit', (code, signal) => {
        const exitStatus: TerminalExitStatus = {
          exitCode: code,
          signal,
        };
        terminal.exitStatus = exitStatus;
        resolve(exitStatus);
      });
    });
  }

  /**
   * Kill a terminal
   */
  async killTerminal(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    if (!terminal.exitStatus) {
      // Use killChildProcessTree because terminals are spawned with shell: true,
      // so child.kill() only kills the shell, not the actual command underneath
      await killChildProcessTree(terminal.process);
      logger.info('Terminal killed', { terminalId });
    }
  }

  /**
   * Get terminal output
   */
  getOutput(terminalId: string): string[] {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    return terminal.output;
  }

  /**
   * Get terminal status
   */
  getStatus(terminalId: string): { running: boolean; exitStatus?: TerminalExitStatus } {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`);
    }

    return {
      running: !terminal.exitStatus,
      exitStatus: terminal.exitStatus,
    };
  }

  /**
   * Release a terminal (clean up resources)
   */
  async releaseTerminal(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);

    if (!terminal) {
      return; // Already released
    }

    // Kill if still running
    if (!terminal.exitStatus) {
      await killChildProcessTree(terminal.process);
    }

    // Remove from map
    this.terminals.delete(terminalId);
    logger.info('Terminal released', { terminalId });
  }

  /**
   * Get all terminal IDs
   */
  getAllTerminalIds(): string[] {
    return Array.from(this.terminals.keys());
  }

  /**
   * Clean up all terminals
   */
  async dispose(): Promise<void> {
    logger.info('Disposing all terminals', { count: this.terminals.size });

    // Kill all running terminals and their process trees
    for (const [terminalId, terminal] of this.terminals.entries()) {
      if (!terminal.exitStatus) {
        await killChildProcessTree(terminal.process);
        logger.debug('Killed terminal on dispose', { terminalId });
      }
    }

    // Clear the map
    this.terminals.clear();
  }
}

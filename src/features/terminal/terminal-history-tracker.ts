/**
 * Terminal History Tracker
 *
 * Tracks command history and output for terminals to display in hover cards
 */

import { writable, type Writable } from 'svelte/store';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('TerminalHistoryTracker');

interface TerminalCommand {
  command: string;
  timestamp: number;
  output?: string;
}

interface TerminalHistory {
  terminalId: string;
  workspaceId: string;
  commands: TerminalCommand[];
  lastCommand?: string;
  lastOutput?: string;
  currentCommand?: string;
  currentOutput: string;
  isExecuting: boolean;
}

class TerminalHistoryTracker {
  private static instance: TerminalHistoryTracker;
  private histories = new Map<string, TerminalHistory>();
  private readonly MAX_HISTORY_SIZE = 10;
  private readonly MAX_OUTPUT_LENGTH = 500;
  private readonly STORAGE_PREFIX = 'terminal-history-';

  // Svelte store to trigger reactivity when history changes
  private _updateCounter: Writable<number> = writable(0);
  public readonly updateCounter = { subscribe: this._updateCounter.subscribe };

  private notifyUpdate(): void {
    this._updateCounter.update((n) => n + 1);
  }

  private constructor() {
    // Load saved histories from localStorage on initialization
    this.loadHistories();
  }

  static getInstance(): TerminalHistoryTracker {
    if (!TerminalHistoryTracker.instance) {
      TerminalHistoryTracker.instance = new TerminalHistoryTracker();
    }
    return TerminalHistoryTracker.instance;
  }

  /**
   * Get or create history for a terminal
   */
  private getOrCreateHistory(terminalId: string, workspaceId: string): TerminalHistory {
    let history = this.histories.get(terminalId);
    if (!history) {
      history = {
        terminalId,
        workspaceId,
        commands: [],
        currentOutput: '',
        isExecuting: false,
      };
      this.histories.set(terminalId, history);
    }
    return history;
  }

  /**
   * Track when a command starts executing
   */
  onCommandStart(terminalId: string, workspaceId: string, command: string): void {
    const history = this.getOrCreateHistory(terminalId, workspaceId);
    history.currentCommand = command;
    history.currentOutput = '';
    history.isExecuting = true;
    // Also update lastCommand immediately so hover card shows it
    history.lastCommand = command;
    this.notifyUpdate();
    logger.debug(`Command started for terminal ${terminalId}: ${command}`);
  }

  /**
   * Track terminal output
   */
  onOutput(terminalId: string, workspaceId: string, data: string): void {
    const history = this.getOrCreateHistory(terminalId, workspaceId);

    // Append to current output (limit size)
    if (history.currentOutput.length < this.MAX_OUTPUT_LENGTH) {
      history.currentOutput += data;
      if (history.currentOutput.length > this.MAX_OUTPUT_LENGTH) {
        history.currentOutput = `${history.currentOutput.substring(0, this.MAX_OUTPUT_LENGTH)}...`;
      }
    }
  }

  /**
   * Track when a command finishes
   */
  onCommandFinish(terminalId: string, workspaceId: string): void {
    const history = this.getOrCreateHistory(terminalId, workspaceId);

    if (history.currentCommand) {
      // Add to command history
      const command: TerminalCommand = {
        command: history.currentCommand,
        timestamp: Date.now(),
        output: history.currentOutput,
      };

      history.commands.push(command);

      // Limit history size
      if (history.commands.length > this.MAX_HISTORY_SIZE) {
        history.commands = history.commands.slice(-this.MAX_HISTORY_SIZE);
      }

      // Update last command/output
      history.lastCommand = history.currentCommand;
      history.lastOutput = history.currentOutput;

      // Save to localStorage
      this.saveHistory(terminalId, history);

      logger.debug(`Command finished for terminal ${terminalId}: ${history.currentCommand}`);
    }

    history.currentCommand = undefined;
    history.currentOutput = '';
    history.isExecuting = false;
    this.notifyUpdate();
  }

  /**
   * Get history for a terminal
   */
  getHistory(terminalId: string): TerminalHistory | undefined {
    return this.histories.get(terminalId);
  }

  /**
   * Get last command for a terminal
   */
  getLastCommand(terminalId: string): string | undefined {
    return this.histories.get(terminalId)?.lastCommand;
  }

  /**
   * Get last output for a terminal
   */
  getLastOutput(terminalId: string): string | undefined {
    return this.histories.get(terminalId)?.lastOutput;
  }

  /**
   * Save history to localStorage
   */
  private saveHistory(terminalId: string, history: TerminalHistory): void {
    try {
      const key = `${this.STORAGE_PREFIX}${terminalId}`;
      const data = {
        terminalId: history.terminalId,
        workspaceId: history.workspaceId,
        commands: history.commands.slice(-5), // Only save last 5 commands
        lastCommand: history.lastCommand,
        lastOutput: history.lastOutput?.substring(0, 200), // Limit output size
      };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      logger.warn('Failed to save terminal history:', error);
    }
  }

  /**
   * Load histories from localStorage
   */
  private loadHistories(): void {
    try {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(this.STORAGE_PREFIX));

      for (const key of keys) {
        try {
          const data = localStorage.getItem(key);
          if (data) {
            const parsed = JSON.parse(data);
            if (parsed.terminalId) {
              this.histories.set(parsed.terminalId, {
                ...parsed,
                currentOutput: '',
                isExecuting: false,
                commands: parsed.commands || [],
              });
            }
          }
        } catch (error) {
          logger.warn(`Failed to load terminal history for ${key}:`, error);
        }
      }

      logger.info(`Loaded ${this.histories.size} terminal histories from localStorage`);
    } catch (error) {
      logger.error('Failed to load terminal histories:', error);
    }
  }

  /**
   * Clear history for a terminal
   */
  clearHistory(terminalId: string): void {
    this.histories.delete(terminalId);
    try {
      localStorage.removeItem(`${this.STORAGE_PREFIX}${terminalId}`);
    } catch (error) {
      logger.warn('Failed to clear terminal history:', error);
    }
  }

  /**
   * Clear all histories for a workspace
   */
  clearWorkspaceHistories(workspaceId: string): void {
    const toDelete: string[] = [];

    for (const [terminalId, history] of this.histories.entries()) {
      if (history.workspaceId === workspaceId) {
        toDelete.push(terminalId);
      }
    }

    for (const terminalId of toDelete) {
      this.clearHistory(terminalId);
    }
  }
}

export const terminalHistoryTracker = TerminalHistoryTracker.getInstance();

/**
 * Renderer Process Logger
 *
 * Extends the unified logger for use in the renderer process.
 * Provides category-based logging for better organization.
 */

import {
  Logger as BaseLogger,
  type LogEntry as BaseLogEntry,
} from '$shared/logger';
import { invoke } from '$shared/generated/ipc-client';
import { LOG_CHANNELS } from '$shared/ipc';

// Configure log levels
export type AppLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

// Log categories for better organization
export enum LogCategory {
  TERMINAL = 'terminal',
  AGENT = 'agent',
  SESSION = 'session',
  WORKSPACE = 'workspace',
  FILE = 'file',
  GIT = 'git',
  SSH = 'ssh',
  SYSTEM = 'system',
  UI = 'ui',
  PERFORMANCE = 'performance',
  AUGGIE = 'auggie',
}

export interface LogEntry extends BaseLogEntry {
  category: LogCategory;
}

class RendererLogger {
  #baseLogger: BaseLogger;
  #logs: LogEntry[] = $state([]);
  #maxRecentLogs = 1000;
  #pendingLogs: LogEntry[] = [];
  #batchSize = 100;
  #flushInterval = 5000; // 5 seconds
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #ipcAvailable = false;

  constructor() {
    this.#baseLogger = new BaseLogger('Renderer', {
      enableConsole: true,
    });

    // Check if IPC is available (window.electronAPI)
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      this.#ipcAvailable = true;
    }

    // Set up periodic flush
    if (this.#ipcAvailable) {
      this.#flushTimer = setInterval(() => {
        this.#flushPendingLogs();
      }, this.#flushInterval);
    }
  }

  get logs() {
    return this.#logs;
  }

  private addToStore(entry: LogEntry) {
    this.#logs = [...this.#logs, entry];
    if (this.#logs.length > this.#maxRecentLogs) {
      this.#logs = this.#logs.slice(-this.#maxRecentLogs);
    }
  }

  private addToPendingLogs(entry: LogEntry) {
    this.#pendingLogs.push(entry);

    // Flush if batch size reached
    if (this.#pendingLogs.length >= this.#batchSize) {
      this.#flushPendingLogs();
    }
  }

  async #flushPendingLogs() {
    if (this.#pendingLogs.length === 0 || !this.#ipcAvailable) {
      return;
    }

    const logsToSend = [...this.#pendingLogs];
    this.#pendingLogs = [];

    try {
      await invoke(LOG_CHANNELS.PERSIST_RENDERER_LOGS, logsToSend);
    } catch (error) {
      // Don't crash the renderer if IPC fails
      console.error('[RendererLogger] Failed to persist logs via IPC:', error);
      // Re-add logs to pending for retry on next flush
      this.#pendingLogs = [...logsToSend, ...this.#pendingLogs];
    }
  }

  error(category: LogCategory, message: string, error?: Error | any, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      category,
      message,
      context: data,
      error:
        error instanceof Error
          ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
          : undefined,
    };

    this.#baseLogger.error(message, error instanceof Error ? error : undefined, data);
    this.addToStore(entry);
    this.addToPendingLogs(entry);
  }

  warn(category: LogCategory, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      category,
      message,
      context: data,
    };

    this.#baseLogger.warn(message, data);
    this.addToStore(entry);
    this.addToPendingLogs(entry);
  }

  info(category: LogCategory, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      category,
      message,
      context: data,
    };

    this.#baseLogger.info(message, data);
    this.addToStore(entry);
    this.addToPendingLogs(entry);
  }

  debug(category: LogCategory, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      category,
      message,
      context: data,
    };

    this.#baseLogger.debug(message, data);
    this.addToStore(entry);
    this.addToPendingLogs(entry);
  }

  verbose(category: LogCategory, message: string, data?: any) {
    // Verbose is treated as debug in the unified logger
    this.debug(category, message, data);
  }

  getLogs(): LogEntry[] {
    return [...this.#logs];
  }

  getLogsByCategory(category: LogCategory): LogEntry[] {
    return this.#logs.filter((log) => log.category === category);
  }

  getLogsByLevel(level: AppLogLevel): LogEntry[] {
    return this.#logs.filter((log) => log.level === level.toUpperCase());
  }

  clearLogs() {
    this.#logs = [];
  }
}

// Export singleton instance
export const logger = new RendererLogger();

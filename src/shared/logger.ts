/**
 * Unified Logger Module
 *
 * Provides consistent logging across the application (main process, renderer, and shared code).
 * Consolidates logging from multiple implementations into a single, flexible system.
 */

import { getLogLevel, LogLevel } from './logging-config';

// Re-export LogLevel for backward compatibility
export { LogLevel };

export interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  context?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  tags?: string[];
}

export interface LoggerOptions {
  category?: string;
  level?: LogLevel;
  enableConsole?: boolean;
  enableFile?: boolean;
  enableStorage?: boolean;
}

export class Logger {
  protected context: string;
  private level: LogLevel;
  private enableConsole: boolean;
  private enableFile: boolean;
  private enableStorage: boolean;
  private logs: LogEntry[] = [];
  private maxEntries: number = 1000;

  constructor(contextOrOptions: string | LoggerOptions = 'App', options: LoggerOptions = {}) {
    // Handle both patterns: new Logger('Context') and new Logger({ category: 'Context' })
    if (typeof contextOrOptions === 'object') {
      this.context = contextOrOptions.category ?? 'App';
      options = contextOrOptions;
    } else {
      this.context = contextOrOptions;
    }

    // Use centralized configuration for log level
    this.level = options.level ?? getLogLevel(this.context);

    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile ?? false;
    this.enableStorage = options.enableStorage ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    // Re-check the level from config in case it changed at runtime
    const currentLevel = getLogLevel(this.context);
    return level >= currentLevel;
  }

  // Helper method to check if debug logging is enabled
  isDebugEnabled(): boolean {
    return this.shouldLog(LogLevel.DEBUG);
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${this.context}] ${message}`;
  }

  protected addLogEntry(entry: LogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > this.maxEntries) {
      this.logs = this.logs.slice(-this.maxEntries);
    }

    if (this.enableStorage && typeof globalThis !== 'undefined' && globalThis.localStorage) {
      try {
        const stored = globalThis.localStorage.getItem('app_logs') || '[]';
        const allLogs = JSON.parse(stored);
        allLogs.push(entry);
        if (allLogs.length > this.maxEntries) {
          allLogs.splice(0, allLogs.length - this.maxEntries);
        }
        globalThis.localStorage.setItem('app_logs', JSON.stringify(allLogs));
      } catch {
        // Storage error, continue without persistence
      }
    }
  }

  private normalizeArgs(args: any[]): {
    context?: Record<string, any>;
    error?: Error;
    tags?: string[];
  } {
    let context: Record<string, any> | undefined;
    let error: Error | undefined;
    let tags: string[] | undefined;

    if (!args || args.length === 0) {
      return {};
    }

    // Walk all args and pick the first matching types
    for (const arg of args) {
      if (!error && arg instanceof Error) {
        error = arg;
        continue;
      }
      if (
        !context &&
        arg &&
        typeof arg === 'object' &&
        !Array.isArray(arg) &&
        !(arg instanceof Error)
      ) {
        context = arg as Record<string, any>;
        continue;
      }
      if (!tags && Array.isArray(arg) && arg.every((v) => typeof v === 'string')) {
        tags = arg as string[];
        continue;
      }
    }

    return { context, error, tags };
  }

  /**
   * Serialize context object for logging.
   * Uses a fast, shallow serialization to avoid expensive util.inspect calls.
   * Only serializes primitive values and shallow objects to reduce overhead.
   */
  private serializeContext(context: Record<string, any>): string {
    try {
      // Fast path: if context is small and simple, use JSON.stringify
      const keys = Object.keys(context);
      if (keys.length === 0) return '{}';
      if (keys.length <= 5) {
        // For small objects, do a quick shallow serialization
        const parts: string[] = [];
        for (const key of keys) {
          const value = context[key];
          if (value === undefined) continue;
          if (value === null) {
            parts.push(`${key}=null`);
          } else if (typeof value === 'string') {
            // Truncate long strings
            parts.push(`${key}="${value.length > 100 ? `${value.slice(0, 100)}...` : value}"`);
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            parts.push(`${key}=${value}`);
          } else if (Array.isArray(value)) {
            parts.push(`${key}=[${value.length} items]`);
          } else if (typeof value === 'object') {
            parts.push(`${key}={...}`);
          }
        }
        return `{ ${parts.join(', ')} }`;
      }
      // For larger objects, just show key count
      return `{ ${keys.length} keys }`;
    } catch {
      return '{...}';
    }
  }

  private consoleOutput(level: string, message: string, ...extra: any[]): void {
    if (!this.enableConsole) return;

    const colors: Record<string, string> = {
      DEBUG: '\x1b[90m', // Gray
      INFO: '\x1b[36m', // Cyan
      SUCCESS: '\x1b[32m', // Green
      WARN: '\x1b[33m', // Yellow
      ERROR: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';
    const color = colors[level] || '';
    const formatted = `${color}${message}${reset}`;

    // Filter out undefined values from extra args
    const validExtras = extra.filter((arg) => arg !== undefined && arg !== null);

    // For non-error levels, serialize context objects to avoid expensive util.inspect
    // This significantly reduces logging overhead during bulk operations
    if (level !== 'ERROR' && validExtras.length > 0) {
      const serializedExtras = validExtras.map((arg) => {
        if (arg instanceof Error) {
          return arg.message;
        }
        if (typeof arg === 'object' && arg !== null) {
          return this.serializeContext(arg);
        }
        return arg;
      });
      const args = [formatted, ...serializedExtras];
      switch (level) {
        case 'DEBUG':
          console.debug(...args);
          break;
        case 'INFO':
        case 'SUCCESS':
          console.log(...args);
          break;
        case 'WARN':
          console.warn(...args);
          break;
      }
      return;
    }

    // For ERROR level, serialize objects to JSON for better visibility
    // This ensures error details are fully visible in logs
    const processedExtras =
      level === 'ERROR'
        ? validExtras.map((arg) => {
          if (arg instanceof Error) {
            return arg;
          }
          if (typeof arg === 'object' && arg !== null) {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return this.serializeContext(arg);
            }
          }
          return arg;
        })
        : validExtras;

    const args: any[] = processedExtras.length > 0 ? [formatted, ...processedExtras] : [formatted];

    switch (level) {
      case 'DEBUG':
        console.debug(...args);
        break;
      case 'INFO':
        console.log(...args);
        break;
      case 'SUCCESS':
        console.log(...args);
        break;
      case 'WARN':
        console.warn(...args);
        break;
      case 'ERROR':
        console.error(...args);
        // If last arg looks like an Error, also print stack
        const last = validExtras.length ? validExtras[validExtras.length - 1] : undefined;
        if (last instanceof Error) {
          console.error(last.stack || last.message);
        }
        break;
    }
  }

  debug(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;

    const { context, error, tags } = this.normalizeArgs(args);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      category: this.context,
      message,
      context,
      tags,
    };

    this.addLogEntry(entry);
    const extraArgs = [context, error].filter((arg) => arg !== undefined);
    this.consoleOutput('DEBUG', this.formatMessage('DEBUG', message), ...extraArgs);
  }

  info(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const { context, error, tags } = this.normalizeArgs(args);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      category: this.context,
      message,
      context,
      tags,
    };

    this.addLogEntry(entry);
    const extraArgs = [context, error].filter((arg) => arg !== undefined);
    this.consoleOutput('INFO', this.formatMessage('INFO', message), ...extraArgs);
  }

  success(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.SUCCESS)) return;

    const { context, error, tags } = this.normalizeArgs(args);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'SUCCESS',
      category: this.context,
      message,
      context,
      tags,
    };

    this.addLogEntry(entry);
    const extraArgs = [context, error].filter((arg) => arg !== undefined);
    this.consoleOutput('SUCCESS', this.formatMessage('SUCCESS', message), ...extraArgs);
  }

  warn(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.WARN)) return;

    const { context, error, tags } = this.normalizeArgs(args);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      category: this.context,
      message,
      context,
      tags,
    };

    this.addLogEntry(entry);
    const extraArgs = [context, error].filter((arg) => arg !== undefined);
    this.consoleOutput('WARN', this.formatMessage('WARN', message), ...extraArgs);
  }

  error(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;

    const { context, error, tags } = this.normalizeArgs(args);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      category: this.context,
      message,
      context,
      tags,
    };

    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    this.addLogEntry(entry);
    const extraArgs = [context, error].filter((arg) => arg !== undefined);
    this.consoleOutput('ERROR', this.formatMessage('ERROR', message), ...extraArgs);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`, {
      level: this.level,
      enableConsole: this.enableConsole,
      enableFile: this.enableFile,
      enableStorage: this.enableStorage,
    });
  }

  getLogs(options?: { level?: string; since?: Date; tags?: string[]; limit?: number }): LogEntry[] {
    let filtered = [...this.logs];

    if (options?.level) {
      filtered = filtered.filter((log) => log.level === options.level);
    }

    if (options?.since) {
      filtered = filtered.filter((log) => new Date(log.timestamp) >= options.since!);
    }

    if (options?.tags && options.tags.length > 0) {
      filtered = filtered.filter((log) => options.tags!.some((tag) => log.tags?.includes(tag)));
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  clearLogs(): void {
    this.logs = [];
  }
}

// Default logger instance
export const logger = new Logger('App', {
  enableConsole: true,
  enableStorage: typeof globalThis !== 'undefined' && globalThis.localStorage !== undefined,
});

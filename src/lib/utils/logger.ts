import { logger as clientLogger } from './client-logger';
import {
  getLogLevel as getConfigLogLevel,
  LogLevel as ConfigLogLevel,
} from '../../shared/logging-config';

/**
 * Specialized Client-Side Logger
 *
 * This is a specialized implementation for the renderer process with:
 * - Color-coded console output
 * - Grouped error/context display
 * - Local storage persistence
 * - Category-based filtering
 *
 * For server-side logging, use src/main/utils/logger.ts
 * For shared logging utilities, use src/shared/logger.ts
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
}

// Map from string LogLevel to numeric ConfigLogLevel
const LOG_LEVEL_TO_CONFIG: Record<LogLevel, ConfigLogLevel> = {
  [LogLevel.DEBUG]: ConfigLogLevel.DEBUG,
  [LogLevel.INFO]: ConfigLogLevel.INFO,
  [LogLevel.SUCCESS]: ConfigLogLevel.SUCCESS,
  [LogLevel.WARN]: ConfigLogLevel.WARN,
  [LogLevel.ERROR]: ConfigLogLevel.ERROR,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
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
  category: string;
  enabled?: boolean;
  minLevel?: LogLevel;
  maxEntries?: number;
  persistToStorage?: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.SUCCESS]: 2,
  [LogLevel.WARN]: 3,
  [LogLevel.ERROR]: 4,
};

class LoggerService {
  private logs: LogEntry[] = [];
  private maxEntries: number = 1000;
  private minLevel: LogLevel = LogLevel.DEBUG;
  private persistToStorage: boolean = true;
  private storageKey = 'app_logs';

  constructor() {
    if (typeof window !== 'undefined' && this.persistToStorage) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (error) {
      clientLogger.error(
        'Failed to load logs from storage:',
        error instanceof Error ? error : undefined,
      );
    }
  }

  private saveToStorage() {
    if (typeof window !== 'undefined' && this.persistToStorage) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.logs));
      } catch (error) {
        clientLogger.error(
          'Failed to save logs to storage:',
          error instanceof Error ? error : undefined,
        );
      }
    }
  }

  private addLog(entry: LogEntry) {
    // Check if log level meets minimum threshold
    if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    this.logs.push(entry);

    // Trim logs if exceeding max entries
    if (this.logs.length > this.maxEntries) {
      this.logs = this.logs.slice(-this.maxEntries);
    }

    this.saveToStorage();

    // Console output with color coding
    this.consoleOutput(entry);
  }

  private consoleOutput(entry: LogEntry) {
    const colors: Record<LogLevel, string> = {
      [LogLevel.DEBUG]: '#6B7280',
      [LogLevel.INFO]: '#3B82F6',
      [LogLevel.SUCCESS]: '#10B981',
      [LogLevel.WARN]: '#F59E0B',
      [LogLevel.ERROR]: '#EF4444',
    };

    const color = colors[entry.level];
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const prefix = `[${timestamp}] [${entry.level}] [${entry.category}]`;

    const style = `color: ${color}; font-weight: bold;`;

    if (entry.error) {
      console.groupCollapsed(`%c${prefix} ${entry.message}`, style);
      console.error(entry.error);
      if (entry.context && Object.keys(entry.context).length > 0) {
        console.log('Context:', entry.context);
      }
      console.groupEnd();
    } else if (entry.context && Object.keys(entry.context).length > 0) {
      console.groupCollapsed(`%c${prefix} ${entry.message}`, style);
      console.log('Context:', entry.context);
      console.groupEnd();
    } else {
      // Use native console methods directly to avoid recursion
      switch (entry.level) {
        case LogLevel.DEBUG:
          console.debug(`%c${prefix} ${entry.message}`, style);
          break;
        case LogLevel.ERROR:
          console.error(`%c${prefix} ${entry.message}`, style);
          break;
        case LogLevel.WARN:
          console.warn(`%c${prefix} ${entry.message}`, style);
          break;
        default:
          console.log(`%c${prefix} ${entry.message}`, style);
          break;
      }
    }
  }

  public log(
    level: LogLevel,
    category: string,
    message: string,
    context?: Record<string, any>,
    error?: Error,
    tags?: string[],
  ) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      context,
      tags,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    this.addLog(entry);
  }

  public getLogs(options?: {
    category?: string;
    level?: LogLevel;
    since?: Date;
    tags?: string[];
    limit?: number;
  }): LogEntry[] {
    let filtered = [...this.logs];

    if (options?.category) {
      filtered = filtered.filter((log) => log.category === options.category);
    }

    if (options?.level) {
      filtered = filtered.filter((log) => log.level === options.level);
    }

    if (options?.since) {
      const since = options.since;
      filtered = filtered.filter((log) => new Date(log.timestamp) >= since);
    }

    if (options?.tags && options.tags.length > 0) {
      const tags = options.tags;
      filtered = filtered.filter((log) => tags.some((tag) => log.tags?.includes(tag)));
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  public exportLogs(format: 'json' | 'text' | 'markdown' = 'json'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(this.logs, null, 2);

      case 'text':
        return this.logs
          .map((log) => {
            const timestamp = new Date(log.timestamp).toISOString();
            let output = `[${timestamp}] [${log.level}] [${log.category}] ${log.message}`;

            if (log.context) {
              output += `\nContext: ${JSON.stringify(log.context, null, 2)}`;
            }

            if (log.error) {
              output += `\nError: ${log.error.name}: ${log.error.message}`;
              if (log.error.stack) {
                output += `\nStack: ${log.error.stack}`;
              }
            }

            if (log.tags && log.tags.length > 0) {
              output += `\nTags: ${log.tags.join(', ')}`;
            }

            return output;
          })
          .join('\n\n');

      case 'markdown':
        let md = '# Application Logs\n\n';
        md += `Generated: ${new Date().toISOString()}\n\n`;
        md += `Total Entries: ${this.logs.length}\n\n`;

        const groupedByCategory = this.logs.reduce(
          (acc, log) => {
            if (!acc[log.category]) {
              acc[log.category] = [];
            }
            acc[log.category].push(log);
            return acc;
          },
          {} as Record<string, LogEntry[]>,
        );

        for (const [category, logs] of Object.entries(groupedByCategory)) {
          md += `## ${category}\n\n`;

          for (const log of logs) {
            const timestamp = new Date(log.timestamp).toLocaleTimeString();
            const emoji = {
              [LogLevel.DEBUG]: '🔍',
              [LogLevel.INFO]: 'ℹ️',
              [LogLevel.SUCCESS]: '✅',
              [LogLevel.WARN]: '⚠️',
              [LogLevel.ERROR]: '❌',
            }[log.level];

            md += `### ${emoji} ${log.level} - ${timestamp}\n\n`;
            md += `**Message:** ${log.message}\n\n`;

            if (log.context) {
              md += '**Context:**\n```json\n';
              md += JSON.stringify(log.context, null, 2);
              md += '\n```\n\n';
            }

            if (log.error) {
              md += '**Error:**\n```\n';
              md += `${log.error.name}: ${log.error.message}\n`;
              if (log.error.stack) {
                md += log.error.stack;
              }
              md += '\n```\n\n';
            }

            if (log.tags && log.tags.length > 0) {
              md += `**Tags:** ${log.tags.map((t) => `\`${t}\``).join(', ')}\n\n`;
            }

            md += '---\n\n';
          }
        }

        return md;
    }
  }

  public clear() {
    this.logs = [];
    this.saveToStorage();
  }

  public setMinLevel(level: LogLevel) {
    this.minLevel = level;
  }

  public setMaxEntries(max: number) {
    this.maxEntries = max;
    if (this.logs.length > max) {
      this.logs = this.logs.slice(-max);
      this.saveToStorage();
    }
  }
}

// Singleton instance
const loggerService = new LoggerService();

// Logger class for category-specific logging
export class Logger {
  private category: string;
  private enabled: boolean;

  constructor(options: LoggerOptions) {
    this.category = options.category;
    this.enabled = options.enabled !== false;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false;
    // Check centralized logging config for this category
    const configLevel = getConfigLogLevel(this.category);
    const numericLevel = LOG_LEVEL_TO_CONFIG[level];
    return numericLevel >= configLevel;
  }

  debug(message: string, context?: Record<string, any>, tags?: string[]) {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    loggerService.log(LogLevel.DEBUG, this.category, message, context, undefined, tags);
  }

  info(message: string, context?: Record<string, any>, tags?: string[]) {
    if (!this.shouldLog(LogLevel.INFO)) return;
    loggerService.log(LogLevel.INFO, this.category, message, context, undefined, tags);
  }

  success(message: string, context?: Record<string, any>, tags?: string[]) {
    if (!this.shouldLog(LogLevel.SUCCESS)) return;
    loggerService.log(LogLevel.SUCCESS, this.category, message, context, undefined, tags);
  }

  warn(message: string, context?: Record<string, any>, tags?: string[]) {
    if (!this.shouldLog(LogLevel.WARN)) return;
    loggerService.log(LogLevel.WARN, this.category, message, context, undefined, tags);
  }

  error(message: string, error?: Error, context?: Record<string, any>, tags?: string[]) {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    loggerService.log(LogLevel.ERROR, this.category, message, context, error, tags);
  }
}

// Export singleton methods
export const getLogs = loggerService.getLogs.bind(loggerService);
export const exportLogs = loggerService.exportLogs.bind(loggerService);
export const clearLogs = loggerService.clear.bind(loggerService);
export const setMinLogLevel = loggerService.setMinLevel.bind(loggerService);
export const setMaxLogEntries = loggerService.setMaxEntries.bind(loggerService);

// Export a default logger instance for compatibility
export const logger = new Logger({ category: 'default' });

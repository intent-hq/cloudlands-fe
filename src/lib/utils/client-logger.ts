/**
 * Client-side Logger for Svelte Components
 *
 * Provides consistent logging in the renderer process.
 * Can be configured to send logs to the main process if needed.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Cap on serialized data embedded in the message string (main-process forwarder caps lines at 4096 chars). */
const MAX_SERIALIZED_DATA_LENGTH = 2000;
const TRUNCATION_MARKER = '… [truncated]';

/**
 * Safely serialize a data payload to compact JSON for embedding in the log
 * message string. Handles circular references, Errors, and BigInt; falls back
 * to a placeholder instead of throwing.
 */
function serializeData(data: unknown): string {
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(data, (_key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (value instanceof Error) {
        return { name: value.name, message: value.message };
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[circular]';
        }
        seen.add(value);
      }
      return value;
    });
    if (json === undefined) {
      return '[unserializable]';
    }
    if (json.length > MAX_SERIALIZED_DATA_LENGTH) {
      return `${json.slice(0, MAX_SERIALIZED_DATA_LENGTH)}${TRUNCATION_MARKER}`;
    }
    return json;
  } catch {
    return '[unserializable]';
  }
}

export interface LoggerOptions {
  name: string;
  level?: LogLevel;
  sendToMain?: boolean;
}

export class ClientLogger {
  private name: string;
  private level: LogLevel;
  private sendToMain: boolean;

  private static logLevels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(options: LoggerOptions | string) {
    if (typeof options === 'string') {
      this.name = options;
      this.level = 'info';
      this.sendToMain = false;
    } else {
      this.name = options.name;
      this.level = options.level || 'info';
      this.sendToMain = options.sendToMain || false;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return ClientLogger.logLevels[level] >= ClientLogger.logLevels[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.name}]`;

    if (data !== undefined) {
      return `${prefix} ${message} ${serializeData(data)}`;
    }

    return `${prefix} ${message}`;
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message, data);

    // Log to console - only pass data if it's actually defined
    switch (level) {
      case 'debug':
        if (data !== undefined) {
          console.debug(formattedMessage, data);
        } else {
          console.debug(formattedMessage);
        }
        break;
      case 'info':
        if (data !== undefined) {
          console.info(formattedMessage, data);
        } else {
          console.info(formattedMessage);
        }
        break;
      case 'warn':
        if (data !== undefined) {
          console.warn(formattedMessage, data);
        } else {
          console.warn(formattedMessage);
        }
        break;
      case 'error':
        if (data !== undefined) {
          console.error(formattedMessage, data);
        } else {
          console.error(formattedMessage);
        }
        break;
    }

    // Send to main process if configured
    if (this.sendToMain && typeof window !== 'undefined' && (window as any).electronAPI?.sendLog) {
      (window as any).electronAPI.sendLog({
        level,
        name: this.name,
        message,
        data,
        timestamp: new Date().toISOString(),
      });
    }
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | any, data?: any): void {
    if (error instanceof Error) {
      this.log('error', message, {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
        ...data,
      });
    } else if (error !== undefined) {
      this.log('error', message, { error, ...data });
    } else {
      this.log('error', message, data);
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Create a child logger with a sub-name
   */
  child(subName: string): ClientLogger {
    return new ClientLogger({
      name: `${this.name}:${subName}`,
      level: this.level,
      sendToMain: this.sendToMain,
    });
  }
}

// Export a factory function for convenience
export function createLogger(name: string): ClientLogger {
  return new ClientLogger(name);
}

// Export a default logger instance for backward compatibility
export const logger = new ClientLogger('default');

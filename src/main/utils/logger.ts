/**
 * Main Process Logger
 *
 * Extends the unified logger with file persistence for the main process.
 * Re-exports the unified logger for consistency across the application.
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Logger as BaseLogger, LogLevel } from '../../shared/logger';
import type { LogEntry, LoggerOptions } from '../../shared/logger';

// Conditionally import electron only if available
let app: any;
(async () => {
  try {
    const electron = await import('electron');
    app = electron.app;
  } catch (e) {
    // Running outside of Electron (e.g., in MCP server)
    app = null;
  }
})();

// Re-export for backward compatibility
export { LogLevel } from '$shared/logger';
export type { LogEntry, LoggerOptions } from '$shared/logger';

/**
 * Extended Logger for main process with file persistence
 */
export class Logger extends BaseLogger {
  private logFile: string;

  constructor(context: string, options?: LoggerOptions) {
    super(context, {
      enableConsole: true,
      enableFile: true,
      ...options,
    });

    // Setup log file
    // Use app.getPath if in Electron, otherwise use home directory
    let logDir: string;
    if (app && app.getPath) {
      logDir = join(app.getPath('userData'), 'logs');
    } else {
      // Fallback for non-Electron environments (like MCP server)
      logDir = join(homedir(), 'intent', 'logs');
    }

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const date = new Date().toISOString().split('T')[0];
    this.logFile = join(logDir, `app-${date}.log`);
  }

  private writeToFile(message: string): void {
    try {
      appendFileSync(this.logFile, `${message}\n`);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  // Override parent methods to add file persistence
  debug(message: string, context?: Record<string, any>, tags?: string[]): void {
    super.debug(message, context, tags);
    this.writeToFile(`[DEBUG] [${this.context}] ${message}`);
  }

  info(message: string, context?: Record<string, any>, tags?: string[]): void {
    super.info(message, context, tags);
    this.writeToFile(`[INFO] [${this.context}] ${message}`);
  }

  success(message: string, context?: Record<string, any>, tags?: string[]): void {
    super.success(message, context, tags);
    this.writeToFile(`[SUCCESS] [${this.context}] ${message}`);
  }

  warn(message: string, context?: Record<string, any>, tags?: string[]): void {
    super.warn(message, context, tags);
    this.writeToFile(`[WARN] [${this.context}] ${message}`);
  }

  error(message: string, error?: Error, context?: Record<string, any>, tags?: string[]): void {
    super.error(message, error, context, tags);
    const errorStr = error ? ` - ${error.message}` : '';
    this.writeToFile(`[ERROR] [${this.context}] ${message}${errorStr}`);
  }

  // Get the log file path
  getLogFilePath(): string {
    return this.logFile;
  }
}

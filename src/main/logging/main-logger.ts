/**
 * Main process logging configuration
 */

import log from 'electron-log/main';
import path from 'path';
import { app } from 'electron';

// Configure main process logging
export function setupMainLogger() {
  // Set log file location - defer until app is ready
  let logPath: string | undefined;

  // Set log levels
  if (log.transports.file) {
    log.transports.file.level = 'debug';
    // Use a function that will be evaluated when needed
    log.transports.file.resolvePathFn = () => {
      if (!logPath && app && app.isReady()) {
        logPath = path.join(app.getPath('userData'), 'logs');
      }
      return path.join(logPath || '.', 'main.log');
    };
    log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB

    // Format logs for better readability
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{processType}] [{level}] {text}';
  }

  log.transports.console.level = 'info';
  log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';

  // Log unhandled errors
  log.errorHandler.startCatching();

  // Log app events - only set up if app is available
  if (app) {
    app.on('ready', () => {
      if (!logPath) {
        logPath = path.join(app.getPath('userData'), 'logs');
      }
      log.info('[SYSTEM] Electron app ready');
      log.info('[SYSTEM] Log directory:', logPath);
    });

    app.on('window-all-closed', () => {
      log.info('[SYSTEM] All windows closed');
    });

    app.on('before-quit', () => {
      log.info('[SYSTEM] App quitting');
    });
  }

  // Log system info
  log.info('[SYSTEM] Starting Intent by Augment');
  log.info('[SYSTEM] Electron version:', process.versions.electron);
  log.info('[SYSTEM] Node version:', process.versions.node);
  log.info('[SYSTEM] Chrome version:', process.versions.chrome);
  log.info('[SYSTEM] Platform:', process.platform);
  log.info('[SYSTEM] Architecture:', process.arch);

  return log;
}

// Export the configured logger
export const mainLogger = log;

// Helper functions for consistent logging
export const logIPC = (channel: string, data?: any) => {
  mainLogger.debug(`[IPC] ${channel}`, data ? JSON.stringify(data) : '');
};

export const logError = (context: string, error: Error | any) => {
  if (error instanceof Error) {
    mainLogger.error(`[${context}] ${error.message}`, error.stack);
  } else {
    mainLogger.error(`[${context}]`, error);
  }
};

export const logInfo = (context: string, message: string, data?: any) => {
  mainLogger.info(`[${context}] ${message}`, data ? JSON.stringify(data) : '');
};

export const logDebug = (context: string, message: string, data?: any) => {
  mainLogger.debug(`[${context}] ${message}`, data ? JSON.stringify(data) : '');
};

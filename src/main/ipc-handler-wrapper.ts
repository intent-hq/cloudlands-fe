/**
 * IPC Handler Wrapper
 *
 * Wraps ipcMain to track all handler registrations and invocations.
 * Helps identify missing handlers and validation errors.
 */

import path from 'path';
import { ipcDebugTracker } from '../shared/main/ipc-debug-tracker';
import { Logger } from '../shared/logger';
import { writeJsonAsync } from '../shared/main/async-utils';

const logger = new Logger('IPCHandlerWrapper');

// Use the global registered handlers set that was created in index.ts
const registeredHandlers: Set<string> =
  (global as any).__ipcRegisteredHandlers || new Set<string>();

/**
 * Get all registered handlers
 */
function getRegisteredHandlers(): string[] {
  return Array.from(registeredHandlers).sort();
}

/**
 * Intercept IPC invocations to detect missing handlers
 * This should be called early in the main process
 * Note: The actual ipcMain.handle override is done in index.ts before any imports
 */
export function setupIPCInterceptor(): void {
  // Listen for IPC-related unhandled rejections to detect missing handlers
  process.on('unhandledRejection', (reason: any) => {
    // i18n-ignore (matches Electron's internal English error message)
    if (reason?.message?.includes('No handler registered')) {
      const match = reason.message.match(/No handler registered for '([^']+)'/);
      if (match) {
        const channel = match[1];
        logger.error(`Missing IPC handler: ${channel}`);
        ipcDebugTracker.trackMissingHandler(channel);
      }
    }
  });
}

/**
 * Export debug info to file
 * PERF: Converted to async to prevent blocking main thread
 */
export async function exportHandlerDebugInfo(): Promise<void> {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    registeredHandlers: getRegisteredHandlers(),
    count: registeredHandlers.size,
  };

  const debugPath = ipcDebugTracker.getFilePaths().debug;
  const dir = path.dirname(debugPath);
  const handlersPath = path.join(dir, 'registered-handlers.json');

  await writeJsonAsync(handlersPath, debugInfo);
  logger.info(`Handler debug info exported to: ${handlersPath}`);
}

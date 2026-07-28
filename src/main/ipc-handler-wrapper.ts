/**
 * IPC Handler Wrapper
 *
 * Wraps ipcMain to track all handler registrations and invocations.
 * Helps identify missing handlers and validation errors.
 */

import path from 'path';
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { ipcDebugTracker } from '../shared/main/ipc-debug-tracker';
import { Logger } from '../shared/logger';
import { writeJsonAsync } from '../shared/main/async-utils';

const logger = new Logger('IPCHandlerWrapper');

// Use the global registered handlers set that was created in index.ts
const registeredHandlers: Set<string> =
  (global as any).__ipcRegisteredHandlers || new Set<string>();

/**
 * Enhanced IPC handler registration that tracks handlers
 */
export function registerHandler(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any,
): void {
  // Track registration
  registeredHandlers.add(channel);
  logger.debug(`Registering handler for channel: ${channel}`);

  // Wrap the handler to add tracking
  const wrappedHandler = async (event: IpcMainInvokeEvent, ...args: any[]) => {
    try {
      // Track the call
      ipcDebugTracker.trackCall(channel, args[0], 'main');

      // Call the original handler
      const result = await handler(event, ...args);

      // Track success
      ipcDebugTracker.trackSuccess(channel, result);

      return result;
    } catch (error) {
      // Track error
      logger.error(`Handler error on channel ${channel}:`, error as Error);
      throw error;
    }
  };

  // Register with Electron
  ipcMain.handle(channel, wrappedHandler);
}

/**
 * Check if a handler is registered
 */
export function isHandlerRegistered(channel: string): boolean {
  return registeredHandlers.has(channel);
}

/**
 * Get all registered handlers
 */
export function getRegisteredHandlers(): string[] {
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
 * Log handler registration status
 */
export function logHandlerStatus(): void {
  const handlers = getRegisteredHandlers();

  console.log('\n📡 Registered IPC Handlers\n');
  console.log(`Total: ${handlers.length}\n`);

  // Group by prefix
  const grouped = new Map<string, string[]>();

  handlers.forEach((handler) => {
    const prefix = handler.split(':')[0];
    const existing = grouped.get(prefix);
    if (existing) {
      existing.push(handler);
    } else {
      grouped.set(prefix, [handler]);
    }
  });

  // Log grouped
  grouped.forEach((channels, prefix) => {
    console.log(`${prefix}: (${channels.length})`);
    channels.forEach((channel) => {
      console.log(`  • ${channel}`);
    });
    console.log('');
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

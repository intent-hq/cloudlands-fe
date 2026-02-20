/**
 * IPC Cleanup Manager
 *
 * Centralized management of IPC handler cleanup to prevent memory leaks.
 * Automatically patches ipcMain.handle to track all handlers.
 */

import { ipcMain } from 'electron';
import { Logger } from '../shared/logger';

const logger = new Logger('IPCCleanupManager');

// Store original ipcMain.handle
const originalHandle = ipcMain.handle.bind(ipcMain);

interface IPCSetupFunction {
  name: string;
  cleanup: () => void;
}

class IPCCleanupManager {
  private setupFunctions: IPCSetupFunction[] = [];
  private allHandlers: Set<string> = new Set();
  private isPatched = false;

  /**
   * Patch ipcMain.handle to automatically track all handlers
   */
  patchIPCMain(): void {
    if (this.isPatched) return;

    // Check if handle is already patched (non-configurable)
    const descriptor = Object.getOwnPropertyDescriptor(ipcMain, 'handle');
    if (descriptor && (!descriptor.configurable || descriptor.writable === false)) {
      logger.debug('ipcMain.handle is non-configurable or non-writable, skipping patch');
      this.isPatched = true;
      return;
    }

    try {
      (ipcMain.handle as any) = (channel: string, handler: any) => {
        this.allHandlers.add(channel);
        return originalHandle(channel, handler);
      };
      this.isPatched = true;
      logger.debug('ipcMain.handle patched for automatic handler tracking');
    } catch (error) {
      logger.warn('Failed to patch ipcMain.handle, it may already be patched', error);
      this.isPatched = true;
    }
  }

  /**
   * Create a handler wrapper that tracks the channel
   */
  createHandler<T extends any[], R>(
    channel: string,
    handler: (...args: T) => Promise<R> | R,
  ): (...args: T) => Promise<R> | R {
    this.allHandlers.add(channel);
    return handler;
  }

  /**
   * Register an IPC setup function with its cleanup
   */
  registerSetup(name: string, cleanup: () => void): void {
    this.setupFunctions.push({ name, cleanup });
    logger.debug(`Registered IPC setup: ${name}`);
  }

  /**
   * Track a handler channel for cleanup
   */
  trackHandler(channel: string): void {
    this.allHandlers.add(channel);
  }

  /**
   * Cleanup all IPC handlers
   */
  cleanupAll(): void {
    logger.info('Starting IPC cleanup', {
      setupCount: this.setupFunctions.length,
      handlerCount: this.allHandlers.size,
    });

    // Execute all registered cleanup functions
    for (const { name, cleanup } of this.setupFunctions) {
      try {
        cleanup();
        logger.debug(`Cleaned up IPC setup: ${name}`);
      } catch (error) {
        logger.error(`Failed to cleanup IPC setup: ${name}`, error as Error);
      }
    }

    // Remove all tracked handlers
    for (const channel of this.allHandlers) {
      try {
        ipcMain.removeHandler(channel);
      } catch (error) {
        logger.debug(`Handler already removed or not found: ${channel}`);
      }
    }

    this.setupFunctions = [];
    this.allHandlers.clear();
    logger.info('IPC cleanup completed');
  }

  /**
   * Get cleanup statistics
   */
  getStats() {
    return {
      setupFunctions: this.setupFunctions.length,
      handlers: this.allHandlers.size,
    };
  }
}

export const ipcCleanupManager = new IPCCleanupManager();

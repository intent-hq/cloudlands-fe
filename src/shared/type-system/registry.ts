/**
 * IPC Handler Registry
 *
 * Tracks all registered IPC handlers and provides compile-time and runtime
 * checking to ensure all required handlers are registered.
 */

import { ipcMain } from 'electron';
import { Logger } from '../logger';
import type { IpcContractKey } from './contracts';

const logger = new Logger('HandlerRegistry');

// ============================================================================
// Handler Registry
// ============================================================================

class HandlerRegistry {
  private registeredHandlers = new Set<string>();
  private requiredHandlers = new Set<string>();
  private handlerMetadata = new Map<string, HandlerMetadata>();
  private handlerCleanups = new Map<string, () => void>();

  /**
   * Register a handler as required
   */
  require(channel: string, metadata?: HandlerMetadata): void {
    this.requiredHandlers.add(channel);
    if (metadata) {
      this.handlerMetadata.set(channel, metadata);
    }
  }

  /**
   * Mark a handler as registered
   */
  register(channel: string): void {
    this.registeredHandlers.add(channel);
    logger.debug(`Handler registered: ${channel}`);
  }

  /**
   * Register a handler with cleanup function
   */
  registerWithCleanup(channel: string, cleanup: () => void): void {
    this.register(channel);
    this.handlerCleanups.set(channel, cleanup);
  }

  /**
   * Check if a handler is registered
   */
  isRegistered(channel: string): boolean {
    return this.registeredHandlers.has(channel);
  }

  /**
   * Remove a handler and call its cleanup function
   */
  unregister(channel: string): void {
    const cleanup = this.handlerCleanups.get(channel);
    if (cleanup) {
      try {
        cleanup();
        logger.debug(`Handler cleanup executed: ${channel}`);
      } catch (error) {
        logger.error(`Handler cleanup failed: ${channel}`, error as Error);
      }
      this.handlerCleanups.delete(channel);
    }
    this.registeredHandlers.delete(channel);
  }

  /**
   * Cleanup all handlers
   */
  cleanupAll(): void {
    for (const [channel] of this.handlerCleanups) {
      this.unregister(channel);
    }
    logger.info('All handlers cleaned up');
  }

  /**
   * Get all unregistered required handlers
   */
  getUnregistered(): string[] {
    const unregistered: string[] = [];
    for (const channel of this.requiredHandlers) {
      if (!this.registeredHandlers.has(channel)) {
        unregistered.push(channel);
      }
    }
    return unregistered;
  }

  /**
   * Validate all required handlers are registered
   */
  validate(): ValidationReport {
    const unregistered = this.getUnregistered();
    const report: ValidationReport = {
      valid: unregistered.length === 0,
      totalRequired: this.requiredHandlers.size,
      totalRegistered: this.registeredHandlers.size,
      unregistered,
      metadata: {},
    };

    // Add metadata for unregistered handlers
    for (const channel of unregistered) {
      const meta = this.handlerMetadata.get(channel);
      if (meta) {
        report.metadata[channel] = meta;
      }
    }

    return report;
  }

  /**
   * Clear the registry (useful for testing)
   */
  clear(): void {
    this.cleanupAll();
    this.registeredHandlers.clear();
    this.requiredHandlers.clear();
    this.handlerMetadata.clear();
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    return {
      required: this.requiredHandlers.size,
      registered: this.registeredHandlers.size,
      unregistered: this.getUnregistered().length,
      handlers: Array.from(this.registeredHandlers),
    };
  }
}

// ============================================================================
// Types
// ============================================================================

export interface HandlerMetadata {
  description?: string;
  category?: string;
  requiresAuth?: boolean;
  rateLimit?: number;
  deprecated?: boolean;
  replacement?: string;
}

export interface ValidationReport {
  valid: boolean;
  totalRequired: number;
  totalRegistered: number;
  unregistered: string[];
  metadata: Record<string, HandlerMetadata>;
}

export interface RegistryStats {
  required: number;
  registered: number;
  unregistered: number;
  handlers: string[];
}

// ============================================================================
// Global Registry Instance
// ============================================================================

export const handlerRegistry = new HandlerRegistry();

// ============================================================================
// Auto-registration Wrapper
// ============================================================================

/**
 * Wrap ipcMain.handle to automatically register handlers
 */
export function registerHandler<K extends IpcContractKey>(
  channel: K,
  handler: (event: any, data: any) => Promise<any>,
): void {
  if (typeof ipcMain !== 'undefined') {
    ipcMain.handle(channel, handler);
    handlerRegistry.register(channel);
  }
}

/**
 * Check if running in main process
 */
export function isMainProcess(): boolean {
  return typeof process !== 'undefined' && process.type === 'browser';
}

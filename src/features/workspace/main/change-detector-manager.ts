/**
 * Change Detector Manager
 *
 * Manages file change detection for workspaces
 * This is a bridge to the real ChangeDetectorManager implementation
 *
 * PERFORMANCE OPTIMIZATION: Uses lazy initialization to defer expensive
 * operations (change-history-persistence, DiffSummaryRepository) until
 * first use, improving startup time significantly.
 */

import { Logger } from '../../../shared/logger';
import { EventEmitter } from 'events';
// Import type only to avoid triggering module initialization
import type { ChangeDetectorManager as RealChangeDetectorManager } from './change-detector-manager-impl';

const logger = new Logger('ChangeDetectorManager');

export class ChangeDetectorManager extends EventEmitter {
  private _realManager: RealChangeDetectorManager | null = null;
  private _initPromise: Promise<void> | null = null;

  constructor() {
    super();
    // PERFORMANCE: Don't create real manager in constructor
    // It will be lazily initialized on first use
  }

  /**
   * Lazily initialize the real manager on first use
   * This defers expensive change-history-persistence + DiffSummaryRepository creation
   */
  private async ensureInitialized(): Promise<RealChangeDetectorManager> {
    if (this._realManager) {
      logger.debug('ChangeDetectorManager already initialized');
      return this._realManager;
    }

    // Prevent multiple concurrent initializations
    if (this._initPromise) {
      logger.debug('Waiting for existing initialization');
      await this._initPromise;
      if (!this._realManager) {
        throw new Error('ChangeDetectorManager initialization failed');
      }
      return this._realManager;
    }

    this._initPromise = (async () => {
      const initStart = Date.now();
      logger.info('Lazily initializing ChangeDetectorManager');
      // Dynamic import to defer module loading
      // Use the singleton instance exported from change-detector-manager-impl.ts
      // to avoid creating duplicate instances
      const importStart = Date.now();
      const { changeDetectorManager: realManagerSingleton } =
        await import('./change-detector-manager-impl');
      logger.info('Dynamic import completed', { durationMs: Date.now() - importStart });

      this._realManager = realManagerSingleton;

      // CRITICAL: Forward all pending listeners to the real manager
      // Listeners registered before initialization were only on the proxy
      this.forwardPendingListeners();

      logger.info('ChangeDetectorManager initialized', {
        totalDurationMs: Date.now() - initStart,
      });
    })();

    await this._initPromise;
    if (!this._realManager) {
      throw new Error('ChangeDetectorManager initialization failed');
    }
    return this._realManager;
  }

  /**
   * Forward all pending listeners from the proxy to the real manager
   * This ensures listeners registered before initialization work correctly
   */
  private forwardPendingListeners(): void {
    if (!this._realManager) return;

    // Get all event names that have listeners on the proxy
    const eventNames = this.eventNames();
    for (const eventName of eventNames) {
      const listeners = this.listeners(eventName);
      for (const listener of listeners) {
        // Register each listener on the real manager
        this._realManager.on(eventName as string, listener as (...args: any[]) => void);
      }
      logger.info('Forwarded pending listeners to real manager', {
        eventName: String(eventName),
        listenerCount: listeners.length,
      });
    }
  }

  /**
   * Synchronous access to real manager (for non-async methods)
   * Returns null if not yet initialized
   */
  private get realManager(): RealChangeDetectorManager | null {
    return this._realManager;
  }

  async startMonitoring(workspaceInfo: any): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting monitoring', { workspaceId: workspaceInfo.id });
    const ensureStart = Date.now();
    const manager = await this.ensureInitialized();
    logger.info('ensureInitialized completed', {
      workspaceId: workspaceInfo.id,
      durationMs: Date.now() - ensureStart,
    });
    const monitorStart = Date.now();
    await manager.startMonitoring(workspaceInfo);
    logger.info('manager.startMonitoring completed', {
      workspaceId: workspaceInfo.id,
      monitorDurationMs: Date.now() - monitorStart,
      totalDurationMs: Date.now() - startTime,
    });
  }

  async stopMonitoring(workspaceId: string): Promise<void> {
    logger.debug('Stopping monitoring', { workspaceId });
    // Only stop if manager is initialized - this is expected during cleanup
    if (!this._realManager) {
      logger.debug('stopMonitoring called but manager not initialized (no-op)', { workspaceId });
      return;
    }
    await this._realManager.stopMonitoring(workspaceId);
  }

  /**
   * Clear change history for a workspace (from memory AND disk)
   * PERF: Called when workspace is deleted to prevent memory bloat
   */
  clearHistory(workspaceId: string): void {
    logger.debug('Clearing history', { workspaceId });
    // Only clear if manager is initialized - this is expected during cleanup
    if (!this._realManager) {
      logger.debug('clearHistory called but manager not initialized (no-op)', { workspaceId });
      return;
    }
    this._realManager.clearHistory(workspaceId);
  }

  /**
   * Unload change history for a workspace from memory (keeps on disk)
   * PERF: Called when workspace is closed to free memory
   */
  unloadHistory(workspaceId: string): void {
    logger.debug('Unloading history from memory', { workspaceId });
    if (!this._realManager) {
      logger.debug('unloadHistory called but manager not initialized (no-op)', { workspaceId });
      return;
    }
    this._realManager.unloadHistory(workspaceId);
  }

  getChangeDetector(workspaceId: string): any {
    // Only access if initialized (sync method)
    return this._realManager?.getChangeDetector(workspaceId) ?? null;
  }

  triggerImmediateCheck(workspaceId: string, reason: string): void {
    logger.debug('Triggering immediate check', { workspaceId, reason });
    // Only trigger if manager is initialized (sync method)
    if (!this._realManager) {
      logger.warn(
        'triggerImmediateCheck called but manager not initialized - check will be skipped',
        {
          workspaceId,
          reason,
        },
      );
      return;
    }
    this._realManager.triggerImmediateCheck(workspaceId, reason);
  }

  async getChanges(workspaceId: string): Promise<any[]> {
    const manager = await this.ensureInitialized();
    return manager.getAllChanges(workspaceId);
  }

  /**
   * Forward 'on' calls to the real manager once initialized
   * This ensures event listeners are properly connected
   */
  on(event: string, listener: (...args: any[]) => void): this {
    super.on(event, listener);
    // Also register with real manager if it exists
    if (this._realManager) {
      this._realManager.on(event, listener);
    }
    return this;
  }

  /**
   * Forward 'once' calls to the real manager once initialized
   */
  once(event: string, listener: (...args: any[]) => void): this {
    super.once(event, listener);
    if (this._realManager) {
      this._realManager.once(event, listener);
    }
    return this;
  }

  /**
   * Forward 'off' calls to the real manager
   */
  off(event: string, listener: (...args: any[]) => void): this {
    super.off(event, listener);
    if (this._realManager) {
      this._realManager.off(event, listener);
    }
    return this;
  }

  /**
   * Forward 'removeListener' calls to the real manager
   */
  removeListener(event: string, listener: (...args: any[]) => void): this {
    super.removeListener(event, listener);
    if (this._realManager) {
      this._realManager.removeListener(event, listener);
    }
    return this;
  }

  /**
   * Forward 'removeAllListeners' calls to the real manager
   */
  removeAllListeners(event?: string): this {
    super.removeAllListeners(event);
    if (this._realManager) {
      this._realManager.removeAllListeners(event);
    }
    return this;
  }
}

// PERFORMANCE: Singleton is lightweight now - real manager created lazily
export const changeDetectorManager = new ChangeDetectorManager();

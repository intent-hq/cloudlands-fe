/**
 * Global Cleanup Service
 * Manages cleanup of all services and resources on window unload
 */

import { Logger } from '$lib/utils/logger';
import { agentService } from '../../agent/agent.service';
import { memoryLeakDetector } from './memory-leak-detector.service';
import { componentDisposalManager } from './disposal-manager.service';
import { getMemoryMonitor } from '$shared/monitoring/memory-monitor';

const logger = new Logger({ category: 'GlobalCleanup' });

// Get memory monitor instance
const memoryMonitor = getMemoryMonitor();

class GlobalCleanupService {
  private isInitialized = false;
  private cleanupHandlers = new Set<() => void | Promise<void>>();

  // Store bound functions to properly remove listeners
  private boundHandleBeforeUnload?: (e: BeforeUnloadEvent) => void;
  private boundHandleUnload?: () => void;


  /**
   * Initialize global cleanup handlers
   */
  initialize(): void {
    if (this.isInitialized) {
      // Already initialized - this is expected since auto-init runs on import
      // and +layout.svelte also calls initialize() for safety
      logger.debug('Global cleanup already initialized, skipping');
      return;
    }

    if (typeof window === 'undefined') {
      logger.debug('Not in browser environment, skipping global cleanup initialization');
      return;
    }

    // Create bound functions once for proper cleanup
    this.boundHandleBeforeUnload = this.handleBeforeUnload.bind(this);
    this.boundHandleUnload = this.handleUnload.bind(this);
    // Register cleanup on window unload
    window.addEventListener('beforeunload', this.boundHandleBeforeUnload);
    window.addEventListener('unload', this.boundHandleUnload);

    // NOTE: We intentionally do NOT register a visibilitychange handler here.
    // In Electron, document.hidden becomes true when the window is minimized or
    // goes behind another app. Running performCleanup() on every visibility change
    // is destructive: it disposes tracked resources, stops memory monitoring, and
    // removes the cleanup service's own event listeners -- permanently breaking
    // cleanup for actual unload events. The original comment said "mobile browsers"
    // but this code only runs in an Electron renderer.

    // Register default cleanup handlers
    // NOTE: AgentService now manages its own lifecycle via pagehide event.
    // We removed the agentService.dispose() call here because:
    // 1. beforeunload fires for HMR and cancelled navigations where we DON'T want to dispose
    // 2. The AgentService singleton would be left in a broken state with no IPC listeners
    // 3. AgentService now uses pagehide with persisted check for reliable cleanup

    this.registerCleanupHandler(() => {
      logger.debug('Cleaning up memory leak detector');
      memoryLeakDetector.dispose();
    });

    this.registerCleanupHandler(() => {
      logger.debug('Cleaning up component disposal manager');
      componentDisposalManager.disposeAll();
    });

    this.registerCleanupHandler(() => {
      logger.debug('Stopping memory monitor');
      memoryMonitor.stop();
    });

    // Start memory monitoring
    memoryMonitor.start(); // Uses default check interval from config
    logger.debug('Memory monitoring started');

    this.isInitialized = true;
    logger.debug('Global cleanup initialized');
  }

  /**
   * Register a cleanup handler
   */
  registerCleanupHandler(handler: () => void | Promise<void>): void {
    this.cleanupHandlers.add(handler);
  }

  /**
   * Unregister a cleanup handler
   */
  unregisterCleanupHandler(handler: () => void | Promise<void>): void {
    this.cleanupHandlers.delete(handler);
  }

  /**
   * Handle before unload event
   */
  private handleBeforeUnload(_event: BeforeUnloadEvent): void {
    logger.debug('Before unload event triggered');

    // Perform synchronous cleanup only
    for (const handler of this.cleanupHandlers) {
      try {
        const result = handler();
        if (!(result instanceof Promise)) {
          // Only execute synchronous handlers here
          logger.debug('Executed synchronous cleanup handler');
        }
      } catch (error) {
        logger.error('Error during beforeunload cleanup', error as Error);
      }
    }
  }

  /**
   * Handle unload event
   */
  private handleUnload(): void {
    logger.debug('Unload event triggered');
    this.performCleanup();
  }

  // handleVisibilityChange removed -- see comment in initialize()

  /**
   * Perform all cleanup
   */
  private performCleanup(): void {
    logger.debug('Performing global cleanup');

    // Execute all cleanup handlers
    for (const handler of this.cleanupHandlers) {
      try {
        handler();
      } catch (error) {
        logger.error('Error during cleanup', error as Error);
      }
    }

    // Clear all timers and intervals
    this.clearAllTimers();

    // Clear all event listeners (best effort)
    this.clearEventListeners();

    logger.debug('Global cleanup completed');
  }

  /**
   * Clear all active timers and intervals
   */
  private clearAllTimers(): void {
    // This is a best-effort approach to clear timers
    // Modern browsers don't provide a way to enumerate all timers

    // Clear any timers we know about through the memory leak detector
    const stats = memoryLeakDetector.getStats();
    logger.debug(`Clearing ${stats.timers} timers and ${stats.intervals} intervals`);

    // The actual cleanup is handled by the memory leak detector disposal
  }

  /**
   * Clear event listeners (best effort)
   */
  private clearEventListeners(): void {
    // Remove our own listeners using the stored bound functions
    if (typeof window !== 'undefined') {
      if (this.boundHandleBeforeUnload) {
        window.removeEventListener('beforeunload', this.boundHandleBeforeUnload);
      }
      if (this.boundHandleUnload) {
        window.removeEventListener('unload', this.boundHandleUnload);
      }
    }

    // Clear references
    this.boundHandleBeforeUnload = undefined;
    this.boundHandleUnload = undefined;

    // The rest is handled by component disposal manager
    const componentStats = componentDisposalManager.getStats();
    logger.debug(`Disposing ${componentStats.componentCount} components`);
  }

  /**
   * Force cleanup (for testing or manual trigger)
   */
  forceCleanup(): void {
    logger.warn('Force cleanup triggered');
    this.performCleanup();
  }
}

// Export singleton instance
export const globalCleanupService = new GlobalCleanupService();

// Auto-initialize when imported in browser environment
if (typeof window !== 'undefined') {
  // Initialize on next tick to ensure all services are loaded
  setTimeout(() => {
    globalCleanupService.initialize();
  }, 0);
}

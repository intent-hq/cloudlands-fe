/**
 * Memory Management Utilities
 *
 * Helps prevent memory leaks and optimize memory usage
 */

import { Logger } from '$lib/utils/logger';

const logger = new Logger({ category: 'MemoryManager' });

/**
 * Tracks and manages cleanup functions
 */
export class CleanupManager {
  private cleanupFunctions: Set<() => void> = new Set();
  private timers: Set<NodeJS.Timeout> = new Set();
  private intervals: Set<NodeJS.Timeout> = new Set();
  private disposed = false;

  /**
   * Register a cleanup function
   */
  register(cleanup: () => void): void {
    if (this.disposed) {
      logger.warn('Cannot register cleanup on disposed manager');
      return;
    }
    this.cleanupFunctions.add(cleanup);
  }

  /**
   * Create a managed timeout
   */
  setTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    if (this.disposed) {
      logger.warn('Cannot create timer on disposed manager');
      throw new Error('Cannot create timer on disposed memory manager');
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);

    this.timers.add(timer);
    return timer;
  }

  /**
   * Create a managed interval
   */
  setInterval(callback: () => void, delay: number): NodeJS.Timeout {
    if (this.disposed) {
      logger.warn('Cannot create interval on disposed manager');
      throw new Error('Cannot create interval on disposed memory manager');
    }

    const interval = setInterval(callback, delay);
    this.intervals.add(interval);
    return interval;
  }

  /**
   * Clear a managed timeout
   */
  clearTimeout(timer: NodeJS.Timeout): void {
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(timer);
    }
  }

  /**
   * Clear a managed interval
   */
  clearInterval(interval: NodeJS.Timeout): void {
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(interval);
    }
  }

  /**
   * Dispose all managed resources
   */
  dispose(): void {
    if (this.disposed) return;

    logger.debug(`Disposing ${this.cleanupFunctions.size} cleanup functions`);

    // Run all cleanup functions
    for (const cleanup of this.cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        logger.error('Error during cleanup', error as Error);
      }
    }

    // Clear all timers
    for (const timer of this.timers) {
      clearTimeout(timer);
    }

    // Clear all intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }

    // Clear collections
    this.cleanupFunctions.clear();
    this.timers.clear();
    this.intervals.clear();

    this.disposed = true;
  }
}

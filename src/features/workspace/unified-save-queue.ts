/**
 * Unified Save Queue
 *
 * Consolidates all localStorage saves into a single queue with
 * consistent debouncing to prevent race conditions.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('unified-save-queue');

export interface SaveQueueOptions {
  debounceMs?: number;
  maxRetries?: number;
  onError?: (error: Error, key: string, data: any) => void;
}

export class UnifiedSaveQueue {
  private queue = new Map<string, any>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly maxRetries: number;
  private readonly onError?: (error: Error, key: string, data: any) => void;
  private isDisposed = false;
  private saveInProgress = false;
  private pendingFlush: Promise<void> | null = null;

  constructor(options: SaveQueueOptions = {}) {
    this.debounceMs = options.debounceMs ?? 300;
    this.maxRetries = options.maxRetries ?? 3;
    this.onError = options.onError;
  }

  /**
   * Schedule a save operation
   */
  schedule(key: string, data: any): void {
    if (this.isDisposed) {
      logger.warn('Cannot schedule save on disposed queue');
      return;
    }

    // Add to queue
    this.queue.set(key, data);
    logger.debug('Scheduled save', { key, queueSize: this.queue.size });

    // Reset timer
    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Schedule flush
    this.timer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  /**
   * Flush all pending saves immediately
   * If a flush is already in progress, wait for it to complete then flush any new items
   */
  async flush(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    // If a flush is already in progress, wait for it then check if there are new items
    if (this.saveInProgress && this.pendingFlush) {
      await this.pendingFlush;
      // After the previous flush completes, check if there are new items to save
      if (this.queue.size > 0) {
        return this.flush();
      }
      return;
    }

    if (this.queue.size === 0) {
      logger.debug('No items to save');
      return;
    }

    this.saveInProgress = true;
    const batch = Array.from(this.queue.entries());
    this.queue.clear();

    // Store the flush promise so concurrent callers can wait for it
    this.pendingFlush = this.doFlush(batch);
    await this.pendingFlush;
  }

  /**
   * Internal method to perform the actual flush
   */
  private async doFlush(batch: Array<[string, any]>): Promise<void> {
    logger.debug('Flushing save queue', { itemCount: batch.length });

    // Save all items
    const errors: Array<{ key: string; error: Error; data: any }> = [];

    for (const [key, data] of batch) {
      let retries = 0;
      let saved = false;

      while (retries < this.maxRetries && !saved) {
        try {
          const serialized = JSON.stringify(data);
          localStorage.setItem(key, serialized);
          saved = true;
          logger.debug('Saved item', { key, size: serialized.length });
        } catch (error) {
          retries++;

          if (retries >= this.maxRetries) {
            const err = error instanceof Error ? error : new Error(String(error));
            errors.push({ key, error: err, data });
            logger.error('Failed to save after retries', { key, error: err, retries });

            // Try to clear space if quota exceeded
            if (err.name === 'QuotaExceededError') {
              this.clearOldData();
            }
          } else {
            logger.warn('Save failed, retrying', { key, attempt: retries });
            // Exponential backoff with cap at 1 second to avoid hanging cleanup
            const delay = Math.min(100 * Math.pow(2, retries - 1), 1000);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
    }

    // Handle errors
    if (errors.length > 0 && this.onError) {
      for (const { key, error, data } of errors) {
        this.onError(error, key, data);
      }
    }

    this.saveInProgress = false;
    this.pendingFlush = null;
  }

  /**
   * Clear old data to make space
   */
  private clearOldData(): void {
    try {
      const keys = Object.keys(localStorage);
      const workspaceKeys = keys.filter((k) => k.includes('workspace:'));

      // Sort by age (assuming keys have timestamps or can be parsed)
      const sortedKeys = workspaceKeys.sort((a, b) => {
        const timeA = this.extractTimestamp(a);
        const timeB = this.extractTimestamp(b);
        return timeA - timeB;
      });

      // Remove oldest 10% of keys
      const toRemove = Math.ceil(sortedKeys.length * 0.1);
      for (let i = 0; i < toRemove; i++) {
        localStorage.removeItem(sortedKeys[i]);
        logger.info('Removed old data to free space', { key: sortedKeys[i] });
      }
    } catch (error) {
      logger.error('Failed to clear old data', { error });
    }
  }

  private extractTimestamp(key: string): number {
    try {
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.lastUpdated || parsed.timestamp || 0;
      }
    } catch {
      // Ignore parse errors
    }
    return 0;
  }

  /**
   * Dispose the queue
   */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Final flush before disposal
    if (this.queue.size > 0) {
      this.flush().catch((error) => {
        logger.error('Failed to flush on dispose', { error });
      });
    }

    this.isDisposed = true;
    logger.debug('Save queue disposed');
  }
}

// Global singleton instance
export const globalSaveQueue = new UnifiedSaveQueue({
  debounceMs: 300,
  maxRetries: 3,
  onError: (error, key, data) => {
    logger.error('Global save queue error', { error, key });
  },
});

// Ensure cleanup on page unload
if (typeof window !== 'undefined') {
  const handleBeforeUnload = () => {
    globalSaveQueue.dispose();
  };
  window.addEventListener('beforeunload', handleBeforeUnload);

  // Provide a way to clean up the listener if needed
  (globalSaveQueue as any).removeUnloadListener = () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
}

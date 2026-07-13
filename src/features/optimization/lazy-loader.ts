/**
 * Lazy Loading Utility for Performance Optimization
 *
 * Provides utilities for lazy loading components, data, and resources
 * to improve initial load time and reduce memory usage.
 */

import { Logger } from '$lib/utils/logger';

const logger = new Logger({ category: 'LazyLoader' });

export interface LazyLoadOptions {
  /** Whether to preload on hover/focus */
  preload?: boolean;
  /** Priority level (higher = load sooner) */
  priority?: number;
  /** Maximum retries on failure */
  maxRetries?: number;
}

/**
 * Queue for managing lazy load priorities
 */
class LazyLoadQueue {
  private queue: Array<{
    id: string;
    priority: number;
    loader: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  private loading = false;
  private concurrency = 2; // Max concurrent loads
  private activeLoads = 0;

  add<T>(id: string, loader: () => Promise<T>, priority: number = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      // Check if already in queue
      const existing = this.queue.findIndex((item) => item.id === id);
      if (existing >= 0) {
        // Update priority if higher
        if (priority > this.queue[existing].priority) {
          this.queue[existing].priority = priority;
          this.sortQueue();
        }
        // Return existing promise
        return;
      }

      this.queue.push({ id, priority, loader, resolve, reject });
      this.sortQueue();
      this.processQueue();
    });
  }

  private sortQueue() {
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  private async processQueue() {
    if (this.activeLoads >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeLoads++;

    try {
      logger.debug(`Loading ${item.id} with priority ${item.priority}`);
      const result = await item.loader();
      item.resolve(result);
    } catch (error) {
      logger.error(`Failed to load ${item.id}`, error as Error);
      item.reject(error);
    } finally {
      this.activeLoads--;
      this.processQueue(); // Process next item
    }
  }
}

const loadQueue = new LazyLoadQueue();

/**
 * Lazy load a component or resource
 */
export async function lazyLoad<T>(
  id: string,
  loader: () => Promise<T>,
  options: LazyLoadOptions = {},
): Promise<T> {
  const { priority = 0, maxRetries = 3 } = options;

  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await loadQueue.add(id, loader, priority);
    } catch (error) {
      lastError = error;
      logger.warn(`Retry ${attempt + 1}/${maxRetries} for ${id}`);

      // Exponential backoff
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError;
}

/**
 * Create a lazy-loaded store for data
 */
export function createLazyStore<T>(loader: () => Promise<T>, defaultValue: T) {
  let value = $state(defaultValue);
  let loading = $state(false);
  let loaded = $state(false);
  let error: Error | null = $state(null);

  const load = async () => {
    if (loaded || loading) return;

    loading = true;
    error = null;

    try {
      value = await loader();
      loaded = true;
    } catch (e) {
      error = e as Error;
      logger.error('Failed to load lazy store', error);
    } finally {
      loading = false;
    }
  };

  return {
    get value() {
      return value;
    },
    get loading() {
      return loading;
    },
    get loaded() {
      return loaded;
    },
    get error() {
      return error;
    },
    load,
  };
}

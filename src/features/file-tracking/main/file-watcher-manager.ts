/**
 * File Watcher Manager
 *
 * Manages file watching with proper resource management to avoid EMFILE errors
 */

import {
  FSWatcher,
  watch,
} from 'chokidar';
import { EventEmitter } from 'events';
import { Logger } from '$lib/utils/logger';

const logger = new Logger({ category: 'FileWatcherManager' });

interface WatcherConfig {
  maxWatchers?: number;
  debounceMs?: number;
  usePolling?: boolean;
  pollInterval?: number;
}

interface WatchedPath {
  path: string;
  watcher: FSWatcher;
  lastAccess: number;
  priority: number;
}

export class FileWatcherManager extends EventEmitter {
  private watchers: Map<string, WatchedPath> = new Map();
  private maxWatchers: number;
  private readonly debounceMs: number;
  private readonly usePolling: boolean;
  private readonly pollInterval: number;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor(config: WatcherConfig = {}) {
    super();
    this.maxWatchers = config.maxWatchers || 100; // Increased limit for better coverage
    this.debounceMs = config.debounceMs || 300; // Faster response to changes
    this.usePolling =
      config.usePolling !== undefined ? config.usePolling : process.platform === 'linux';
    this.pollInterval = config.pollInterval || 1000;

    // Start periodic cleanup
    this.startCleanupTimer();
  }

  /**
   * Watch a path with automatic resource management
   */
  async watchPath(filePath: string, priority: number = 0): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Cannot add watcher during shutdown');
      return;
    }

    // Check if already watching
    const existing = this.watchers.get(filePath);
    if (existing) {
      existing.lastAccess = Date.now();
      existing.priority = Math.max(existing.priority, priority);
      return;
    }

    // Check if we need to free up resources
    if (this.watchers.size >= this.maxWatchers) {
      await this.evictLeastRecentlyUsed();
    }

    try {
      const watcher = watch(filePath, {
        persistent: false, // Don't keep process alive
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.debounceMs,
          pollInterval: 100,
        },
        usePolling: this.usePolling,
        interval: this.pollInterval,
        binaryInterval: this.pollInterval * 3,
        followSymlinks: false,
        ignorePermissionErrors: true,
        atomic: true,
      });

      // Setup event handlers
      watcher
        .on('change', (path) => this.handleChange(path, 'change'))
        .on('add', (path) => this.handleChange(path, 'add'))
        .on('unlink', (path) => this.handleChange(path, 'unlink'))
        .on('error', (error: unknown) =>
          this.handleError(filePath, error instanceof Error ? error : new Error(String(error))),
        );

      this.watchers.set(filePath, {
        path: filePath,
        watcher,
        lastAccess: Date.now(),
        priority,
      });

      logger.debug(
        `Started watching: ${filePath} (${this.watchers.size}/${this.maxWatchers} watchers)`,
      );
    } catch (error) {
      logger.error(`Failed to watch path: ${filePath}`, error as Error);
      this.emit('error', error);
    }
  }

  /**
   * Stop watching a path
   */
  async unwatchPath(filePath: string): Promise<void> {
    const watched = this.watchers.get(filePath);
    if (!watched) return;

    try {
      await watched.watcher.close();
      this.watchers.delete(filePath);
      logger.debug(
        `Stopped watching: ${filePath} (${this.watchers.size}/${this.maxWatchers} watchers)`,
      );
    } catch (error) {
      logger.error(`Failed to unwatch path: ${filePath}`, error as Error);
    }
  }

  /**
   * Evict least recently used watcher
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    let lruPath: string | null = null;
    let lruTime = Date.now();
    let lruPriority = Infinity;

    // Find LRU watcher with lowest priority
    for (const [path, watched] of this.watchers) {
      if (
        watched.priority < lruPriority ||
        (watched.priority === lruPriority && watched.lastAccess < lruTime)
      ) {
        lruPath = path;
        lruTime = watched.lastAccess;
        lruPriority = watched.priority;
      }
    }

    if (lruPath) {
      logger.debug(`Evicting LRU watcher: ${lruPath}`);
      await this.unwatchPath(lruPath);
    }
  }

  /**
   * Handle file change events
   */
  private handleChange(filePath: string, type: string): void {
    const watched = this.watchers.get(filePath);
    if (watched) {
      watched.lastAccess = Date.now();
    }

    this.emit('file-change', {
      path: filePath,
      type,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle watcher errors
   */
  private handleError(filePath: string, error: Error): void {
    logger.error(`Watcher error for ${filePath}:`, error);

    // Check for EMFILE error
    if (error.message.includes('EMFILE') || error.message.includes('too many open files')) {
      logger.error('EMFILE error detected - reducing watcher count');

      // Reduce max watchers to prevent further issues
      this.maxWatchers = Math.max(10, Math.floor(this.watchers.size * 0.7));

      // Evict some watchers immediately
      this.emergencyCleanup();
    }

    this.emit('error', error);
  }

  /**
   * Emergency cleanup when hitting resource limits
   */
  private async emergencyCleanup(): Promise<void> {
    const targetSize = Math.floor(this.maxWatchers * 0.5);
    const toRemove = this.watchers.size - targetSize;

    if (toRemove <= 0) return;

    // Sort by priority and last access
    const sorted = Array.from(this.watchers.entries()).sort(([, a], [, b]) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.lastAccess - b.lastAccess;
    });

    // Remove lowest priority/oldest watchers
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      await this.unwatchPath(sorted[i][0]);
    }

    logger.info(
      `Emergency cleanup complete. Reduced watchers from ${this.watchers.size + toRemove} to ${this.watchers.size}`,
    );
  }

  /**
   * Start periodic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
  }

  /**
   * Periodic cleanup of stale watchers
   */
  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [path, watched] of this.watchers) {
      if (now - watched.lastAccess > staleThreshold && watched.priority < 10) {
        this.unwatchPath(path).catch((error) => {
          logger.error(`Failed to cleanup stale watcher: ${path}`, error as Error);
        });
      }
    }
  }

  /**
   * Get current statistics
   */
  getStats(): {
    activeWatchers: number;
    maxWatchers: number;
    isUsingPolling: boolean;
    } {
    return {
      activeWatchers: this.watchers.size,
      maxWatchers: this.maxWatchers,
      isUsingPolling: this.usePolling,
    };
  }

  /**
   * Shutdown and cleanup all watchers
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Close all watchers
    const promises = Array.from(this.watchers.keys()).map((path) =>
      this.unwatchPath(path).catch((error) => {
        logger.error(`Failed to close watcher during shutdown: ${path}`, error as Error);
      }),
    );

    await Promise.all(promises);

    logger.info('File watcher manager shutdown complete');
  }
}

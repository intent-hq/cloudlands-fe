/**
 * Unified Workspace Watcher
 *
 * Consolidates all file watching into a single @parcel/watcher instance per workspace.
 * Subscribers register path patterns and receive filtered events, eliminating
 * the EMFILE (too many open files) error caused by multiple independent watchers.
 *
 * @parcel/watcher uses native OS file watching APIs (FSEvents on macOS, inotify on
 * Linux, ReadDirectoryChangesW on Windows) with a single file descriptor per
 * watched directory tree.
 */

import * as parcelWatcher from '@parcel/watcher';
import { existsSync } from 'fs';
import { relative, sep } from 'path';
import { Logger } from '$shared/logger';

const logger = new Logger('UnifiedWorkspaceWatcher');

// ============================================================================
// Types
// ============================================================================

export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface WatchEvent {
  type: WatchEventType;
  /** Absolute path of the changed file/directory */
  path: string;
  /** Path relative to the workspace root */
  relativePath: string;
  timestamp: string;
}

export type WatchEventCallback = (event: WatchEvent) => void;

export interface WatchSubscription {
  /** Unique identifier for this subscription */
  id: string;
  /**
   * Path patterns to match against the relative path.
   * Supports:
   *   - Exact prefix match: "notes/" matches any file under notes/
   *   - Exact file match: "SPEC.md" matches only SPEC.md
   *   - Glob-like suffix: "*.json" matches any .json file
   *   - ".git/" prefix for git directory watching
   *   - "**" to match everything (catch-all)
   */
  pathPatterns: string[];
  /** Callback invoked when a matching event occurs */
  callback: WatchEventCallback;
  /** Optional: event types to listen for (defaults to all) */
  eventTypes?: WatchEventType[];
  /** Optional: called when events were dropped and subscriber should rescan */
  onRescanRequired?: () => void;
  /** Optional: called when a watcher error occurs */
  onError?: (error: Error) => void;
}

export interface WatcherStats {
  watchedPaths: number;
  subscribers: number;
  mode: 'native';
  isRunning: boolean;
  errorCount: number;
}

// ============================================================================
// Singleton instances per workspace
// ============================================================================

const instances = new Map<string, UnifiedWorkspaceWatcher>();

// ============================================================================
// @parcel/watcher event type mapping
// ============================================================================

const PARCEL_EVENT_TYPE_MAP: Record<string, WatchEventType> = {
  create: 'add',
  update: 'change',
  delete: 'unlink',
};

// ============================================================================
// Ignore patterns for native filtering
// ============================================================================

const IGNORE_PATTERNS: string[] = [
  // Patterns that can appear at any depth in a monorepo (use glob syntax)
  '**/node_modules/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/CVS/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/target/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/.parcel-cache/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/.pytest_cache/**',
  '**/__pycache__/**',
  '**/venv/**',
  '**/env/**',
  '**/.env/**',
  '**/vendor/**',
  '**/bower_components/**',
  '**/.sass-cache/**',
  '**/tmp/**',
  '**/temp/**',
  '**/.tmp/**',
  '**/.temp/**',
  // Root-only patterns (literal paths relative to watch root)
  '.git/objects',
  '.git/hooks',
  '.git/lfs',
  '.git/logs',
  '.git/info',
  '.git/rr-cache',
  '.git/worktrees',
  '.git/modules',
  '.augment',
  '.workspace-notes',
  '.workspace-notes.backup',
  '.workspace',
];

// ============================================================================
// Convenience functions
// ============================================================================

/**
 * Get or create the unified watcher for a workspace, starting it if needed.
 * This is the primary entry point for workspace initialization.
 */
export async function getUnifiedWatcher(
  workspaceId: string,
  worktreePath: string,
): Promise<UnifiedWorkspaceWatcher> {
  const watcher = UnifiedWorkspaceWatcher.getInstance(workspaceId, worktreePath);

  if (!watcher.getStats().isRunning) {
    await watcher.start();
    const stats = watcher.getStats();
    logger.info('Unified watcher created and started', {
      workspaceId,
      worktreePath,
      mode: stats.mode,
      subscribers: stats.subscribers,
    });
  }

  return watcher;
}

/**
 * Shut down the unified watcher for a workspace.
 * Stops watching and cleans up the singleton instance.
 */
export async function shutdownUnifiedWatcher(workspaceId: string): Promise<void> {
  const instance = instances.get(workspaceId);
  if (instance) {
    const stats = instance.getStats();
    logger.info('Shutting down unified watcher', {
      workspaceId,
      subscribers: stats.subscribers,
      watchedPaths: stats.watchedPaths,
    });
    await instance.dispose();
  }
}

/**
 * Shut down unified watchers for all workspaces EXCEPT the given one.
 * Called during workspace:open to ensure only one native @parcel/watcher
 * subscription is active at a time.  Under high memory pressure, multiple
 * concurrent subscriptions can cause the native addon's C++ layer to throw
 * an unrecoverable Napi::Error (libc++abi termination).
 *
 * Uses stop() (not dispose()) so the instance and its JS-level subscribers
 * are preserved.  When the user switches back to a previously-open workspace,
 * getUnifiedWatcher() finds the existing stopped instance, restarts the native
 * subscription, and events flow to the existing ChangeDetector /
 * MetadataFileWatcher subscribers without them having to re-register.
 */
export async function shutdownOtherWatchers(keepWorkspaceId: string): Promise<void> {
  const otherIds = [...instances.keys()].filter((id) => id !== keepWorkspaceId);
  if (otherIds.length === 0) return;

  logger.info('Stopping native watchers for inactive workspaces', {
    keepWorkspaceId,
    stopping: otherIds,
  });

  await Promise.all(
    otherIds.map(async (id) => {
      try {
        const instance = instances.get(id);
        if (instance && instance.getStats().isRunning) {
          await instance.stop();
        }
      } catch (error) {
        logger.warn('Failed to stop watcher for inactive workspace', {
          workspaceId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

/**
 * Stop ALL native watcher subscriptions across every workspace.
 * Called by the MemoryMonitor when memory pressure reaches critical levels.
 * Native @parcel/watcher is the most likely addon to throw unrecoverable
 * Napi::Error under memory pressure, so proactively stopping all instances
 * prevents the process from being terminated by libc++abi.
 *
 * Like shutdownOtherWatchers, uses stop() to preserve subscribers so
 * watchers can be restarted when the workspace is next opened.
 */
export async function stopAllWatchers(): Promise<void> {
  const ids = [...instances.keys()];
  if (ids.length === 0) return;

  logger.warn('Stopping ALL native watchers due to memory pressure', {
    count: ids.length,
    workspaces: ids,
  });

  await Promise.all(
    ids.map(async (id) => {
      try {
        const instance = instances.get(id);
        if (instance && instance.getStats().isRunning) {
          await instance.stop();
        }
      } catch (error) {
        logger.warn('Failed to stop watcher during memory pressure cleanup', {
          workspaceId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

// ============================================================================
// UnifiedWorkspaceWatcher
// ============================================================================

export class UnifiedWorkspaceWatcher {
  private subscription: parcelWatcher.AsyncSubscription | null = null;
  private subscribers = new Map<string, WatchSubscription>();
  private isRunning = false;
  private errorCount = 0;
  private readonly MAX_ERRORS = 10;

  private constructor(
    private readonly workspaceId: string,
    private readonly worktreePath: string,
  ) {}

  /**
   * Get or create a UnifiedWorkspaceWatcher for a workspace.
   * Only ONE instance exists per workspaceId.
   */
  static getInstance(workspaceId: string, worktreePath: string): UnifiedWorkspaceWatcher {
    let instance = instances.get(workspaceId);
    if (!instance) {
      instance = new UnifiedWorkspaceWatcher(workspaceId, worktreePath);
      instances.set(workspaceId, instance);
    } else if (instance.worktreePath !== worktreePath) {
      logger.warn('UnifiedWorkspaceWatcher worktreePath mismatch', {
        workspaceId,
        existingPath: instance.worktreePath,
        requestedPath: worktreePath,
      });
    }
    return instance;
  }

  /**
   * Register a subscriber that receives filtered watch events.
   * Returns an unsubscribe function.
   */
  subscribe(subscription: WatchSubscription): () => void {
    if (this.subscribers.has(subscription.id)) {
      logger.warn(`Subscriber "${subscription.id}" already registered, replacing`, {
        workspaceId: this.workspaceId,
      });
    }

    if (!this.isRunning) {
      logger.warn('Subscribing before watcher is started — events will not be delivered until start() is called', {
        workspaceId: this.workspaceId,
        subscriberId: subscription.id,
      });
    }

    this.subscribers.set(subscription.id, subscription);

    logger.info(`Subscriber registered: ${subscription.id}`, {
      workspaceId: this.workspaceId,
      patterns: subscription.pathPatterns,
      subscriberCount: this.subscribers.size,
    });

    return () => {
      this.subscribers.delete(subscription.id);
      logger.info(`Subscriber unregistered: ${subscription.id}`, {
        workspaceId: this.workspaceId,
        subscriberCount: this.subscribers.size,
      });
    };
  }

  /**
   * Start the unified file watcher using @parcel/watcher.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Unified watcher already running', { workspaceId: this.workspaceId });
      return;
    }

    logger.info('Starting unified workspace watcher', {
      workspaceId: this.workspaceId,
      worktreePath: this.worktreePath,
    });

    // Guard: verify the path exists before calling into the native @parcel/watcher addon.
    // If the directory doesn't exist (e.g. workspace still being created), the native C++
    // layer can throw an unrecoverable Napi::Error that bypasses JS try/catch and aborts
    // the entire process via libc++abi / std::terminate().
    if (!existsSync(this.worktreePath)) {
      const msg = `Cannot start watcher: worktree path does not exist: ${this.worktreePath}`;
      logger.error(msg, new Error(msg), { workspaceId: this.workspaceId });
      throw new Error(msg);
    }

    // Guard: skip native watcher under high memory pressure.
    // @parcel/watcher allocates native memory for FSEvents subscriptions.
    // Under heavy heap usage the native C++ layer is more likely to throw
    // an unrecoverable Napi::Error.  Defer the watcher start — callers
    // (getUnifiedWatcher → workspace:open) treat this as non-fatal, and the
    // watcher will be started on the next workspace open when memory is lower.
    //
    // We check BOTH heapUsed and RSS.  heapUsed only measures the V8 JS heap;
    // native addons like @parcel/watcher, better-sqlite3, and ssh2 allocate
    // outside the heap, so RSS (resident set size) is a better indicator of
    // total process memory and native-layer crash risk.
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / (1024 * 1024);
    const rssMB = mem.rss / (1024 * 1024);
    const HEAP_PRESSURE_THRESHOLD_MB = 512;
    const RSS_PRESSURE_THRESHOLD_MB = 1024;
    if (heapUsedMB > HEAP_PRESSURE_THRESHOLD_MB || rssMB > RSS_PRESSURE_THRESHOLD_MB) {
      const msg = `Deferring watcher start: heap ${heapUsedMB.toFixed(0)}MB / RSS ${rssMB.toFixed(0)}MB exceeds threshold (heap>${HEAP_PRESSURE_THRESHOLD_MB}MB or RSS>${RSS_PRESSURE_THRESHOLD_MB}MB)`;
      logger.warn(msg, { workspaceId: this.workspaceId, heapUsedMB: heapUsedMB.toFixed(0), rssMB: rssMB.toFixed(0) });
      throw new Error(msg);
    }

    try {
      this.subscription = await parcelWatcher.subscribe(
        this.worktreePath,
        (err, events) => {
          if (err) {
            this.handleWatcherError(
              err instanceof Error ? err : new Error(String(err)),
            );
            return;
          }

          for (const event of events) {
            const eventType = PARCEL_EVENT_TYPE_MAP[event.type];
            if (eventType) {
              this.routeEvent(eventType, event.path);
            }
          }
        },
        {
          ignore: IGNORE_PATTERNS,
        },
      );

      this.isRunning = true;
      this.errorCount = 0;

      logger.info('Unified workspace watcher started', {
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      logger.error(
        'Failed to start unified workspace watcher',
        error instanceof Error ? error : new Error(String(error)),
        { workspaceId: this.workspaceId },
      );
      throw error;
    }
  }

  /**
   * Stop the unified file watcher and clean up.
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.subscription) {
      return;
    }

    try {
      await this.subscription.unsubscribe();
    } catch (error) {
      logger.warn('Error closing watcher', {
        workspaceId: this.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.subscription = null;
    this.isRunning = false;

    logger.info('Unified workspace watcher stopped', {
      workspaceId: this.workspaceId,
      subscriberCount: this.subscribers.size,
    });
  }

  /**
   * Stop the watcher, clear subscribers, and remove the singleton instance.
   */
  async dispose(): Promise<void> {
    await this.stop();
    this.subscribers.clear();
    instances.delete(this.workspaceId);

    logger.info('Unified workspace watcher disposed', {
      workspaceId: this.workspaceId,
    });
  }

  /**
   * Get statistics about the watcher.
   */
  getStats(): WatcherStats {
    return {
      watchedPaths: this.isRunning ? 1 : 0,
      subscribers: this.subscribers.size,
      mode: 'native',
      isRunning: this.isRunning,
      errorCount: this.errorCount,
    };
  }

  // ==========================================================================
  // Private methods
  // ==========================================================================

  /**
   * Route a file event to all matching subscribers.
   */
  private routeEvent(type: WatchEventType, absolutePath: string): void {
    // Normalize relativePath to forward slashes for consistent cross-platform behavior
    const relativePath = relative(this.worktreePath, absolutePath).split(sep).join('/');

    const event: WatchEvent = {
      type,
      path: absolutePath,
      relativePath,
      timestamp: new Date().toISOString(),
    };

    for (const subscriber of this.subscribers.values()) {
      // Check event type filter
      if (subscriber.eventTypes && !subscriber.eventTypes.includes(type)) {
        continue;
      }

      // Check path pattern match
      if (this.matchesPatterns(relativePath, subscriber.pathPatterns)) {
        try {
          subscriber.callback(event);
        } catch (error) {
          logger.error(`Error in subscriber "${subscriber.id}" callback`, {
            workspaceId: this.workspaceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /**
   * Check if a relative path matches any of the given patterns.
   *
   * Pattern matching rules:
   *   - "**"           → matches everything
   *   - "notes/"       → matches any path starting with "notes/"
   *   - "SPEC.md"      → matches exactly "SPEC.md"
   *   - "*.json"       → matches any path ending with ".json"
   *   - ".git/"        → matches any path starting with ".git/"
   *   - ".git"         → matches exactly ".git"
   */
  private matchesPatterns(relativePath: string, patterns: string[]): boolean {
    // Normalize to forward slashes for consistent matching
    const normalized = relativePath.split(sep).join('/');

    for (const pattern of patterns) {
      if (pattern === '**') {
        return true;
      }

      // Prefix match: pattern ends with "/"
      if (pattern.endsWith('/')) {
        if (normalized.startsWith(pattern) || normalized + '/' === pattern) {
          return true;
        }
        continue;
      }

      // Suffix/extension match: pattern starts with "*"
      if (pattern.startsWith('*')) {
        const suffix = pattern.slice(1);
        if (normalized.endsWith(suffix)) {
          return true;
        }
        continue;
      }

      // Exact match
      if (normalized === pattern) {
        return true;
      }
    }

    return false;
  }

  /**
   * Handle runtime watcher errors.
   * On too many errors, stop entirely.
   */
  private handleWatcherError(error: Error): void {
    const message = error.message || '';

    // Handle "Events were dropped" as non-fatal - just notify subscribers to rescan
    if (
      message.includes('Events were dropped') ||
      message.includes('File system must be re-scanned')
    ) {
      logger.warn('File system events were dropped, notifying subscribers to rescan', {
        workspaceId: this.workspaceId,
        error: message,
      });
      this.notifyRescan();
      return;
    }

    this.errorCount++;

    logger.error('Watcher error', error, {
      workspaceId: this.workspaceId,
      errorCount: this.errorCount,
    });

    // Notify subscribers of the error
    this.notifyError(error);

    if (this.errorCount >= this.MAX_ERRORS) {
      logger.error('Too many watcher errors, stopping', undefined, {
        workspaceId: this.workspaceId,
        errorCount: this.errorCount,
      });

      this.stop().catch((stopError) => {
        logger.error(
          'Failed to stop watcher after max errors',
          stopError instanceof Error ? stopError : new Error(String(stopError)),
          { workspaceId: this.workspaceId },
        );
      });
    }
  }

  /**
   * Notify all subscribers that events were dropped and they should rescan.
   */
  private notifyRescan(): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.onRescanRequired) {
        try {
          subscriber.onRescanRequired();
        } catch (error) {
          logger.error(`Error in subscriber "${subscriber.id}" onRescanRequired callback`, {
            workspaceId: this.workspaceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /**
   * Notify all subscribers of a watcher error.
   */
  private notifyError(error: Error): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.onError) {
        try {
          subscriber.onError(error);
        } catch (callbackError) {
          logger.error(`Error in subscriber "${subscriber.id}" onError callback`, {
            workspaceId: this.workspaceId,
            error: callbackError instanceof Error ? callbackError.message : String(callbackError),
          });
        }
      }
    }
  }
}

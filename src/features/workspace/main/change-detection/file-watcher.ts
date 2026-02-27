/**
 * File Watcher Module
 *
 * Thin adapter that subscribes to the UnifiedWorkspaceWatcher and emits
 * filtered 'file-change' events. Gitignore and additional ignore patterns
 * are applied locally before events are forwarded.
 */

import { EventEmitter } from '../../../../shared/event-emitter';
import { GitignoreManager } from '../../../../lib/utils/main/gitignore-manager';
import { Logger } from '../../../../shared/logger';
import { TRACKING_CONFIG } from '../../../file-tracking/tracking.config';
import {
  getUnifiedWatcher,
  type WatchEvent,
} from '../unified-workspace-watcher';

const logger = new Logger('FileWatcher');

export interface FileWatchEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
  relativePath: string;
  timestamp: string;
}

export class FileWatcher extends EventEmitter {
  private unsubscribe: (() => void) | null = null;
  private workspaceId: string;
  private workspacePath: string;
  private gitignoreManager: GitignoreManager;
  private config = TRACKING_CONFIG.changeDetection;
  private isWatching: boolean = false;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(workspaceId: string, workspacePath: string) {
    super();
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
    this.gitignoreManager = new GitignoreManager(workspacePath);
  }

  /**
   * Start watching the workspace via UnifiedWorkspaceWatcher
   */
  async start(): Promise<void> {
    if (this.config.disableFileWatcher || this.config.gitPollingOnly) {
      logger.info('File watcher is disabled by configuration');
      return;
    }

    if (this.isWatching) {
      logger.warn('File watcher is already running');
      return;
    }

    try {
      await this.gitignoreManager.initialize();

      const watcher = await getUnifiedWatcher(this.workspaceId, this.workspacePath);

      this.unsubscribe = watcher.subscribe({
        id: `file-watcher:${this.workspaceId}`,
        pathPatterns: ['**'],
        callback: (event: WatchEvent) => {
          this.handleFileEvent(event.type, event.path, event.relativePath);
        },
        onError: (error: Error) => {
          this.emit('error', error);
        },
        onRescanRequired: () => {
          logger.info('Rescan required, emitting rescan event', {
            workspacePath: this.workspacePath,
          });
          this.emit('rescan-required');
        },
      });

      this.isWatching = true;

      logger.info('File watcher started (via UnifiedWorkspaceWatcher)', {
        workspacePath: this.workspacePath,
      });
    } catch (error) {
      logger.error('Failed to start file watcher:', error);
      throw error;
    }
  }

  /**
   * Stop watching the workspace
   */
  async stop(): Promise<void> {
    if (!this.isWatching) {
      return;
    }

    try {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
      this.isWatching = false;

      // Clear all debounce timers
      for (const timer of this.debounceTimers.values()) {
        clearTimeout(timer);
      }
      this.debounceTimers.clear();

      logger.info('File watcher stopped');
    } catch (error) {
      logger.error('Error stopping file watcher:', error);
    }
  }

  /**
   * Handle file events with debouncing
   */
  private handleFileEvent(type: FileWatchEvent['type'], path: string, relativePath: string): void {
    // Skip if file should be ignored
    if (this.shouldIgnoreFile(relativePath)) {
      return;
    }

    // Clear existing debounce timer for this file
    const existingTimer = this.debounceTimers.get(path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      const event: FileWatchEvent = {
        type,
        path,
        relativePath,
        timestamp: new Date().toISOString(),
      };

      this.emit('file-change', event);
      this.debounceTimers.delete(path);
    }, this.config.fileWatcherDebounce);

    this.debounceTimers.set(path, timer);
  }

  /**
   * Check if a file should be ignored
   */
  private shouldIgnoreFile(relativePath: string): boolean {
    // Check additional ignore patterns
    for (const pattern of this.config.additionalIgnorePatterns) {
      if (relativePath.includes(pattern.replace('**', ''))) {
        return true;
      }
    }

    // Check gitignore
    return this.gitignoreManager.shouldIgnore(relativePath);
  }

  /**
   * Get watcher statistics
   */
  getStats(): { isWatching: boolean; watchedPaths: number } {
    return {
      isWatching: this.isWatching,
      watchedPaths: 0, // Paths are tracked by UnifiedWorkspaceWatcher
    };
  }

  /**
   * Add a path to watch (no-op: UnifiedWorkspaceWatcher watches the entire tree)
   */
  addPath(path: string): void {
    logger.debug(`addPath is a no-op under UnifiedWorkspaceWatcher: ${path}`);
  }

  /**
   * Remove a path from watching (no-op: UnifiedWorkspaceWatcher watches the entire tree)
   */
  removePath(path: string): void {
    logger.debug(`removePath is a no-op under UnifiedWorkspaceWatcher: ${path}`);
  }

  /**
   * Update gitignore patterns
   */
  async updateIgnorePatterns(): Promise<void> {
    await this.gitignoreManager.initialize();
    // No need to restart — filtering is applied in handleFileEvent
  }
}

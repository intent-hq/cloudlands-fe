/**
 * Spec File Watcher
 *
 * Watches SPEC.md files for changes from external apps and emits events
 * to keep the workspace spec in sync. Prevents infinite loops by tracking
 * the last update timestamp and content hash.
 */

import { Logger } from '$shared/logger';
import {
  readFileSync,
  existsSync,
} from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { EventEmitter } from '$shared/utils/event-emitter';
import * as crypto from 'crypto';
import { UnifiedWorkspaceWatcher } from './unified-workspace-watcher';

const logger = new Logger('SpecFileWatcher');

interface SpecFileWatcherConfig {
  workspaceId: string;
  workspacePath: string;
  onSpecUpdated?: (data: {
    workspaceId: string;
    content: string;
    specPath: string;
    timestamp: string;
  }) => void;
}

export class SpecFileWatcher extends EventEmitter {
  private workspaceId: string;
  private workspacePath: string;
  private specPath: string;
  private unsubscribe: (() => void) | null = null;
  private lastUpdateTimestamp: number = 0;
  private lastContentHash: string = '';
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = 500; // ms
  private readonly MIN_UPDATE_INTERVAL = 1000; // ms - prevent rapid updates

  constructor(config: SpecFileWatcherConfig) {
    super();
    this.workspaceId = config.workspaceId;
    this.workspacePath = config.workspacePath;
    this.specPath = join(this.workspacePath, 'SPEC.md');

    if (config.onSpecUpdated) {
      this.on('note:updated', config.onSpecUpdated);
    }
  }

  /**
   * Start watching the SPEC.md file
   */
  start(): void {
    if (this.unsubscribe) {
      logger.info(`[SpecFileWatcher] Already watching SPEC.md for workspace ${this.workspaceId}`);
      return;
    }

    // Check if the spec file exists and initialize hash
    if (existsSync(this.specPath)) {
      try {
        const initialContent = readFileSync(this.specPath, 'utf-8');
        this.lastContentHash = this.hashContent(initialContent);
        logger.info(`[SpecFileWatcher] Initialized with existing SPEC.md at ${this.specPath}`);
      } catch (error) {
        logger.warn(`[SpecFileWatcher] Failed to read initial SPEC.md at ${this.specPath}:`, error);
      }
    } else {
      logger.warn(
        `[SpecFileWatcher] SPEC.md does not exist at ${this.specPath}, will watch for creation`,
      );
    }

    logger.info(
      `[SpecFileWatcher] Starting to watch SPEC.md for workspace ${this.workspaceId} at ${this.specPath}`,
    );

    const unifiedWatcher = UnifiedWorkspaceWatcher.getInstance(
      this.workspaceId,
      this.workspacePath,
    );

    this.unsubscribe = unifiedWatcher.subscribe({
      id: `spec-file-watcher:${this.workspaceId}`,
      pathPatterns: ['SPEC.md'],
      eventTypes: ['add', 'change'],
      callback: (event) => {
        logger.info(`[SpecFileWatcher] File ${event.type}: ${event.path}`);
        this.handleSpecFileChange();
      },
      onError: (error) => {
        this.emit('error', error);
      },
      onRescanRequired: () => {
        logger.info(
          `[SpecFileWatcher] Rescan required for workspace ${this.workspaceId}, re-reading SPEC.md`,
        );
        this.handleSpecFileChange();
      },
    });
  }

  /**
   * Stop watching the SPEC.md file
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      logger.info(`[SpecFileWatcher] Stopped watching SPEC.md for workspace ${this.workspaceId}`);
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Handle SPEC.md file change with debouncing and deduplication
   */
  private handleSpecFileChange(): void {
    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Debounce the file read to avoid processing multiple rapid changes
    this.debounceTimer = setTimeout(() => {
      this.readAndEmitSpecUpdate();
    }, this.DEBOUNCE_DELAY);
  }

  /**
   * Read the spec file and emit update if content has changed
   */
  private async readAndEmitSpecUpdate(): Promise<void> {
    try {
      const content = await readFile(this.specPath, 'utf-8');
      const contentHash = this.hashContent(content);
      const now = Date.now();

      // Prevent infinite loops by checking:
      // 1. Content has actually changed (hash is different)
      // 2. Enough time has passed since last update
      const contentChanged = contentHash !== this.lastContentHash;
      const enoughTimePassed = now - this.lastUpdateTimestamp >= this.MIN_UPDATE_INTERVAL;

      if (!contentChanged) {
        logger.info(
          `[SpecFileWatcher] Ignoring duplicate update (same content) for workspace ${this.workspaceId}`,
        );
        return;
      }

      if (!enoughTimePassed) {
        logger.info(
          `[SpecFileWatcher] Ignoring update (too soon) for workspace ${this.workspaceId}. Time since last update: ${now - this.lastUpdateTimestamp}ms`,
        );
        return;
      }

      // Update tracking state
      this.lastContentHash = contentHash;
      this.lastUpdateTimestamp = now;

      logger.info(
        `[SpecFileWatcher] SPEC.md changed for workspace ${this.workspaceId}, emitting update`,
      );

      // Emit the update event (spec is just a note with ID "spec")
      this.emit('note:updated', {
        workspaceId: this.workspaceId,
        noteId: 'spec',
        content,
        specPath: this.specPath,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        `[SpecFileWatcher] Failed to read SPEC.md for workspace ${this.workspaceId}:`,
        error,
      );
      this.emit('error', error);
    }
  }

  /**
   * Generate a hash of the content to detect changes
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Update the last update timestamp (called when we write the spec)
   * This prevents the watcher from emitting an event for our own writes
   */
  updateLastTimestamp(): void {
    this.lastUpdateTimestamp = Date.now();
  }
}

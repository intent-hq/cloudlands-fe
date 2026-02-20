/**
 * File Tracking Storage Service
 *
 * Handles persistence of file tracking data in workspace metadata folder
 */

import fs from 'fs-extra';
import * as path from 'path';
import type { TrackedChange, StageTransition, AgentAttribution } from '../types';
import { WorkspaceConfig } from '$shared/main/config';
import { Logger } from '$lib/utils/logger';
import { fsyncFile, fsyncDir, renameWithRetry } from '$shared/main/file-sync-utils';

const logger = new Logger({ category: 'FileTrackingStorage' });

/**
 * Storage service for file tracking data.
 * Handles persistence of tracked changes and transitions in workspace metadata folder.
 * Implements singleton pattern per workspace with caching and automatic cleanup.
 *
 * @class FileTrackingStorage
 * @example
 * ```typescript
 * const storage = FileTrackingStorage.getInstance('workspace-123');
 * const changes = await storage.loadTrackedChanges();
 * await storage.saveTrackedChanges(updatedChanges);
 * ```
 */
export class FileTrackingStorage {
  // Singleton instances per workspace
  /** @property {Map<string, FileTrackingStorage>} instances - Map of workspace ID to storage instance */
  private static instances = new Map<string, FileTrackingStorage>();

  /** @property {string} metadataPath - Path to metadata storage directory */
  private metadataPath: string;
  /** @property {string} workspaceId - Unique identifier for the workspace */
  private workspaceId: string;
  /** @property {Promise<void> | null} saveLock - Lock for save operations to prevent concurrent writes */
  private saveLock: Promise<void> | null = null;
  /** @property {Promise<void> | null} transitionSaveLock - Lock for transition save operations */
  private transitionSaveLock: Promise<void> | null = null;
  /** @property {NodeJS.Timeout | null} cleanupTimer - Timer for periodic cleanup */
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** @property {number} lastCleanupTime - Timestamp of last cleanup operation */
  private lastCleanupTime = 0;
  /** @property {number} lastAccessTime - Timestamp of last access to tracked changes */
  private lastAccessTime = Date.now();
  /** @property {number} CLEANUP_INTERVAL - Interval between cleanup runs in ms */
  private readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  /** @property {number} DATA_RETENTION_DAYS - Number of days to retain data */
  private readonly DATA_RETENTION_DAYS = 7;

  // Cache for tracked changes to reduce disk reads
  /** @property {TrackedChange[] | null} trackedChangesCache - Cached tracked changes */
  private trackedChangesCache: TrackedChange[] | null = null;
  /** @property {number} cacheTimestamp - Timestamp when cache was last updated */
  private cacheTimestamp = 0;
  /** @property {number} CACHE_TTL - Cache time-to-live for existing data in ms */
  private readonly CACHE_TTL = 5000; // 5 seconds cache TTL for existing data
  /** @property {number} CACHE_TTL_EMPTY - Cache time-to-live for non-existent files in ms */
  private readonly CACHE_TTL_EMPTY = 30000; // 30 seconds cache TTL for non-existent files
  /** @property {boolean} hasLoggedMissingFile - Flag to track if missing file has been logged */
  private hasLoggedMissingFile = false; // Track if we've already logged missing file for this instance

  /**
   * Private constructor for singleton pattern.
   * Initializes storage path and starts cleanup timer.
   *
   * @private
   * @param {string} workspaceId - The unique identifier of the workspace
   */
  private constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    // Store in user's workspace metadata folder, not in repo
    // Resolves both ~/intent and legacy ~/.workspaces
    this.metadataPath = path.join(WorkspaceConfig.paths.metadata(workspaceId), 'file-tracking');

    // Defer directory creation to first use to avoid blocking
    // The ensureDirectory() method will be called before any file operations

    // Start periodic cleanup
    this.startCleanupTimer();
  }

  /**
   * Get or create a singleton instance for a workspace.
   * Ensures only one storage instance exists per workspace.
   *
   * @static
   * @param {string} workspaceId - The unique identifier of the workspace
   * @returns {FileTrackingStorage} The storage instance for the workspace
   * @example
   * ```typescript
   * const storage = FileTrackingStorage.getInstance('workspace-123');
   * ```
   */
  static getInstance(workspaceId: string): FileTrackingStorage {
    if (!FileTrackingStorage.instances.has(workspaceId)) {
      logger.debug('Creating new FileTrackingStorage instance', { workspaceId });
      FileTrackingStorage.instances.set(workspaceId, new FileTrackingStorage(workspaceId));
    } else {
      logger.debug('Reusing existing FileTrackingStorage instance', { workspaceId });
    }
    return FileTrackingStorage.instances.get(workspaceId)!;
  }

  /**
   * Cleanup a specific workspace instance
   * Called when workspace is deleted to prevent memory leaks
   *
   * @static
   * @param {string} workspaceId - The unique identifier of the workspace
   */
  static cleanupWorkspace(workspaceId: string): void {
    const instance = FileTrackingStorage.instances.get(workspaceId);
    if (instance) {
      instance.cleanup();
    }
  }

  /**
   * Start periodic cleanup timer
   */
  private startCleanupTimer(): void {
    // Run cleanup every hour
    this.cleanupTimer = setInterval(() => {
      this.performCleanup().catch((error) => {
        logger.error('Cleanup failed', error as Error);
      });
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Perform cleanup of old data
   */
  private async performCleanup(): Promise<void> {
    const now = Date.now();

    // Skip if we cleaned up recently
    if (now - this.lastCleanupTime < this.CLEANUP_INTERVAL / 2) {
      return;
    }

    // Skip cleanup if workspace is actively being used (accessed within last hour)
    // This prevents deleting data that the user is currently viewing
    if (now - this.lastAccessTime < this.CLEANUP_INTERVAL) {
      logger.debug('Skipping cleanup - workspace recently accessed', {
        workspaceId: this.workspaceId,
        timeSinceLastAccess: now - this.lastAccessTime,
      });
      return;
    }

    this.lastCleanupTime = now;

    try {
      const changes = await this.loadTrackedChanges();
      const cutoffTime = now - this.DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;

      const recentChanges = changes.filter((change) => change.attribution.timestamp > cutoffTime);

      if (recentChanges.length < changes.length) {
        await this._doSave(recentChanges);
        logger.info('Cleaned up old tracking data', {
          workspaceId: this.workspaceId,
          removed: changes.length - recentChanges.length,
          kept: recentChanges.length,
        });
      }
    } catch (error) {
      logger.error('Failed to perform cleanup', error as Error);
    }
  }

  /**
   * Stop cleanup timer and remove from singleton instances
   */
  public cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Remove from singleton instances
    FileTrackingStorage.instances.delete(this.workspaceId);

    logger.debug('FileTrackingStorage cleaned up', { workspaceId: this.workspaceId });
  }

  /**
   * Clear all singleton instances (for testing or shutdown)
   */
  static clearAllInstances(): void {
    for (const [workspaceId, instance] of FileTrackingStorage.instances) {
      instance.cleanup();
    }
    FileTrackingStorage.instances.clear();
  }

  /**
   * Get the full path for a metadata file
   */
  private getFilePath(filename: string): string {
    return path.join(this.metadataPath, filename);
  }

  /**
   * Ensure the metadata directory exists
   */
  private async ensureDirectory(): Promise<void> {
    await fs.ensureDir(this.metadataPath);
  }

  /**
   * Load tracked changes from storage
   */
  async loadTrackedChanges(): Promise<TrackedChange[]> {
    // Update last access time to prevent cleanup during active usage
    this.lastAccessTime = Date.now();

    // Check cache first
    const now = Date.now();

    // Determine cache TTL based on whether we have data or not
    const effectiveCacheTTL =
      this.trackedChangesCache && this.trackedChangesCache.length > 0
        ? this.CACHE_TTL
        : this.CACHE_TTL_EMPTY;

    if (this.trackedChangesCache !== null && now - this.cacheTimestamp < effectiveCacheTTL) {
      // Use debug level for cache hits to reduce noise
      if (this.trackedChangesCache.length > 0) {
        logger.debug('Using cached tracked changes', {
          workspaceId: this.workspaceId,
          cacheAge: now - this.cacheTimestamp,
        });
      }
      return this.trackedChangesCache;
    }

    try {
      const filePath = this.getFilePath('file-tracking.json');
      if (!(await fs.pathExists(filePath))) {
        // Only log once per instance to reduce noise
        if (!this.hasLoggedMissingFile) {
          logger.debug('No existing file tracking data found', { workspaceId: this.workspaceId });
          this.hasLoggedMissingFile = true;
        }
        this.trackedChangesCache = [];
        this.cacheTimestamp = now;
        return [];
      }

      // Check if file is empty or corrupted
      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        logger.warn('File tracking data file is empty, initializing with empty array', {
          workspaceId: this.workspaceId,
        });
        // Initialize with empty data
        await this.saveTrackedChanges([]);
        return [];
      }

      let data;
      try {
        data = await fs.readJson(filePath);
      } catch (parseError) {
        logger.error('Failed to parse file tracking data, resetting', parseError as Error);
        // Reset corrupted file
        await this.saveTrackedChanges([]);
        return [];
      }

      const changes = data.trackedChanges || [];

      // Update cache
      this.trackedChangesCache = changes;
      this.cacheTimestamp = now;

      // Reset the flag since we now have a file
      this.hasLoggedMissingFile = false;

      // Log summary for debugging (don't log all changes for performance)
      logger.debug('Loaded tracked changes', {
        count: changes.length,
        workspaceId: this.workspaceId,
      });

      return changes;
    } catch (error) {
      logger.error(
        'Failed to load tracked changes',
        error instanceof Error ? error : new Error(String(error)),
        { workspaceId: this.workspaceId },
      );
      return [];
    }
  }

  /**
   * Save tracked changes to storage atomically with locking
   * OPTIMIZED: Atomic write with lock to prevent data corruption and race conditions
   * Cache is invalidated AFTER save completes to prevent race conditions
   */
  async saveTrackedChanges(changes: TrackedChange[]): Promise<void> {
    // Deduplicate changes by file path (keep latest)
    const deduplicatedChanges = this.deduplicateChanges(changes);

    // Wait for any existing save operation to complete
    if (this.saveLock) {
      logger.debug('Waiting for existing save operation to complete', {
        workspaceId: this.workspaceId,
      });
      await this.saveLock;
    }

    // Create a new lock for this save operation
    this.saveLock = this._doSave(deduplicatedChanges);

    try {
      await this.saveLock;
      // Invalidate cache AFTER save completes to prevent race conditions
      // This ensures that any concurrent load operations will wait for the save to finish
      this.trackedChangesCache = null;
      this.cacheTimestamp = 0;
    } finally {
      // Clear the lock when done
      this.saveLock = null;
    }
  }

  /**
   * Deduplicate changes by keeping only the latest change per file per stage per commit
   * For committed changes, we keep all commits (different commitHash values)
   * For other stages, we keep only the latest change per file per stage
   */
  private deduplicateChanges(changes: TrackedChange[]): TrackedChange[] {
    const changeMap = new Map<string, TrackedChange>();

    for (const change of changes) {
      // For committed changes, include commitHash in the key to preserve all commits
      // For other stages, use file:stage as key to keep only the latest
      const key = change.commitHash
        ? `${change.file}:${change.stage}:${change.commitHash}`
        : `${change.file}:${change.stage}`;

      const existing = changeMap.get(key);
      if (!existing || change.attribution.timestamp > existing.attribution.timestamp) {
        changeMap.set(key, change);
      }
    }

    return Array.from(changeMap.values());
  }

  /**
   * Internal method to perform the actual save operation.
   * PERF: Uses fast path for frequent saves (skips fsync/backup) and durable path for critical saves.
   * @param changes - Changes to save
   * @param durable - If true, use full fsync and backup (slower but safer). Default: false for performance.
   */
  private async _doSave(changes: TrackedChange[], durable = false): Promise<void> {
    try {
      await this.ensureDirectory();
      const filePath = this.getFilePath('file-tracking.json');

      // Use a unique temp file name to avoid conflicts with concurrent operations
      const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 11)}`;

      // Log summary for debugging (don't log all changes for performance)
      logger.debug('Saving tracked changes', {
        count: changes.length,
        workspaceId: this.workspaceId,
        durable,
      });

      const data = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        workspaceId: this.workspaceId,
        trackedChanges: changes,
      };

      // PERF: Fast path - skip fsync and backup for frequent saves
      // The atomic rename still provides crash safety for the file itself
      if (!durable) {
        try {
          await fs.writeJson(tempPath, data, { spaces: 2 });
          await renameWithRetry(tempPath, filePath);

          logger.debug('Saved tracked changes (fast path)', {
            count: changes.length,
            workspaceId: this.workspaceId,
          });
        } catch (fastPathError) {
          // Clean up orphaned temp file on failure
          try {
            if (await fs.pathExists(tempPath)) {
              await fs.remove(tempPath);
            }
          } catch {
            // Ignore cleanup errors
          }
          throw fastPathError;
        }
        return;
      }

      // Durable path - full fsync and backup for critical saves
      const backupPath = `${filePath}.backup`;

      // Step 1: Write to temporary file with fsync for durability
      await fs.writeJson(tempPath, data, { spaces: 2 });
      await fsyncFile(tempPath);

      // Step 2: Create backup of existing file if it exists
      if (await fs.pathExists(filePath)) {
        try {
          await fs.copy(filePath, backupPath, { overwrite: true });
        } catch (backupError) {
          logger.warn('Failed to create backup, continuing with save', backupError as Error);
        }
      }

      // Step 3: Atomically rename temp file to actual file
      await renameWithRetry(tempPath, filePath);

      // Step 4: Sync parent directory to ensure rename is durable
      await fsyncDir(path.dirname(filePath));

      // Step 5: Clean up backup after successful write
      if (await fs.pathExists(backupPath)) {
        try {
          await fs.remove(backupPath);
        } catch (cleanupError) {
          logger.warn('Failed to clean up backup file', cleanupError as Error);
        }
      }

      logger.debug('Saved tracked changes (durable)', {
        count: changes.length,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      logger.error(
        'Failed to save tracked changes',
        error instanceof Error ? error : new Error(String(error)),
        { workspaceId: this.workspaceId },
      );

      // Try to restore from backup if available
      const filePath = this.getFilePath('file-tracking.json');
      const backupPath = `${filePath}.backup`;
      if (await fs.pathExists(backupPath)) {
        try {
          await fs.copy(backupPath, filePath, { overwrite: true });
          logger.info('Restored from backup after save failure');
        } catch (restoreError) {
          logger.error('Failed to restore from backup', restoreError as Error);
        }
      }

      throw error;
    }
  }

  /**
   * Load stage transitions history
   */
  async loadTransitions(): Promise<StageTransition[]> {
    try {
      const filePath = this.getFilePath('stage-transitions.json');
      if (!(await fs.pathExists(filePath))) {
        return [];
      }

      const data = await fs.readJson(filePath);
      return data.transitions || [];
    } catch (error) {
      logger.error(
        'Failed to load transitions',
        error instanceof Error ? error : new Error(String(error)),
        { workspaceId: this.workspaceId },
      );
      return [];
    }
  }

  /**
   * Save stage transitions history atomically with locking
   * OPTIMIZED: Atomic write with lock to prevent data corruption and race conditions
   */
  async saveTransitions(transitions: StageTransition[]): Promise<void> {
    // Wait for any existing save operation to complete
    if (this.transitionSaveLock) {
      logger.debug('Waiting for existing transition save operation to complete', {
        workspaceId: this.workspaceId,
      });
      await this.transitionSaveLock;
    }

    // Create a new lock for this save operation
    this.transitionSaveLock = this._doSaveTransitions(transitions);

    try {
      await this.transitionSaveLock;
    } finally {
      // Clear the lock when done
      this.transitionSaveLock = null;
    }
  }

  /**
   * Internal method to perform the actual transition save operation
   */
  private async _doSaveTransitions(transitions: StageTransition[]): Promise<void> {
    try {
      await this.ensureDirectory();
      const filePath = this.getFilePath('stage-transitions.json');

      // Use a unique temp file name to avoid conflicts
      const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 11)}`;

      const data = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        workspaceId: this.workspaceId,
        transitions,
      };

      // Write to temp file first, then atomically rename
      await fs.writeJson(tempPath, data, { spaces: 2 });
      await renameWithRetry(tempPath, filePath);

      logger.debug('Saved stage transitions atomically', {
        count: transitions.length,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      logger.error(
        'Failed to save transitions',
        error instanceof Error ? error : new Error(String(error)),
        { workspaceId: this.workspaceId },
      );
      throw error;
    }
  }

  /**
   * Load agent attributions cache
   */
  async loadAttributions(): Promise<Map<string, AgentAttribution>> {
    try {
      const filePath = this.getFilePath('agent-attributions.json');
      if (!(await fs.pathExists(filePath))) {
        return new Map();
      }

      const data = await fs.readJson(filePath);
      return new Map(data.attributions || []);
    } catch (error) {
      logger.error(
        'Failed to load attributions',
        error instanceof Error ? error : new Error(String(error)),
        { workspaceId: this.workspaceId },
      );
      return new Map();
    }
  }

  /**
   * Save agent attributions atomically
   * OPTIMIZED: Atomic write to prevent data corruption
   */
  async saveAttributions(attributions: Map<string, AgentAttribution>): Promise<void> {
    try {
      await this.ensureDirectory();
      const filePath = this.getFilePath('agent-attributions.json');

      // Use a unique temp file name to avoid conflicts with concurrent operations
      const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 11)}`;

      const data = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        workspaceId: this.workspaceId,
        attributions: Array.from(attributions.entries()),
      };

      // Write to temp file first, then atomically rename
      await fs.writeJson(tempPath, data, { spaces: 2 });
      await renameWithRetry(tempPath, filePath);

      logger.debug('Saved agent attributions atomically', {
        count: attributions.size,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      logger.error(
        'Failed to save attributions',
        error instanceof Error ? error : new Error(String(error)),
        { workspaceId: this.workspaceId },
      );
      throw error;
    }
  }
}

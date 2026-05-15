/**
 * Snapshot Manager Module
 *
 * Manages file snapshots for change detection.
 * Tracks file states and detects changes between snapshots.
 */

import {
  readFile,
  stat,
} from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { Logger } from '../../../../shared/logger';
import { TRACKING_CONFIG } from '../../../file-tracking/tracking.config';

const logger = new Logger('SnapshotManager');

export interface FileSnapshot {
  path: string;
  hash: string;
  size: number;
  mtime: string;
  content?: string;
  timestamp: string;
}

export interface SnapshotDiff {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  oldSnapshot?: FileSnapshot;
  newSnapshot?: FileSnapshot;
  contentChanged: boolean;
  sizeChanged: boolean;
  mtimeChanged: boolean;
}

export class SnapshotManager {
  private workspacePath: string;
  private snapshots: Map<string, FileSnapshot> = new Map();
  private config = TRACKING_CONFIG.changeDetection;
  private maxSnapshotSize: number = 10 * 1024 * 1024; // 10MB
  private maxSnapshots: number = 1000; // Maximum number of snapshots to keep in memory
  private snapshotAccessOrder: string[] = []; // Track access order for LRU

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Take a snapshot of a file
   */
  async takeSnapshot(
    filePath: string,
    includeContent: boolean = false,
  ): Promise<FileSnapshot | null> {
    try {
      const fullPath = join(this.workspacePath, filePath);
      const stats = await stat(fullPath);

      if (!stats.isFile()) {
        return null;
      }

      // Read file content
      let content: string | undefined;
      let hash: string;

      if (stats.size <= this.maxSnapshotSize) {
        const buffer = await readFile(fullPath);
        hash = createHash('sha256').update(buffer).digest('hex');

        if (includeContent) {
          content = buffer.toString('utf-8');
        }
      } else {
        // For large files, just use size and mtime
        hash = `large-file-${stats.size}-${stats.mtime.getTime()}`;
        logger.debug(`File too large for content hashing: ${filePath} (${stats.size} bytes)`);
      }

      const snapshot: FileSnapshot = {
        path: filePath,
        hash,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        content,
        timestamp: new Date().toISOString(),
      };

      // Store snapshot
      this.snapshots.set(filePath, snapshot);

      return snapshot;
    } catch (error) {
      logger.error(`Failed to take snapshot of ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Take snapshots of multiple files
   */
  async takeSnapshots(
    filePaths: string[],
    includeContent: boolean = false,
  ): Promise<Map<string, FileSnapshot>> {
    const results = new Map<string, FileSnapshot>();
    const batchSize = this.config.maxParallelFileProcessing;

    // Process in batches
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      const snapshots = await Promise.all(
        batch.map((path) => this.takeSnapshot(path, includeContent)),
      );

      for (let j = 0; j < batch.length; j++) {
        const snapshot = snapshots[j];
        if (snapshot) {
          results.set(batch[j], snapshot);
        }
      }
    }

    return results;
  }

  /**
   * Get a stored snapshot
   */
  getSnapshot(filePath: string): FileSnapshot | undefined {
    const snapshot = this.snapshots.get(filePath);
    if (snapshot) {
      this.updateAccessOrder(filePath);
    }
    return snapshot;
  }

  /**
   * Compare current state with stored snapshot
   */
  async compareWithSnapshot(filePath: string): Promise<SnapshotDiff | null> {
    const oldSnapshot = this.snapshots.get(filePath);
    const newSnapshot = await this.takeSnapshot(filePath, false);

    if (!newSnapshot && !oldSnapshot) {
      return null;
    }

    if (!oldSnapshot && newSnapshot) {
      return {
        path: filePath,
        type: 'added',
        newSnapshot,
        contentChanged: true,
        sizeChanged: true,
        mtimeChanged: true,
      };
    }

    if (oldSnapshot && !newSnapshot) {
      return {
        path: filePath,
        type: 'deleted',
        oldSnapshot,
        contentChanged: true,
        sizeChanged: true,
        mtimeChanged: true,
      };
    }

    if (oldSnapshot && newSnapshot) {
      const contentChanged = oldSnapshot.hash !== newSnapshot.hash;
      const sizeChanged = oldSnapshot.size !== newSnapshot.size;
      const mtimeChanged = oldSnapshot.mtime !== newSnapshot.mtime;

      if (contentChanged || sizeChanged || mtimeChanged) {
        return {
          path: filePath,
          type: 'modified',
          oldSnapshot,
          newSnapshot,
          contentChanged,
          sizeChanged,
          mtimeChanged,
        };
      }
    }

    return null;
  }

  /**
   * Compare multiple files with their snapshots
   */
  async compareSnapshots(filePaths: string[]): Promise<SnapshotDiff[]> {
    const diffs: SnapshotDiff[] = [];
    const batchSize = this.config.maxParallelFileProcessing;

    // Process in batches
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((path) => this.compareWithSnapshot(path)));

      for (const diff of results) {
        if (diff) {
          diffs.push(diff);
        }
      }
    }

    // Check for deleted files
    for (const [path, snapshot] of this.snapshots.entries()) {
      if (!filePaths.includes(path)) {
        diffs.push({
          path,
          type: 'deleted',
          oldSnapshot: snapshot,
          contentChanged: true,
          sizeChanged: true,
          mtimeChanged: true,
        });
      }
    }

    return diffs;
  }

  /**
   * Update snapshot for a file
   */
  updateSnapshot(filePath: string, snapshot: FileSnapshot): void {
    this.snapshots.set(filePath, snapshot);
    this.updateAccessOrder(filePath);
    this.enforceSnapshotLimit();
  }

  /**
   * Update access order for LRU tracking
   */
  private updateAccessOrder(filePath: string): void {
    // Remove from current position if exists
    const index = this.snapshotAccessOrder.indexOf(filePath);
    if (index > -1) {
      this.snapshotAccessOrder.splice(index, 1);
    }
    // Add to end (most recently used)
    this.snapshotAccessOrder.push(filePath);
  }

  /**
   * Enforce maximum snapshot limit using LRU eviction
   */
  private enforceSnapshotLimit(): void {
    while (this.snapshots.size > this.maxSnapshots && this.snapshotAccessOrder.length > 0) {
      // Remove least recently used
      const lruPath = this.snapshotAccessOrder.shift();
      if (lruPath) {
        this.snapshots.delete(lruPath);
        logger.debug('Evicted snapshot due to memory limit', {
          path: lruPath,
          remainingSnapshots: this.snapshots.size,
        });
      }
    }
  }

  /**
   * Remove snapshot for a file
   */
  removeSnapshot(filePath: string): void {
    this.snapshots.delete(filePath);
  }

  /**
   * Clear all snapshots
   */
  clearSnapshots(): void {
    this.snapshots.clear();
    logger.debug('Cleared all snapshots');
  }

  /**
   * Get all current snapshots
   */
  getAllSnapshots(): Map<string, FileSnapshot> {
    return new Map(this.snapshots);
  }

  /**
   * Get snapshot count
   */
  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  /**
   * Get total size of all snapshots
   */
  getTotalSize(): number {
    let total = 0;
    for (const snapshot of this.snapshots.values()) {
      total += snapshot.size;
    }
    return total;
  }

  /**
   * Prune old snapshots based on timestamp
   */
  pruneOldSnapshots(maxAge: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAge;
    let pruned = 0;

    for (const [path, snapshot] of this.snapshots.entries()) {
      const timestamp = new Date(snapshot.timestamp).getTime();
      if (timestamp < cutoff) {
        this.snapshots.delete(path);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.debug(`Pruned ${pruned} old snapshots`);
    }

    return pruned;
  }

  /**
   * Export snapshots to JSON
   */
  exportSnapshots(): string {
    const data = {
      workspacePath: this.workspacePath,
      timestamp: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      snapshots: Array.from(this.snapshots.entries()).map(([path, snapshot]) => ({
        ...snapshot,
        content: undefined, // Don't export content to keep size manageable
      })),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Import snapshots from JSON
   */
  importSnapshots(json: string): void {
    try {
      const data = JSON.parse(json);

      if (data.workspacePath !== this.workspacePath) {
        logger.warn('Snapshot data is for a different workspace');
        return;
      }

      this.snapshots.clear();

      for (const snapshot of data.snapshots) {
        this.snapshots.set(snapshot.path, snapshot);
      }

      logger.info(`Imported ${data.snapshots.length} snapshots`);
    } catch (error) {
      logger.error('Failed to import snapshots:', error);
      throw error;
    }
  }
}

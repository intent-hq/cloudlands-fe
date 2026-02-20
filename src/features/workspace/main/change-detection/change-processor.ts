/**
 * Change Processor Module
 *
 * Processes detected file changes and converts them to events.
 * Handles deduplication, batching, and event emission.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { readFile } from 'fs/promises';
import { join, relative, isAbsolute } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  extractChangesFromDiff,
  extractChangesFromContents,
} from '../../../diffs/main/extract-change-hunks';
import { GitignoreManager } from '../../../../lib/utils/main/gitignore-manager';
import { getAttributionEngine } from '../provenance/attribution-engine';
import { Logger } from '../../../../shared/logger';
import type { WorkspaceEventType, WorkspaceEvent } from '../../../../features/events/types';
import { TRACKING_CONFIG } from '../../../file-tracking/tracking.config';
import type { GitDiffResult } from './git-types';
// Import FileChange from the shared types instead of defining locally
import type { FileChange } from '../../change-detector.types';
export type { FileChange } from '../../change-detector.types';
import { isGitRepository, storeBlob } from '../../../../shared/git/git-blob-storage';

const logger = new Logger('ChangeProcessor');

export interface ProcessedChange {
  change: FileChange;
  event: WorkspaceEvent;
  chunks?: any[];
}

interface TrackedChange {
  key: string;
  lastSeen: number;
  hash: string; // Hash of the change details to detect actual changes
  emitted: boolean; // Whether we've emitted an event for this
}

export interface ProcessorStats {
  totalProcessed: number;
  totalEmitted: number;
  duplicatesFiltered: number;
}

export class ChangeProcessor extends EventEmitter {
  private workspacePath: string;
  private workspaceId: string;
  private gitignoreManager: GitignoreManager;
  private config = TRACKING_CONFIG.changeDetection;
  private processedChanges: Set<string> = new Set();
  private trackedChanges: Map<string, TrackedChange> = new Map();
  private batchQueue: ProcessedChange[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private attributionEngine = getAttributionEngine();
  private stats: ProcessorStats = {
    totalProcessed: 0,
    totalEmitted: 0,
    duplicatesFiltered: 0,
  };
  private isGitRepo: boolean | null = null; // Cached git repo check

  constructor(workspacePath: string, workspaceId: string) {
    super();
    this.workspacePath = workspacePath;
    this.workspaceId = workspaceId;
    this.gitignoreManager = new GitignoreManager(workspacePath);
    this.isGitRepo = isGitRepository(workspacePath); // Check once at construction

    // Start periodic cleanup to prevent memory leaks
    this.startPeriodicCleanup();
  }

  /**
   * Initialize the processor
   */
  async initialize(): Promise<void> {
    try {
      await this.gitignoreManager.initialize();
      logger.info('Change processor initialized', { workspaceId: this.workspaceId });
    } catch (error) {
      logger.error('Failed to initialize change processor', {
        workspaceId: this.workspaceId,
        error,
      });
      throw error; // Re-throw to let caller handle it
    }
  }

  /**
   * Process a file change
   */
  async processFileChange(
    filePath: string,
    action: FileChange['action'],
    diff?: GitDiffResult,
    stage?: 'staged' | 'unstaged',
    oldPath?: string, // For rename operations
  ): Promise<ProcessedChange | null> {
    try {
      // Check if file should be ignored
      if (this.shouldIgnoreFile(filePath)) {
        return null;
      }

      // Create change key and hash for tracking
      const changeKey = `${filePath}:${action}:${stage || 'unstaged'}`;
      const changeHash = `${action}:${diff?.additions || 0}:${diff?.deletions || 0}`;

      // Check if this is a known persistent change (like unstaged modifications)
      const tracked = this.trackedChanges.get(changeKey);
      const now = Date.now();

      if (tracked) {
        // Update last seen time
        tracked.lastSeen = now;

        // If the change hasn't actually changed and we've already emitted it, skip
        if (tracked.hash === changeHash && tracked.emitted) {
          // Only log for non-persistent changes or occasionally for persistent ones
          if (stage !== 'unstaged' || Math.random() < 0.01) {
            // Log 1% of the time for unstaged
            logger.debug(`Skipping duplicate change: ${changeKey}`);
          }
          this.stats.duplicatesFiltered++;
          return null;
        }

        // If the change has changed, we'll process it
        if (tracked.hash !== changeHash) {
          // PERF: Changed from INFO to DEBUG - called for every file change
          logger.debug(`Change updated: ${changeKey} (was: ${tracked.hash}, now: ${changeHash})`);
          tracked.hash = changeHash;
          tracked.emitted = false; // Reset emitted flag since it changed
        }
      } else {
        // New change, track it
        this.trackedChanges.set(changeKey, {
          key: changeKey,
          lastSeen: now,
          hash: changeHash,
          emitted: false,
        });
      }

      // Create file change object
      let additions = diff?.additions || 0;
      const deletions = diff?.deletions || 0;
      let content: string | undefined;

      // Get file content if needed
      if (action !== 'Delete') {
        try {
          const fullPath = join(this.workspacePath, filePath);
          content = await readFile(fullPath, 'utf-8');

          // For Create actions (new files) without diff, count lines as additions
          // This ensures consistency with detectGitChanges() and getCurrentChanges()
          if (action === 'Create' && !diff && content) {
            additions = content.split('\n').length;
            // Handle case where file doesn't end with newline
            if (content.endsWith('\n')) {
              additions = Math.max(0, additions - 1);
            }
          }
        } catch (error) {
          logger.debug(`Could not read file content for ${filePath}:`, error);
        }
      }

      const change: FileChange = {
        path: filePath,
        action,
        stage,
        oldPath, // For rename operations
        timestamp: new Date().toISOString(),
        additions,
        deletions,
        diff: diff?.diff,
        content,
      };

      // Get attribution - pass newContent for content-based matching and workspaceId
      const provenance = await this.attributionEngine.attributeChange(
        {
          filePath,
          action: change.action.toLowerCase() as any,
          additions: change.additions,
          deletions: change.deletions,
          diff: change.diff,
          newContent: change.content, // Used for content-based agent attribution
        },
        this.workspaceId,
      );

      // Convert provenance to actor, including sessionId and turnNumber for agent attribution
      if (provenance.source === 'agent' && provenance.agent) {
        change.actor = {
          type: 'agent' as const,
          id: provenance.agent.id || uuidv4(),
          name: provenance.agent.name || 'Agent',
          // Include session and turn info for linking changes to specific agent turns
          sessionId: provenance.agent.sessionId,
          turnNumber: provenance.chat?.turnNumber,
          messageId: provenance.chat?.messageId,
        };
      } else if (provenance.source === 'system') {
        change.actor = {
          type: 'user' as const,
          id: 'system',
          name: 'System',
          email: 'system@workspace',
        };
      } else {
        change.actor = {
          type: 'user' as const,
          id: 'user',
          name: 'User',
          email: 'user@workspace',
        };
      }

      // Create event
      const event = await this.createEvent(change);

      // Extract change chunks if we have diff
      let chunks;
      if (diff?.diff) {
        chunks = extractChangesFromDiff(diff.diff);
      } else if (change.content && change.oldContent) {
        chunks = extractChangesFromContents(change.oldContent, change.content, filePath);
      }

      const processed: ProcessedChange = {
        change,
        event,
        chunks,
      };

      // Mark as processed
      this.processedChanges.add(changeKey);
      this.stats.totalProcessed++;

      // Mark as emitted in tracked changes
      const trackedChange = this.trackedChanges.get(changeKey);
      if (trackedChange) {
        trackedChange.emitted = true;
      }

      // Add to batch queue
      this.addToBatch(processed);
      this.stats.totalEmitted++;

      return processed;
    } catch (error) {
      logger.error(`Error processing file change for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Process multiple file changes
   */
  async processFileChanges(
    changes: Array<{
      path: string;
      action: FileChange['action'];
      diff?: GitDiffResult;
      stage?: 'staged' | 'unstaged';
      oldPath?: string; // For rename operations
    }>,
  ): Promise<ProcessedChange[]> {
    const processed: ProcessedChange[] = [];
    const batchSize = this.config.maxParallelFileProcessing;

    // Process in batches
    for (let i = 0; i < changes.length; i += batchSize) {
      const batch = changes.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((change) =>
          this.processFileChange(change.path, change.action, change.diff, change.stage, change.oldPath),
        ),
      );

      for (const result of results) {
        if (result) {
          processed.push(result);
        }
      }
    }

    return processed;
  }

  /**
   * Create a workspace event from a file change
   */
  private async createEvent(change: FileChange): Promise<WorkspaceEvent> {
    const eventType = this.getEventType(change.action);
    const actor = change.actor || {
      type: 'system' as const,
      id: 'system',
      name: 'System',
    };

    // Store content as git blobs when in a git repo
    let content = change.content;
    let oldContent = change.oldContent;
    let contentSha: string | undefined;
    let oldContentSha: string | undefined;

    if (this.isGitRepo) {
      if (change.content) {
        const sha = await storeBlob(change.content, this.workspacePath);
        if (sha) {
          contentSha = sha;
          content = undefined; // Don't store inline if blob succeeded
        }
      }
      if (change.oldContent) {
        const sha = await storeBlob(change.oldContent, this.workspacePath);
        if (sha) {
          oldContentSha = sha;
          oldContent = undefined; // Don't store inline if blob succeeded
        }
      }
    }

    return {
      id: uuidv4(),
      workspaceId: this.workspaceId,
      timestamp: change.timestamp,
      type: eventType,
      actor: {
        type: actor.type,
        id: actor.id,
        name: actor.name,
      },
      data: {
        path: change.path,
        relativePath: change.path,
        action: change.action.toLowerCase(),
        oldPath: change.oldPath, // For rename operations
        additions: change.additions,
        deletions: change.deletions,
        stage: change.stage,
        diff: change.diff,
        newContent: content,
        oldContent,
        newContentSha: contentSha,
        oldContentSha,
      },
      metadata: {
        filePath: change.path,
        changeType: change.action,
        hasContent: !!change.content,
        hasDiff: !!change.diff,
      },
    };
  }

  /**
   * Get event type for a file action
   */
  private getEventType(action: FileChange['action']): WorkspaceEventType {
    switch (action) {
      case 'Create':
        return 'file:created';
      case 'Delete':
        return 'file:deleted';
      case 'Rename':
        return 'file:changed';
      case 'Modify':
      default:
        return 'file:changed';
    }
  }

  /**
   * Check if a file should be ignored
   */
  private shouldIgnoreFile(filePath: string): boolean {
    // If the path is already relative, use it directly
    // If it's absolute, make it relative to the workspace
    const isAbsolutePath = isAbsolute(filePath);
    const relativePath = isAbsolutePath ? relative(this.workspacePath, filePath) : filePath;

    // Ignore files outside the workspace root
    // These might be symlinks or files from parent directories
    if (relativePath.startsWith('..')) {
      logger.debug(`Ignoring file outside workspace: ${filePath}`);
      return true;
    }

    // Check additional ignore patterns
    for (const pattern of this.config.additionalIgnorePatterns) {
      if (relativePath.includes(pattern.replace('**', ''))) {
        return true;
      }
    }

    // Check gitignore - use relative path
    return this.gitignoreManager.shouldIgnore(relativePath);
  }

  /**
   * Add a processed change to the batch queue
   */
  private addToBatch(processed: ProcessedChange): void {
    this.batchQueue.push(processed);

    // Clear existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Set new timer
    this.batchTimer = setTimeout(() => {
      this.emitBatch();
    }, this.config.batchEmissionDelay);

    // Emit immediately if batch is full
    if (this.batchQueue.length >= 50) {
      this.emitBatch();
    }
  }

  /**
   * Emit the current batch of changes
   */
  private emitBatch(): void {
    if (this.batchQueue.length === 0) {
      return;
    }

    const batch = [...this.batchQueue];
    this.batchQueue = [];

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Emit batch
    this.emit('changes-batch', batch);

    // Emit individual events
    for (const processed of batch) {
      this.emit('file-change', processed.change);
      this.emit('workspace-event', processed.event);

      if (processed.chunks && processed.chunks.length > 0) {
        this.emit('change-chunks', processed.chunks);
      }
    }

    logger.debug(`Emitted batch of ${batch.length} changes`);
  }

  /**
   * Clear processed changes cache
   */
  clearCache(): void {
    this.processedChanges.clear();
    this.trackedChanges.clear();
    logger.debug('Cleared processed changes cache');
  }

  /**
   * Clean up old entries from cache
   */
  cleanupCache(): void {
    // Keep only recent entries (last 1000)
    if (this.processedChanges.size > this.config.maxEmissionTrackerSize) {
      const entries = Array.from(this.processedChanges);
      const toKeep = entries.slice(-1000);
      this.processedChanges = new Set(toKeep);
      logger.debug(`Cleaned up processedChanges cache, kept ${toKeep.length} entries`);
    }

    // Clean up old tracked changes (remove entries not seen in last 5 minutes)
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const toDelete: string[] = [];

    for (const [key, tracked] of this.trackedChanges.entries()) {
      if (now - tracked.lastSeen > staleThreshold) {
        toDelete.push(key);
      }
    }

    if (toDelete.length > 0) {
      for (const key of toDelete) {
        this.trackedChanges.delete(key);
      }
      logger.debug(`Cleaned up ${toDelete.length} stale tracked changes`);
    }
  }

  /**
   * Start periodic cleanup to prevent memory leaks
   */
  private startPeriodicCleanup(): void {
    // Clean up every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanupCache();

      // Also clean up batch queue if it's getting too large (shouldn't happen normally)
      if (this.batchQueue.length > 100) {
        logger.warn(
          `Batch queue unexpectedly large (${this.batchQueue.length}), clearing old entries`,
        );
        this.batchQueue = this.batchQueue.slice(-50);
      }
    }, this.config.cleanupInterval || 60000);
  }

  /**
   * Get the number of pending changes in the batch queue
   */
  getPendingCount(): number {
    return this.batchQueue.length;
  }

  /**
   * Process a batch of changes
   */
  async processBatch(
    changes: Array<{
      path: string;
      action: FileChange['action'];
      diff?: GitDiffResult;
      stage?: 'staged' | 'unstaged';
      oldPath?: string; // For rename operations
    }>,
  ): Promise<ProcessedChange[]> {
    return this.processFileChanges(changes);
  }

  /**
   * Get processing statistics
   */
  getStats(): ProcessorStats {
    return { ...this.stats };
  }

  /**
   * Cleanup alias for destroy (for backward compatibility)
   */
  cleanup(): void {
    this.destroy();
  }

  /**
   * Destroy the processor
   */
  destroy(): void {
    // Clear timers
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Clear data structures
    this.batchQueue = [];
    this.processedChanges.clear();
    this.trackedChanges.clear();
    this.removeAllListeners();

    logger.info('Change processor destroyed');
  }
}

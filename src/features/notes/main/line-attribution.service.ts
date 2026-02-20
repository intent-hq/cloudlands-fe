/**
 * Line Attribution Service
 *
 * Computes line attributions for notes and persists them to disk.
 * Emits events when attributions are updated so the UI can refresh.
 *
 * Architecture:
 * - Listens for 'note:updated' events
 * - Debounces computation (2 seconds after edit)
 * - Computes attributions using the attributeLines algorithm
 * - Persists to .line-attribution.json files
 * - Emits 'line-attribution:updated' events for UI
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { unifiedEventBus, type UnifiedEventBus } from '../../events/main/unified-event-bus';
import { WorkspaceConfig } from '../../../shared/main/config';
import { attributeLines } from '../line-attribution';
import type { WorkspaceId, NoteId, Note } from '../../../shared/types';
import { FolderBasedNotesRepository } from './storage';
import { getNoteStoragePaths } from './storage/note-storage-paths';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

const logger = new Logger('LineAttributionService');

/**
 * Author information for line attribution
 */
export interface LineAuthor {
  id: string;
  name: string;
  type: 'user' | 'agent' | 'system';
  turnNumber?: number;
}

/**
 * Attribution info for a single line
 */
export interface LineAttributionInfo {
  timestamp: number; // milliseconds since epoch
  author?: LineAuthor;
}

/**
 * Line attribution data structure for persistence
 * Maps line number (1-based) to attribution info (timestamp + author)
 */
export interface LineAttributionData {
  noteId: NoteId;
  workspaceId: WorkspaceId;
  computedAt: string; // ISO timestamp
  attributions: Record<number, LineAttributionInfo>; // line number → attribution info
}

export class LineAttributionService {
  private eventBus: UnifiedEventBus;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 5000; // 5 seconds - longer debounce to coalesce rapid agent updates
  private noteUpdatedListener?: (event: any) => void;
  private notesRepository: FolderBasedNotesRepository;

  // Batch processing for bulk operations (e.g., task delegation)
  // When multiple notes are updated in rapid succession, we batch them together
  private pendingBatch: Map<string, { workspaceId: WorkspaceId; noteId: NoteId }> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_DEBOUNCE_MS = 8000; // 8 seconds for batch processing
  private readonly BATCH_THRESHOLD = 2; // If 2+ notes pending, use batch mode

  constructor(eventBus: UnifiedEventBus) {
    this.eventBus = eventBus;
    this.notesRepository = new FolderBasedNotesRepository();
  }

  /**
   * Start listening for note updates
   */
  start(): void {
    logger.info('Starting line attribution service');

    // Listen for note updates
    // Store the listener function so we can remove it later
    this.noteUpdatedListener = (event: any) => {
      // Guard: Skip re-forwarded WorkspaceEvents where noteId is nested inside event.data
      // instead of at the top level. See workspace-event-bus.ts line 492 for the forwarding path.
      if (!event.workspaceId || !event.noteId) {
        return;
      }
      this.scheduleComputation(event.workspaceId, event.noteId);
    };
    this.eventBus.onDomainEvent('note:updated', this.noteUpdatedListener);
  }

  /**
   * Stop listening for note updates
   */
  stop(): void {
    logger.info('Stopping line attribution service');

    // Clear all pending timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingBatch.clear();

    // Remove event listeners
    if (this.noteUpdatedListener) {
      this.eventBus.offDomainEvent('note:updated', this.noteUpdatedListener);
      this.noteUpdatedListener = undefined;
    }
  }

  /**
   * Schedule attribution computation (debounced with batch support)
   *
   * When multiple notes are updated in rapid succession (e.g., bulk task delegation),
   * we batch them together to avoid running expensive computations repeatedly.
   */
  private scheduleComputation(workspaceId: WorkspaceId, noteId: NoteId): void {
    const key = `${workspaceId}:${noteId}`;

    // Add to pending batch
    this.pendingBatch.set(key, { workspaceId, noteId });

    // Clear existing individual timer for this note
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(key);
    }

    // Check if we should use batch mode (multiple notes pending)
    if (this.pendingBatch.size >= this.BATCH_THRESHOLD) {
      // Use batch processing - longer debounce, process all at once
      this.scheduleBatchProcessing();
      logger.debug('Using batch mode for line attribution', {
        pendingCount: this.pendingBatch.size,
        batchDebounceMs: this.BATCH_DEBOUNCE_MS,
      });
    } else {
      // Use individual processing for single notes
      const timer = setTimeout(() => {
        // Only process if still in pending batch (not already processed by batch)
        if (this.pendingBatch.has(key)) {
          this.pendingBatch.delete(key);
          this.computeAndPersist(workspaceId, noteId).catch((error) => {
            logger.error('Failed to compute line attributions', error as Error, {
              workspaceId,
              noteId,
            });
          });
        }
        this.debounceTimers.delete(key);
      }, this.DEBOUNCE_MS);

      this.debounceTimers.set(key, timer);

      logger.debug('Scheduled line attribution computation', {
        workspaceId,
        noteId,
        debounceMs: this.DEBOUNCE_MS,
        pendingCount: this.pendingBatch.size,
      });
    }
  }

  /**
   * Schedule batch processing for multiple notes
   */
  private scheduleBatchProcessing(): void {
    // Clear existing batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Clear all individual timers since we're batching
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Schedule batch processing
    this.batchTimer = setTimeout(() => {
      this.processBatch().catch((error) => {
        logger.error('Failed to process line attribution batch', error as Error);
      });
      this.batchTimer = null;
    }, this.BATCH_DEBOUNCE_MS);
  }

  /**
   * Process all pending notes in batch
   */
  private async processBatch(): Promise<void> {
    const batch = Array.from(this.pendingBatch.values());
    this.pendingBatch.clear();

    if (batch.length === 0) {
      return;
    }

    logger.info('Processing line attribution batch', { count: batch.length });

    // Process notes sequentially to avoid overwhelming the system
    // Could be parallelized with Promise.all if needed, but sequential is safer
    for (const { workspaceId, noteId } of batch) {
      try {
        await this.computeAndPersist(workspaceId, noteId);
      } catch (error) {
        logger.error('Failed to compute line attributions in batch', error as Error, {
          workspaceId,
          noteId,
        });
      }
    }

    logger.info('Completed line attribution batch', { count: batch.length });
  }

  /**
   * Compute attributions and persist to disk
   */
  private async computeAndPersist(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    try {
      logger.info('Computing line attributions', { workspaceId, noteId });

      // Load note
      const note = await this.loadNote(workspaceId, noteId);
      if (!note) {
        logger.warn('Note not found, skipping attribution', { workspaceId, noteId });
        return;
      }

      // Compute attributions
      const attributions = attributeLines(note.content, note.versions || []);

      // Convert to persistence format (line number → attribution info with timestamp + author)
      const attributionMap: Record<number, LineAttributionInfo> = {};
      for (const attr of attributions) {
        if (attr.version) {
          // Extract timestamp
          const timestamp = new Date(attr.version.createdAt).getTime();

          // Extract author if available
          const author: LineAuthor | undefined = attr.version.author
            ? {
                id: attr.version.author.id,
                name: attr.version.author.name,
                type: attr.version.author.type as 'user' | 'agent' | 'system',
                turnNumber: attr.version.author.turnNumber,
              }
            : undefined;

          attributionMap[attr.lineNumber] = {
            timestamp,
            author,
          };
        }
      }

      // Create data structure
      const data: LineAttributionData = {
        noteId,
        workspaceId,
        computedAt: new Date().toISOString(),
        attributions: attributionMap,
      };

      // Persist to disk
      await this.persist(workspaceId, noteId, data);

      // Emit event for UI
      this.eventBus.emitDomainEvent('line-attribution:updated', {
        workspaceId,
        noteId,
        attributions: attributionMap,
      });

      logger.info('Line attributions computed and persisted', {
        workspaceId,
        noteId,
        lineCount: attributions.length,
        attributedCount: Object.keys(attributionMap).length,
      });
    } catch (error) {
      logger.error('Failed to compute and persist line attributions', error as Error, {
        workspaceId,
        noteId,
      });
      throw error;
    }
  }

  /**
   * Load note from disk using the repository (supports new .md format)
   */
  private async loadNote(workspaceId: WorkspaceId, noteId: NoteId): Promise<Note | null> {
    try {
      return await this.notesRepository.findById(workspaceId, noteId);
    } catch (error) {
      logger.error('Failed to load note', error as Error, {
        workspaceId,
        noteId,
      });
      return null;
    }
  }

  /**
   * Persist line attribution data to disk
   */
  private async persist(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    data: LineAttributionData,
  ): Promise<void> {
    try {
      const paths = getNoteStoragePaths(workspaceId, noteId);
      const filePath = paths.lineAttributionFile;

      // Ensure directory exists
      await fs.mkdir(paths.metaDir, { recursive: true });

      // Write file
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(filePath);

      logger.debug('Persisted line attribution data', {
        workspaceId,
        noteId,
        filePath,
      });
    } catch (error) {
      logger.error('Failed to persist line attribution data', error as Error, {
        workspaceId,
        noteId,
      });
      throw error;
    }
  }

  /**
   * Load line attribution data from disk
   */
  async load(workspaceId: WorkspaceId, noteId: NoteId): Promise<LineAttributionData | null> {
    try {
      const paths = getNoteStoragePaths(workspaceId, noteId);
      const filePath = paths.lineAttributionFile;

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        // File doesn't exist yet - try legacy location
        return this.loadLegacy(workspaceId, noteId);
      }

      // Read file
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to load line attribution data', error as Error, {
        workspaceId,
        noteId,
      });
      return null;
    }
  }

  /**
   * Load from legacy location (notes/{noteId}.line-attribution.json)
   */
  private async loadLegacy(
    workspaceId: WorkspaceId,
    noteId: NoteId,
  ): Promise<LineAttributionData | null> {
    try {
      const notesDir = WorkspaceConfig.paths.notes(workspaceId);
      const legacyPath = path.join(notesDir, `${noteId}.line-attribution.json`);

      await fs.access(legacyPath);
      const content = await fs.readFile(legacyPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Compute attributions immediately (for testing/debugging)
   */
  async computeNow(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    await this.computeAndPersist(workspaceId, noteId);
  }
}

// Export singleton instance
export const lineAttributionService = new LineAttributionService(unifiedEventBus);

/**
 * Event Store
 *
 * Handles persistence and retrieval of workspace events.
 * Uses JSONL format (one event per line) for efficient append-only writes.
 */

import { WorkspaceEvent, WorkspaceEventType } from '../types';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, createReadStream } from 'fs';
import { createInterface } from 'readline';

const logger = new Logger('EventStore');

/**
 * Sanitize event before storage by removing large unused fields.
 * Full file contents (oldContent, newContent, content) are stripped since they can be
 * fetched on-demand from git blobs. The `diff` field is preserved (with a size cap)
 * because it is the primary source of truth for displaying changes in the activity log,
 * especially for agent-generated changes that may not yet be committed to git.
 */
const MAX_DIFF_SIZE = 20_000; // ~20KB cap for retained/stored diffs
const DIFF_TRUNCATION_MARKER = '\n[diff truncated]';

function truncateString(value: string, maxLength: number, marker: string): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}${marker}`;
}

function sanitizeEventForStorage(event: WorkspaceEvent): WorkspaceEvent {
  const data = (event as any).data;
  if (!data) return event;

  // File events: strip large content fields but PRESERVE diff (capped)
  if (event.type === 'file:changed' || event.type === 'file:created') {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { oldContent, newContent, content, diff, ...restData } = data;
    const sanitizedDiff =
      typeof diff === 'string'
        ? truncateString(diff, MAX_DIFF_SIZE, DIFF_TRUNCATION_MARKER)
        : undefined;
    return {
      ...event,
      data: { ...restData, ...(sanitizedDiff !== undefined && { diff: sanitizedDiff }) },
    };
  }

  // Terminal events: truncate large output
  if (event.type === 'terminal:command' && data.output) {
    const maxOutputLength = 500;
    if (data.output.length > maxOutputLength) {
      return {
        ...event,
        data: {
          ...data,
          output: data.output.slice(0, maxOutputLength) + '\n[truncated]',
        },
      };
    }
  }

  // Agent tool calls: truncate large input/output
  if (event.type === 'agent:tool:call') {
    const maxLength = 1000;
    let modified = false;
    const newData = { ...data };

    if (data.input && JSON.stringify(data.input).length > maxLength) {
      newData.input = '[truncated - too large]';
      modified = true;
    }
    if (data.output && JSON.stringify(data.output).length > maxLength) {
      newData.output = '[truncated - too large]';
      modified = true;
    }

    if (modified) {
      return { ...event, data: newData };
    }
  }

  return event;
}

export interface EventStoreOptions {
  maxEvents?: number;
  persistToDisk?: boolean;
  storageDir?: string;
  compactOnSave?: boolean; // Compact events when saving to disk
  indexByType?: boolean; // Create type-based indexes for faster queries
  indexByActor?: boolean; // Create actor-based indexes for faster queries
  saveDebounceMs?: number; // Debounce time for saving to disk
}

export interface EventStatistics {
  totalEvents: number;
  eventsByType: Record<WorkspaceEventType, number>;
  eventsByActor: Record<string, number>;
  oldestEvent?: string;
  newestEvent?: string;
}

export class EventStore {
  private events: WorkspaceEvent[] = [];
  private eventIndex: Map<string, WorkspaceEvent> = new Map();

  // Additional indexes for performance
  private typeIndex: Map<WorkspaceEventType, Set<string>> = new Map();
  private actorIndex: Map<string, Set<string>> = new Map();
  private dateIndex: Map<string, Set<string>> = new Map(); // YYYY-MM-DD -> event IDs

  private readonly maxEvents: number;
  private readonly persistToDisk: boolean;
  private readonly storageDir: string;
  private readonly storageFile: string; // JSONL file (events.jsonl)
  private readonly legacyStorageFile: string; // Old JSON file for migration (events.json)
  private readonly compactOnSave: boolean;
  private readonly indexByType: boolean;
  private readonly indexByActor: boolean;
  private readonly saveDebounceMs: number;

  private saveTimer?: NodeJS.Timeout;
  private loadPromise?: Promise<void>;
  // JSONL: Track events that need to be appended to disk
  private pendingEvents: WorkspaceEvent[] = [];
  private isAppending: boolean = false;
  // Tracks the event count at the last compaction attempt (not a timestamp).
  // Used to avoid repeatedly calling compact() on every add when compaction yields no reduction.
  private lastCompactEventCount: number = 0;
  private compactThreshold: number = 500; // Compact after 500 new events (higher threshold for JSONL)
  private memoryPressureThreshold: number = 100 * 1024 * 1024; // 100MB
  private lastMemoryCheck: number = 0;
  private memoryCheckInterval: number = 10000; // Check every 10 seconds
  // Track if we need a full rewrite (after compaction or migration)
  private needsFullRewrite: boolean = false;

  constructor(
    private workspaceId: string,
    options: EventStoreOptions = {},
  ) {
    // Validate workspaceId
    if (typeof workspaceId !== 'string' || !workspaceId) {
      const error = new Error(
        // i18n-ignore (developer-facing internal error)
        `Invalid workspaceId for EventStore: expected non-empty string, got ${typeof workspaceId}`,
      );
      logger.error('EventStore constructor error', {
        workspaceId,
        type: typeof workspaceId,
        error: error.message,
      });
      throw error;
    }

    this.maxEvents = options.maxEvents || 5000; // Reduced from 10000 for better performance
    this.persistToDisk = options.persistToDisk !== false;
    this.storageDir = options.storageDir || WorkspaceConfig.paths.metadata(workspaceId);
    this.storageFile = path.join(this.storageDir, 'events.jsonl'); // JSONL format
    this.legacyStorageFile = path.join(this.storageDir, 'events.json'); // For migration
    this.compactOnSave = options.compactOnSave ?? true;
    this.indexByType = options.indexByType ?? true;
    this.indexByActor = options.indexByActor ?? true;
    this.saveDebounceMs = options.saveDebounceMs ?? 2000; // Increased debounce for JSONL

    if (this.persistToDisk) {
      this.loadPromise = this.loadFromDisk().catch((error) => {
        logger.error('Failed to load events from disk', { error });
      });
    }
  }

  /**
   * Initialize the store (wait for events to load from disk)
   */
  async initialize(): Promise<void> {
    if (this.loadPromise) {
      await this.loadPromise;
    }
  }

  /**
   * Add an event to the store
   */
  add(event: WorkspaceEvent): void {
    // Prevent duplicates
    if (this.eventIndex.has(event.id)) {
      return;
    }

    // Check memory pressure periodically
    if (Date.now() - this.lastMemoryCheck > this.memoryCheckInterval) {
      this.checkMemoryPressure();
    }

    // Sanitize event to remove large unused fields before storage
    const sanitizedEvent = sanitizeEventForStorage(event);

    // Add to store (use sanitized version)
    this.events.push(sanitizedEvent);
    this.eventIndex.set(sanitizedEvent.id, sanitizedEvent);

    // Update indexes
    this.addToIndexes(sanitizedEvent);

    // Track for JSONL append only when persistence is enabled and an append is useful.
    // Otherwise this would retain duplicate references that a pending full rewrite does not need.
    if (this.persistToDisk && !this.needsFullRewrite) {
      this.pendingEvents.push(sanitizedEvent);
    }

    // Trim if over limit - triggers full rewrite
    if (this.events.length > this.maxEvents) {
      const removed = this.events.shift();
      if (removed) {
        this.removeFromIndexes(removed);
        this.eventIndex.delete(removed.id);
        this.needsFullRewrite = true; // Can't just append if we removed events
        this.pendingEvents = []; // Full rewrite uses this.events; release duplicate append refs
      }
    }

    // Check if we should compact
    if (
      this.compactOnSave &&
      this.events.length - this.lastCompactEventCount > this.compactThreshold
    ) {
      this.compact();
    }

    // Schedule save
    this.scheduleSave();

    logger.debug('Event added to store', {
      eventId: sanitizedEvent.id,
      eventType: sanitizedEvent.type,
      totalEvents: this.events.length,
      pendingAppends: this.pendingEvents.length,
    });
  }

  /**
   * Add event to indexes
   */
  private addToIndexes(event: WorkspaceEvent): void {
    // Type index
    if (this.indexByType) {
      let typeSet = this.typeIndex.get(event.type);
      if (!typeSet) {
        typeSet = new Set();
        this.typeIndex.set(event.type, typeSet);
      }
      typeSet.add(event.id);
    }

    // Actor index
    if (this.indexByActor) {
      const actorKey = `${event.actor.type}:${event.actor.name}`;
      let actorSet = this.actorIndex.get(actorKey);
      if (!actorSet) {
        actorSet = new Set();
        this.actorIndex.set(actorKey, actorSet);
      }
      actorSet.add(event.id);
    }

    // Date index
    const dateKey = event.timestamp.substring(0, 10); // YYYY-MM-DD
    let dateSet = this.dateIndex.get(dateKey);
    if (!dateSet) {
      dateSet = new Set();
      this.dateIndex.set(dateKey, dateSet);
    }
    dateSet.add(event.id);
  }

  /**
   * Remove event from indexes
   */
  private removeFromIndexes(event: WorkspaceEvent): void {
    // Type index
    if (this.indexByType) {
      const typeSet = this.typeIndex.get(event.type);
      typeSet?.delete(event.id);
      if (typeSet?.size === 0) {
        this.typeIndex.delete(event.type);
      }
    }

    // Actor index
    if (this.indexByActor) {
      const actorKey = `${event.actor.type}:${event.actor.name}`;
      const actorSet = this.actorIndex.get(actorKey);
      actorSet?.delete(event.id);
      if (actorSet?.size === 0) {
        this.actorIndex.delete(actorKey);
      }
    }

    // Date index
    const dateKey = event.timestamp.substring(0, 10);
    const dateSet = this.dateIndex.get(dateKey);
    dateSet?.delete(event.id);
    if (dateSet?.size === 0) {
      this.dateIndex.delete(dateKey);
    }
  }

  /**
   * Get all events
   */
  getAll(): WorkspaceEvent[] {
    return [...this.events];
  }

  /**
   * Get event by ID
   */
  getById(id: string): WorkspaceEvent | undefined {
    return this.eventIndex.get(id);
  }

  /**
   * Get events by type (optimized with index)
   */
  getByType(type: WorkspaceEventType): WorkspaceEvent[] {
    const eventIds = this.typeIndex.get(type);
    if (this.indexByType && eventIds) {
      const events: WorkspaceEvent[] = [];
      for (const id of eventIds) {
        const event = this.eventIndex.get(id);
        if (event) events.push(event);
      }
      return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    // Fallback to linear search
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get events by actor (optimized with index)
   */
  getByActor(actorType: string, actorName: string): WorkspaceEvent[] {
    const actorKey = `${actorType}:${actorName}`;
    const eventIds = this.actorIndex.get(actorKey);
    if (this.indexByActor && eventIds) {
      const events: WorkspaceEvent[] = [];
      for (const id of eventIds) {
        const event = this.eventIndex.get(id);
        if (event) events.push(event);
      }
      return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    // Fallback to linear search
    return this.events.filter((e) => e.actor.type === actorType && e.actor.name === actorName);
  }

  /**
   * Get events by date (optimized with index)
   */
  getByDate(date: string): WorkspaceEvent[] {
    const dateKey = date.substring(0, 10); // Ensure YYYY-MM-DD format
    const eventIds = this.dateIndex.get(dateKey);
    if (eventIds) {
      const events: WorkspaceEvent[] = [];
      for (const id of eventIds) {
        const event = this.eventIndex.get(id);
        if (event) events.push(event);
      }
      return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    return [];
  }

  /**
   * Get events in time range
   */
  getInRange(start: Date | string, end?: Date | string): WorkspaceEvent[] {
    const startTime = typeof start === 'string' ? new Date(start) : start;
    const endTime = end ? (typeof end === 'string' ? new Date(end) : end) : new Date();

    return this.events.filter((e) => {
      const eventTime = new Date(e.timestamp);
      return eventTime >= startTime && eventTime <= endTime;
    });
  }

  /**
   * Get recent events
   */
  getRecent(count: number): WorkspaceEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Get statistics
   */
  getStatistics(): EventStatistics {
    const stats: EventStatistics = {
      totalEvents: this.events.length,
      eventsByType: {} as Record<WorkspaceEventType, number>,
      eventsByActor: {},
    };

    // Use indexes if available for better performance
    if (this.indexByType) {
      for (const [type, ids] of this.typeIndex.entries()) {
        stats.eventsByType[type] = ids.size;
      }
    } else {
      for (const event of this.events) {
        stats.eventsByType[event.type] = (stats.eventsByType[event.type] || 0) + 1;
      }
    }

    if (this.indexByActor) {
      for (const [actor, ids] of this.actorIndex.entries()) {
        stats.eventsByActor[actor] = ids.size;
      }
    } else {
      for (const event of this.events) {
        const actorKey = `${event.actor.type}:${event.actor.name}`;
        stats.eventsByActor[actorKey] = (stats.eventsByActor[actorKey] || 0) + 1;
      }
    }

    if (this.events.length > 0) {
      stats.oldestEvent = this.events[0].timestamp;
      stats.newestEvent = this.events[this.events.length - 1].timestamp;
    }

    return stats;
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): {
    eventCount: number;
    estimatedSizeBytes: number;
    indexCount: number;
    indexSizeEstimate: number;
  } {
    // Rough estimate: average event is ~500 bytes
    const avgEventSize = 500;
    const eventMemory = this.events.length * avgEventSize;

    // Index memory estimate
    let indexCount = this.eventIndex.size;
    indexCount += this.typeIndex.size;
    indexCount += this.actorIndex.size;
    indexCount += this.dateIndex.size;

    // Each index entry is roughly 100 bytes
    const indexMemory = indexCount * 100;

    return {
      eventCount: this.events.length,
      estimatedSizeBytes: eventMemory,
      indexCount,
      indexSizeEstimate: indexMemory,
    };
  }

  /**
   * Check memory pressure and compact if needed
   */
  private checkMemoryPressure(): void {
    this.lastMemoryCheck = Date.now();
    const usage = this.getMemoryUsage();
    const totalMemory = usage.estimatedSizeBytes + usage.indexSizeEstimate;

    if (totalMemory > this.memoryPressureThreshold) {
      logger.warn('Memory pressure detected, compacting event store', {
        totalMemory,
        threshold: this.memoryPressureThreshold,
        eventCount: this.events.length,
      });

      // Aggressive compact - keep only last 1000 events
      if (this.events.length > 1000) {
        const toRemove = this.events.slice(0, this.events.length - 1000);
        this.events = this.events.slice(-1000);

        // Clean up indexes
        toRemove.forEach((event) => {
          this.removeFromIndexes(event);
          this.eventIndex.delete(event.id);
        });

        // Mark for full rewrite since we removed events
        this.needsFullRewrite = true;
        this.pendingEvents = [];

        logger.info('Aggressive memory cleanup completed', {
          removed: toRemove.length,
          remaining: this.events.length,
        });
      } else {
        // Normal compact
        this.compact();
      }
    }
  }

  /**
   * Compact the event store to optimize memory
   */
  private compact(): void {
    const startTime = Date.now();
    const originalSize = this.events.length;

    // Remove old events beyond a certain age (e.g., 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const importantTypes = new Set<WorkspaceEventType>([
      'agent:started' as WorkspaceEventType,
      'agent:completed' as WorkspaceEventType,
      'error:occurred' as WorkspaceEventType,
    ]);

    // Keep recent events and important events; for older events, keep one per hour.
    // NOTE: Previously this used `compactedEvents.some(...)` inside a filter, which could become
    // O(n^2) and also caused compaction to be re-attempted on every add when no reduction occurred.
    const seenHours = new Set<string>();
    const compactedEvents: WorkspaceEvent[] = [];
    for (const event of this.events) {
      const eventDate = new Date(event.timestamp);

      // Always keep events from the last 7 days
      if (eventDate > sevenDaysAgo) {
        compactedEvents.push(event);
        continue;
      }

      // Keep important events (errors, agent actions, etc.) regardless of age
      if (importantTypes.has(event.type)) {
        compactedEvents.push(event);
        continue;
      }

      // Drop very old, non-important events
      if (eventDate <= thirtyDaysAgo) {
        continue;
      }

      // Keep one event per hour for older events
      const hourKey = event.timestamp.substring(0, 13); // YYYY-MM-DDTHH
      if (!seenHours.has(hourKey)) {
        seenHours.add(hourKey);
        compactedEvents.push(event);
      }
    }

    // Only compact if we can reduce size significantly
    if (compactedEvents.length < originalSize * 0.9) {
      this.events = compactedEvents;
      this.rebuildAllIndexes();
      // Mark for full rewrite since we removed events
      this.needsFullRewrite = true;
      this.pendingEvents = []; // Clear pending since we're doing full rewrite

      logger.info('Event store compacted', {
        originalSize,
        newSize: this.events.length,
        reduction: originalSize - this.events.length,
        duration: Date.now() - startTime,
      });
    }

    // Record that we attempted compaction (even if it didn't reduce size) so we don't
    // repeatedly re-run compaction on every subsequent add.
    this.lastCompactEventCount = this.events.length;
  }

  /**
   * Clear all events
   */
  async clear(): Promise<void> {
    this.events = [];
    this.eventIndex.clear();
    this.typeIndex.clear();
    this.actorIndex.clear();
    this.dateIndex.clear();
    this.pendingEvents = [];
    this.needsFullRewrite = true; // Will create empty file

    if (this.persistToDisk) {
      await this.saveToDisk();
    }

    logger.info('Event store cleared');
  }

  /**
   * Force save to disk immediately (for testing or shutdown)
   */
  async forceSave(): Promise<void> {
    if (this.persistToDisk && (this.pendingEvents.length > 0 || this.needsFullRewrite)) {
      // Clear any pending timer
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
      }
      await this.saveToDisk();
    }
  }

  /**
   * Schedule save to disk
   */
  private scheduleSave(): void {
    if (!this.persistToDisk) {
      return;
    }

    // Nothing to save
    if (this.pendingEvents.length === 0 && !this.needsFullRewrite) {
      return;
    }

    // Clear existing timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    // Schedule save with configurable debounce
    this.saveTimer = setTimeout(() => {
      this.saveToDisk().catch((error) => {
        logger.error('Failed to save events to disk', { error });
      });
    }, this.saveDebounceMs);
  }

  /**
   * Save events to disk using JSONL format (append-only when possible)
   */
  private async saveToDisk(): Promise<void> {
    // Nothing to save
    if (this.pendingEvents.length === 0 && !this.needsFullRewrite) {
      return;
    }

    // Prevent concurrent writes
    if (this.isAppending) {
      // Reschedule for later
      this.scheduleSave();
      return;
    }

    this.isAppending = true;

    try {
      // Ensure directory exists
      await fs.mkdir(this.storageDir, { recursive: true });

      if (this.needsFullRewrite) {
        // Full rewrite needed (after compaction, migration, or event removal)
        await this.writeFullJsonl();
        this.needsFullRewrite = false;
        this.pendingEvents = [];
      } else if (this.pendingEvents.length > 0) {
        // Append-only mode - just add new events
        await this.appendEventsToJsonl(this.pendingEvents);
        this.pendingEvents = [];
      }

      logger.debug('Events saved to disk (JSONL)', {
        eventCount: this.events.length,
        file: this.storageFile,
      });
    } catch (error) {
      logger.error('Failed to save events', { error });
      throw error;
    } finally {
      this.isAppending = false;
    }
  }

  /**
   * Append events to JSONL file (efficient append-only operation)
   */
  private async appendEventsToJsonl(events: WorkspaceEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Convert events to JSONL lines
    const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';

    // Append to file (creates if doesn't exist)
    await fs.appendFile(this.storageFile, lines, 'utf-8');

    logger.debug('Appended events to JSONL', { count: events.length });
  }

  /**
   * Write all events to JSONL file (full rewrite)
   */
  private async writeFullJsonl(): Promise<void> {
    // Convert all events to JSONL lines
    const lines = this.events.map((event) => JSON.stringify(event)).join('\n');

    // Write with newline at end
    await fs.writeFile(this.storageFile, lines + (lines.length > 0 ? '\n' : ''), 'utf-8');

    logger.debug('Wrote full JSONL file', { eventCount: this.events.length });
  }

  /**
   * Load events from disk (supports both JSONL and legacy JSON formats)
   */
  private async loadFromDisk(): Promise<void> {
    // Try JSONL first, then fall back to legacy JSON for migration
    const jsonlExists = existsSync(this.storageFile);
    const legacyExists = existsSync(this.legacyStorageFile);

    if (jsonlExists) {
      await this.loadFromJsonl();
    } else if (legacyExists) {
      await this.loadFromLegacyJson();
    } else {
      logger.debug('No existing event store found');
    }
  }

  /**
   * Load events from JSONL file
   *
   * PERF: Uses bulk fs.readFile + split for small/medium files (< 10MB) instead
   * of readline's async iterator. For 1869 events, readline adds ~2s of overhead
   * from per-line async yielding. Bulk read + split processes the same data in ~200ms.
   *
   * Falls back to streaming readline for large files (>= 10MB) to avoid
   * loading the entire file into memory at once.
   */
  private static readonly BULK_READ_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB

  private async loadFromJsonl(): Promise<void> {
    try {
      const stat = await fs.stat(this.storageFile);
      if (stat.size >= EventStore.BULK_READ_SIZE_LIMIT) {
        return await this.loadFromJsonlStreaming();
      }

      const content = await fs.readFile(this.storageFile, 'utf-8');
      const lines = content.split('\n');
      const loadedEvents: WorkspaceEvent[] = [];
      let sanitizedLoadedEvents = false;

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue; // Skip empty lines

        try {
          const event = JSON.parse(trimmed) as WorkspaceEvent;
          const sanitizedEvent = sanitizeEventForStorage(event);
          if (JSON.stringify(sanitizedEvent) !== trimmed) {
            sanitizedLoadedEvents = true;
          }
          loadedEvents.push(sanitizedEvent);
        } catch (parseError) {
          logger.warn('Failed to parse JSONL line', {
            lineNumber: i + 1,
            error: (parseError as Error).message,
          });
        }
      }

      // Trim to max events (keep most recent)
      if (loadedEvents.length > this.maxEvents) {
        this.events = loadedEvents.slice(-this.maxEvents);
        this.needsFullRewrite = true; // Rewrite to trim file
      } else {
        this.events = loadedEvents;
      }

      if (sanitizedLoadedEvents) {
        this.needsFullRewrite = true;
      }

      // Rebuild all indexes
      this.rebuildAllIndexes();

      // Compact if needed
      if (this.compactOnSave && this.events.length > this.compactThreshold) {
        this.compact();
      }

      logger.info('Events loaded from JSONL', {
        eventCount: this.events.length,
      });
    } catch (error) {
      const errnoError = error as NodeJS.ErrnoException;
      if (errnoError.code === 'ENOENT') {
        logger.debug('No existing JSONL event store found');
      } else {
        logger.error('Failed to load events from JSONL', { error: (error as Error).message });
      }
    }
  }

  /**
   * Streaming fallback for large JSONL files to avoid loading everything into memory.
   */
  private async loadFromJsonlStreaming(): Promise<void> {
    const fileStream = createReadStream(this.storageFile);
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
    const loadedEvents: WorkspaceEvent[] = [];
    let lineNumber = 0;
    let sanitizedLoadedEvents = false;

    for await (const line of rl) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as WorkspaceEvent;
        const sanitizedEvent = sanitizeEventForStorage(event);
        if (JSON.stringify(sanitizedEvent) !== trimmed) {
          sanitizedLoadedEvents = true;
        }
        loadedEvents.push(sanitizedEvent);
      } catch (parseError) {
        logger.warn('Failed to parse JSONL line', {
          lineNumber,
          error: (parseError as Error).message,
        });
      }
    }

    if (loadedEvents.length > this.maxEvents) {
      this.events = loadedEvents.slice(-this.maxEvents);
      this.needsFullRewrite = true;
    } else {
      this.events = loadedEvents;
    }

    if (sanitizedLoadedEvents) {
      this.needsFullRewrite = true;
    }

    this.rebuildAllIndexes();

    if (this.compactOnSave && this.events.length > this.compactThreshold) {
      this.compact();
    }

    logger.info('Events loaded from JSONL (streaming)', {
      eventCount: this.events.length,
    });
  }

  /**
   * Load events from legacy JSON file and migrate to JSONL
   */
  private async loadFromLegacyJson(): Promise<void> {
    try {
      const data = await fs.readFile(this.legacyStorageFile, 'utf-8');
      const parsed = JSON.parse(data);

      if (parsed.version !== 1) {
        logger.warn('Unknown legacy event store version', { version: parsed.version });
        return;
      }

      if (parsed.workspaceId !== this.workspaceId) {
        logger.warn('Workspace ID mismatch in legacy file', {
          expected: this.workspaceId,
          actual: parsed.workspaceId,
        });
        return;
      }

      // Load and sanitize events
      const rawEvents = parsed.events || [];
      this.events = rawEvents.map((event: WorkspaceEvent) => sanitizeEventForStorage(event));

      // Trim if over limit
      if (this.events.length > this.maxEvents) {
        this.events = this.events.slice(-this.maxEvents);
      }

      // Rebuild all indexes
      this.rebuildAllIndexes();

      // Mark for full rewrite to create JSONL file
      this.needsFullRewrite = true;
      this.scheduleSave();

      logger.info('Migrated events from legacy JSON to JSONL', {
        eventCount: this.events.length,
        savedAt: parsed.savedAt,
      });

      // Optionally delete legacy file after successful migration
      // We'll keep it for now as a backup - can be manually deleted
    } catch (error) {
      const errnoError = error as NodeJS.ErrnoException;
      if (errnoError.code === 'ENOENT') {
        logger.debug('No legacy event store found');
      } else {
        logger.error('Failed to load legacy events', { error: (error as Error).message });
      }
    }
  }

  /**
   * Rebuild the event index
   */
  private rebuildIndex(): void {
    this.eventIndex.clear();
    for (const event of this.events) {
      this.eventIndex.set(event.id, event);
    }
  }

  /**
   * Rebuild all indexes
   */
  private rebuildAllIndexes(): void {
    // Clear all indexes
    this.eventIndex.clear();
    this.typeIndex.clear();
    this.actorIndex.clear();
    this.dateIndex.clear();

    // Rebuild from events
    for (const event of this.events) {
      this.eventIndex.set(event.id, event);
      this.addToIndexes(event);
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    // Save any pending events before disposing
    if (this.persistToDisk && (this.pendingEvents.length > 0 || this.needsFullRewrite)) {
      await this.saveToDisk();
    }
  }
}

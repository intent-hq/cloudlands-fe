/**
 * Event Coordinator Module
 *
 * Coordinates event emission between different change detection systems.
 * Handles event deduplication, ordering, and routing.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../../shared/logger';
import {
  WorkspaceEventType,
  type WorkspaceEvent,
} from '../../../events/types';
import type { ProcessedChange } from './change-processor';
import { TRACKING_CONFIG } from '../../../file-tracking/tracking.config';

const logger = new Logger('EventCoordinator');

export interface EventStats {
  totalEvents: number;
  eventsPerType: Map<WorkspaceEventType, number>;
  duplicatesFiltered: number;
  batchesEmitted: number;
  lastEmissionTime: string | null;
}

export class EventCoordinator extends EventEmitter {
  private workspaceId: string;
  private config = TRACKING_CONFIG.events;
  private stats: EventStats;
  private eventQueue: WorkspaceEvent[] = [];
  private emissionTimer: NodeJS.Timeout | null = null;

  constructor(workspaceId: string) {
    super();
    this.workspaceId = workspaceId;

    this.stats = {
      totalEvents: 0,
      eventsPerType: new Map(),
      duplicatesFiltered: 0,
      batchesEmitted: 0,
      lastEmissionTime: null,
    };
  }

  /**
   * Handle a batch of processed changes
   */
  async handleChangesBatch(changes: ProcessedChange[]): Promise<void> {
    const events: WorkspaceEvent[] = [];

    for (const change of changes) {
      // Don't check for duplicates here - let the event queue handle deduplication
      // This prevents the event from being marked as duplicate before it reaches the queue
      events.push(change.event);
      this.trackEvent(change.event);
    }

    if (events.length > 0) {
      await this.queueEvents(events);
    }
  }

  /**
   * Handle a single workspace event
   */
  async handleEvent(event: WorkspaceEvent): Promise<void> {
    // Don't check for duplicates here - let the event queue handle deduplication
    // This prevents the event from being marked as duplicate before it reaches the queue
    this.trackEvent(event);
    await this.queueEvents([event]);
  }

  /**
   * Queue events for emission
   */
  private async queueEvents(events: WorkspaceEvent[]): Promise<void> {
    this.eventQueue.push(...events);

    // Clear existing timer
    if (this.emissionTimer) {
      clearTimeout(this.emissionTimer);
    }

    // Set new timer using the configured batch interval
    this.emissionTimer = setTimeout(() => {
      this.emitQueuedEvents();
    }, this.config.batchInterval);

    // Emit immediately if queue is full
    if (this.eventQueue.length >= this.config.maxBatchSize) {
      await this.emitQueuedEvents();
    }
  }

  /**
   * Emit queued events
   */
  private async emitQueuedEvents(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    const events = [...this.eventQueue];
    this.eventQueue = [];

    // Clear timer
    if (this.emissionTimer) {
      clearTimeout(this.emissionTimer);
      this.emissionTimer = null;
    }

    // Sort events by timestamp
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Emit each event as an activity-log-event, bridged into Redux via
    // ChangeDetectorRefactored → ChangeDetectorManager → workspace.ipc.ts → mainDispatch(emitWorkspaceEvent).
    // This is the ONLY path for emitting file change events — all other paths were causing duplicates.
    for (const event of events) {
      this.emit('activity-log-event', event);
    }

    // Update stats
    this.stats.batchesEmitted++;
    this.stats.lastEmissionTime = new Date().toISOString();

    // Emit batch event
    this.emit('events-emitted', events);

    logger.debug(`Emitted batch of ${events.length} events`);
  }

  /**
   * Track an event for statistics
   */
  private trackEvent(event: WorkspaceEvent): void {
    // Update stats only - deduplication is handled by the service
    this.stats.totalEvents++;
    const count = this.stats.eventsPerType.get(event.type) || 0;
    this.stats.eventsPerType.set(event.type, count + 1);
  }

  /**
   * Create a summary event for multiple file changes
   */
  createSummaryEvent(
    changes: ProcessedChange[],
    actor: { type: string; id: string; name: string },
  ): WorkspaceEvent {
    const fileCount = changes.length;
    const additions = changes.reduce((sum, c) => sum + c.change.additions, 0);
    const deletions = changes.reduce((sum, c) => sum + c.change.deletions, 0);

    return {
      id: uuidv4(),
      workspaceId: this.workspaceId,
      timestamp: new Date().toISOString(),
      type: 'file:changed' as WorkspaceEventType,
      actor: {
        type: actor.type as any,
        id: actor.id,
        name: actor.name,
      },
      data: {
        fileCount,
        additions,
        deletions,
        files: changes.map((c) => ({
          path: c.change.path,
          action: c.change.action,
        })),
      },
      metadata: {
        summary: `${fileCount} files changed (+${additions} -${deletions})`,
      },
    };
  }

  /**
   * Get current statistics
   */
  getStats(): EventStats {
    return {
      ...this.stats,
      eventsPerType: new Map(this.stats.eventsPerType),
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalEvents: 0,
      eventsPerType: new Map(),
      duplicatesFiltered: 0,
      batchesEmitted: 0,
      lastEmissionTime: null,
    };
  }

  /**
   * Force emit any queued events
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length > 0) {
      await this.emitQueuedEvents();
    }
  }

  /**
   * Get the current queue size
   */
  getQueueSize(): number {
    return this.eventQueue.length;
  }

  /**
   * Destroy the coordinator
   */
  async destroy(): Promise<void> {
    // Emit any remaining events
    await this.flush();

    // Clear timers
    if (this.emissionTimer) {
      clearTimeout(this.emissionTimer);
      this.emissionTimer = null;
    }

    // Clear data
    this.eventQueue = [];
    this.removeAllListeners();

    logger.info('Event coordinator destroyed');
  }

  /**
   * Cleanup alias for destroy (for backward compatibility)
   */
  cleanup(): void {
    this.destroy().catch((error) => {
      logger.error('Error during cleanup', { error });
    });
  }
}

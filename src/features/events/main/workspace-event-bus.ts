/**
 * Workspace Event Bus
 *
 * Central event system for workspace components with typed filters and queries.
 * Allows any component to subscribe to and query workspace events.
 */

import { EventEmitter } from '../../../shared/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import {
  WorkspaceEvent,
  WorkspaceEventType,
  EventFilter,
  EventSubscription,
  SubscribeOptions,
  ActorType,
  EventActor,
  FileChangedEvent,
} from '../types';
import { EventFilterEngine } from '../event-filter-engine';
import { EventStore } from './event-store';
import { EventQueryEngine } from './event-query-engine';
import { getDeduplicationService } from '../event-deduplication.service';
import { BrowserWindow } from 'electron';
import { unifiedEventBus } from './unified-event-bus';
import { getWindowIdsForWorkspace } from '../../system/main/system.ipc';

const logger = new Logger('WorkspaceEventBus');

// ============================================================================
// STDIO Broadcasting for MCP Clients
// ============================================================================

let stdioConnection: NodeJS.WriteStream | null = null;

/**
 * Set the STDIO connection for MCP clients.
 * WorkspaceEventBus will broadcast events to this stream.
 */
export function setWorkspaceStdioConnection(stream: NodeJS.WriteStream | null): void {
  stdioConnection = stream;
  logger.info('STDIO connection updated', { connected: !!stream });
}

/**
 * Type-safe filter builder for workspace events
 * @template _T - The type of workspace event being filtered (used for type inference)
 */

export class EventFilterBuilder<_T extends WorkspaceEvent = WorkspaceEvent> {
  private filters: EventFilter[] = [];

  /**
   * Filter by event type
   */
  ofType<K extends WorkspaceEventType>(
    type: K,
  ): EventFilterBuilder<Extract<WorkspaceEvent, { type: K }>> {
    this.filters.push({
      field: 'type',
      operator: 'equals',
      value: type,
    });
    return this as any;
  }

  /**
   * Filter by multiple event types (uses 'in' operator)
   */
  ofTypes(types: WorkspaceEventType[]): this {
    if (types.length === 1) {
      this.filters.push({
        field: 'type',
        operator: 'equals' as const,
        value: types[0],
      });
    } else if (types.length > 1) {
      this.filters.push({
        field: 'type',
        operator: 'in' as const,
        value: types,
      });
    }
    return this;
  }

  /**
   * Filter by actor
   */
  byActor(actorType: ActorType, actorId?: string): this {
    this.filters.push({
      field: 'actor.type',
      operator: 'equals',
      value: actorType,
    });

    if (actorId) {
      this.filters.push({
        field: 'actor.id',
        operator: 'equals',
        value: actorId,
      });
    }

    return this;
  }

  /**
   * Filter by time - events since a specific timestamp
   */
  since(timestamp: Date | string): this {
    this.filters.push({
      field: 'timestamp',
      operator: 'greater_than',
      value: typeof timestamp === 'string' ? timestamp : timestamp.toISOString(),
    });
    return this;
  }

  /**
   * Filter by time - events in the last duration
   */
  inLast(milliseconds: number): this {
    const since = new Date(Date.now() - milliseconds);
    return this.since(since);
  }

  /**
   * Filter by path prefix (for file events)
   */
  inPath(path: string): this {
    this.filters.push({
      field: 'data.path',
      operator: 'starts_with',
      value: path,
    });
    return this;
  }

  /**
   * Filter by path pattern (regex or glob)
   */
  matchingPattern(pattern: string | RegExp): this {
    this.filters.push({
      field: 'data.path',
      operator: 'matches',
      value: pattern,
    });
    return this;
  }

  /**
   * Filter by session ID
   */
  inSession(sessionId: string): this {
    this.filters.push({
      field: 'sessionId',
      operator: 'equals',
      value: sessionId,
    });
    return this;
  }

  /**
   * Filter by correlation ID (for related events)
   */
  withCorrelation(correlationId: string): this {
    this.filters.push({
      field: 'correlationId',
      operator: 'equals',
      value: correlationId,
    });
    return this;
  }

  /**
   * Limit the number of results
   */
  limit(count: number): this {
    this.filters.push({
      field: '_limit',
      operator: 'equals',
      value: count,
    });
    return this;
  }

  /**
   * Build the filter array
   */
  build(): EventFilter[] {
    return this.filters;
  }
}

/**
 * Main event bus for workspace events
 */
export class WorkspaceEventBus extends EventEmitter {
  private subscribers: Map<string, EventSubscription> = new Map();
  private eventStore: EventStore;
  private filterEngine: EventFilterEngine;
  private queryEngine: EventQueryEngine;
  private deduplicationService = getDeduplicationService();
  private recentEventsBuffer: WorkspaceEvent[] = [];
  private readonly MAX_BUFFER_SIZE = 1000;
  private instanceId = uuidv4().substring(0, 8);
  private initializePromise: Promise<void> | null = null;

  constructor(private workspaceId: string) {
    super();
    // Increase max listeners to prevent warnings in tests
    // Set to 100 to match EventBus and handle multiple test suites
    this.setMaxListeners(100);
    this.eventStore = new EventStore(workspaceId);
    this.filterEngine = new EventFilterEngine();
    this.queryEngine = new EventQueryEngine(this.eventStore);

    logger.info('WorkspaceEventBus initialized', { workspaceId, instanceId: this.instanceId });
  }

  /**
   * Initialize the event bus (loads events from disk)
   */
  async initialize(): Promise<void> {
    // If already initializing, return the existing promise
    if (this.initializePromise) {
      return this.initializePromise;
    }

    // Create and store the initialization promise
    this.initializePromise = (async () => {
      // Wait for the event store to load events from disk
      await this.eventStore.initialize();

      logger.debug('Event bus initialized', {
        workspaceId: this.workspaceId,
        eventCount: this.eventStore.getAll().length,
      });
    })();

    return this.initializePromise;
  }

  /**
   * Wait for initialization to complete (used by query methods)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initializePromise) {
      await this.initializePromise;
    }
  }

  /**
   * Get the total number of events
   */
  async getEventCount(): Promise<number> {
    await this.ensureInitialized();
    return this.eventStore.getAll().length;
  }

  /**
   * Subscribe to events with filters
   */
  subscribe<T extends WorkspaceEvent = WorkspaceEvent>(
    options: SubscribeOptions<T>,
  ): EventSubscription {
    const subscription: EventSubscription = {
      id: uuidv4(),
      filters: options.filters || [],
      callback: options.callback as (event: WorkspaceEvent) => void,
      includeHistorical: options.includeHistorical || false,
    };

    this.subscribers.set(subscription.id, subscription);

    logger.info('WorkspaceEventBus: Subscription created', {
      workspaceId: this.workspaceId,
      instanceId: this.instanceId,
      subscriptionId: subscription.id,
      filters: subscription.filters,
      filterCount: subscription.filters.length,
      includeHistorical: subscription.includeHistorical,
      totalSubscribers: this.subscribers.size,
    });

    // Send historical events if requested
    if (options.includeHistorical && options.historicalLimit) {
      this.sendHistoricalEvents(subscription, options.historicalLimit);
    }

    // Return unsubscribe function
    return {
      ...subscription,
      unsubscribe: () => this.unsubscribe(subscription.id),
    };
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): void {
    if (this.subscribers.delete(subscriptionId)) {
      logger.debug('Subscription removed', { subscriptionId });
    }
  }

  /**
   * Query historical events
   */
  async query<T extends WorkspaceEvent = WorkspaceEvent>(filters: EventFilter[]): Promise<T[]> {
    // Wait for initialization to complete before querying
    await this.ensureInitialized();
    logger.debug('Querying events', { filterCount: filters.length });

    // Check if we can serve from buffer for recent queries
    const limitFilter = filters.find((f) => f.field === '_limit');
    const limit = limitFilter?.value as number | undefined;

    if (this.canServeFromBuffer(filters)) {
      return this.queryBuffer<T>(filters, limit);
    }

    // Otherwise query the store
    return this.queryEngine.query<T>(filters);
  }

  /**
   * Get last N events of a specific type
   */
  async getLastEvents<T extends WorkspaceEvent>(
    type: WorkspaceEventType,
    limit: number = 10,
  ): Promise<T[]> {
    const filters = new EventFilterBuilder().ofType(type).limit(limit).build();

    return this.query<T>(filters);
  }

  /**
   * Get last N files that were touched
   */
  async getLastFilesTouched(limit: number = 3): Promise<FileInfo[]> {
    const events = await this.query<FileChangedEvent>(
      new EventFilterBuilder().ofType('file:changed').limit(limit).build(),
    );

    return events.map((e) => ({
      path: e.data.path,
      relativePath: e.data.relativePath,
      action: e.data.action,
      timestamp: e.timestamp,
      actor: e.actor,
      changes: {
        additions: e.data.additions,
        deletions: e.data.deletions,
      },
    }));
  }

  /**
   * Emit an event to all matching subscribers
   */
  emitEvent(event: WorkspaceEvent): void {
    // PERF: Changed from INFO to DEBUG - this is called for every event emission
    // which can be dozens per second during file changes
    logger.debug('WorkspaceEventBus: emitEvent called', {
      workspaceId: this.workspaceId,
      instanceId: this.instanceId,
      eventId: event.id,
      eventType: event.type,
      subscriberCount: this.subscribers.size,
    });

    try {
      // Validate event
      if (!event.id) event.id = uuidv4();
      if (!event.timestamp) event.timestamp = new Date().toISOString();
      if (!event.workspaceId) event.workspaceId = this.workspaceId;

      // Check for duplicates using centralized service
      const isDupe = this.deduplicationService.isDuplicate(event);
      // PERF: Changed from INFO to DEBUG - called for every event
      logger.debug('WorkspaceEventBus: Checking for duplicate', {
        workspaceId: this.workspaceId,
        instanceId: this.instanceId,
        eventId: event.id,
        eventType: event.type,
        isDuplicate: isDupe,
      });
      if (isDupe) {
        logger.debug('WorkspaceEventBus: Duplicate event ignored', {
          workspaceId: this.workspaceId,
          instanceId: this.instanceId,
          eventId: event.id,
          eventType: event.type,
        });
        return;
      }

      // Store event
      try {
        this.eventStore.add(event);
      } catch (error) {
        logger.error('Failed to store event', {
          eventId: event.id,
          eventType: event.type,
          error,
        });
        // Continue with emission even if storage fails
      }

      // Add to buffer only after successful storage
      try {
        this.addToBuffer(event);
      } catch (error) {
        logger.error('Failed to add event to buffer', {
          eventId: event.id,
          error,
        });
        // Continue with emission
      }

      // Notify subscribers
      let notifiedCount = 0;
      let failedCount = 0;

      // PERF: Changed from INFO to DEBUG - called for every event
      logger.debug('WorkspaceEventBus: Notifying subscribers', {
        workspaceId: this.workspaceId,
        instanceId: this.instanceId,
        eventType: event.type,
        eventId: event.id,
        subscriberCount: this.subscribers.size,
      });

      for (const subscription of this.subscribers.values()) {
        try {
          const matches = this.filterEngine.matches(event, subscription.filters);

          // Debug: Log filter matching result
          logger.debug('WorkspaceEventBus: Filter matching', {
            subscriptionId: subscription.id,
            eventType: event.type,
            filters: subscription.filters,
            matches,
          });

          if (matches) {
            try {
              // PERF: Changed from INFO to DEBUG - called for every matching subscriber
              logger.debug('WorkspaceEventBus: Calling subscriber callback', {
                subscriptionId: subscription.id,
                eventType: event.type,
                eventId: event.id,
              });
              subscription.callback(event);
              notifiedCount++;
            } catch (error) {
              failedCount++;
              logger.error('Subscriber callback failed', {
                subscriptionId: subscription.id,
                eventType: event.type,
                eventId: event.id,
                error,
              });
              // Continue with other subscribers
            }
          }
        } catch (error) {
          logger.error('Filter matching failed', {
            subscriptionId: subscription.id,
            eventType: event.type,
            error,
          });
          // Continue with other subscribers
        }
      }

      if (failedCount > 0) {
        logger.warn('Some subscribers failed', {
          eventType: event.type,
          eventId: event.id,
          notifiedCount,
          failedCount,
        });
      } else {
        logger.debug('Event emitted', {
          eventType: event.type,
          eventId: event.id,
          notifiedSubscribers: notifiedCount,
        });
      }

      // Emit to parent EventEmitter for backward compatibility
      try {
        super.emit(event.type, event);
        super.emit('event', event); // Generic event for catch-all listeners
      } catch (error) {
        logger.error('Failed to emit to EventEmitter', {
          eventType: event.type,
          eventId: event.id,
          error,
        });
        // Don't throw - backward compatibility is not critical
      }

      // Forward to UnifiedEventBus for cross-workspace subscriptions
      // This allows components like event-handler-registry to receive events
      // across all workspaces without needing to subscribe to each WorkspaceEventBus
      try {
        unifiedEventBus.emit(event.type, event);
      } catch (error) {
        logger.error('Failed to forward event to UnifiedEventBus', {
          eventType: event.type,
          eventId: event.id,
          error,
        });
      }

      // Broadcast to renderer windows so UI components can listen for events
      this.broadcastToRenderer(event);
    } catch (error) {
      logger.error('Fatal error in emitEvent', {
        eventType: event?.type,
        eventId: event?.id,
        error,
      });
      // Don't throw - allow system to continue
    }
  }

  /**
   * Broadcast an event to renderer windows viewing this workspace, and STDIO (for MCP clients).
   * Uses workspace-scoped targeting: only windows viewing the event's workspace receive it.
   * Falls back to all windows if workspace ID is not available (global events).
   */
  private broadcastToRenderer(event: WorkspaceEvent): void {
    // Broadcast to renderer windows - scoped to the event's workspace
    try {
      let targetWindows: BrowserWindow[];

      if (event.workspaceId) {
        // Workspace-scoped: only send to windows viewing this workspace
        const windowIds = getWindowIdsForWorkspace(event.workspaceId);
        if (windowIds.length > 0) {
          targetWindows = windowIds
            .map((id) => BrowserWindow.fromId(id))
            .filter((w): w is BrowserWindow => w !== null && !w.isDestroyed());
        } else {
          // No windows found for workspace - fall back to all windows
          // This handles edge cases like events emitted before window registration
          targetWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
        }
      } else {
        // Global events (no workspace ID) - broadcast to all windows
        targetWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      }

      logger.debug('Broadcasting event to renderer', {
        eventType: event.type,
        eventId: event.id,
        windowCount: targetWindows.length,
        workspaceScoped: !!event.workspaceId,
      });

      for (const window of targetWindows) {
        // Send on specific event type channel for backwards compatibility
        window.webContents.send(event.type, event);
        // Also send on 'events:new' channel which the ActivityTimeline listens to
        window.webContents.send('events:new', {
          workspaceId: event.workspaceId,
          event,
        });
      }
    } catch (error) {
      logger.error('Failed to broadcast event to renderer', {
        eventType: event.type,
        eventId: event.id,
        error,
      });
    }

    // Broadcast to STDIO for MCP clients
    if (stdioConnection && !stdioConnection.destroyed) {
      try {
        const eventName = event.type || 'unknown';
        stdioConnection.write(`${JSON.stringify({ event: eventName, data: event })}\n`);
      } catch (error) {
        logger.error('Failed to broadcast event to STDIO', {
          eventType: event.type,
          eventId: event.id,
          error,
        });
      }
    }
  }

  /**
   * Add event to recent buffer
   */
  private addToBuffer(event: WorkspaceEvent): void {
    this.recentEventsBuffer.unshift(event);

    // Trim buffer if too large
    if (this.recentEventsBuffer.length > this.MAX_BUFFER_SIZE) {
      this.recentEventsBuffer = this.recentEventsBuffer.slice(0, this.MAX_BUFFER_SIZE);
    }
  }

  /**
   * Check if query can be served from buffer
   */
  private canServeFromBuffer(filters: EventFilter[]): boolean {
    // Only serve from buffer if querying recent events
    const timeFilter = filters.find(
      (f) => f.field === 'timestamp' && f.operator === 'greater_than',
    );

    if (!timeFilter) return false;

    const since = new Date(timeFilter.value as string);
    const bufferOldest = this.recentEventsBuffer[this.recentEventsBuffer.length - 1];

    if (!bufferOldest) return false;

    return new Date(bufferOldest.timestamp) >= since;
  }

  /**
   * Query events from buffer
   */
  private queryBuffer<T extends WorkspaceEvent>(filters: EventFilter[], limit?: number): T[] {
    let results = this.recentEventsBuffer.filter((event) =>
      this.filterEngine.matches(event, filters),
    );

    if (limit) {
      results = results.slice(0, limit);
    }

    return results as T[];
  }

  /**
   * Send historical events to a new subscriber
   */
  private async sendHistoricalEvents(
    subscription: EventSubscription,
    limit: number,
  ): Promise<void> {
    const events = await this.queryEvents(subscription.filters);
    const eventsToSend = events.slice(0, limit);

    logger.debug('Sending historical events', {
      subscriptionId: subscription.id,
      eventCount: eventsToSend.length,
    });

    for (const event of eventsToSend) {
      subscription.callback(event);
    }
  }

  /**
   * Get statistics about events
   */
  async getStatistics(): Promise<EventStatistics> {
    await this.ensureInitialized();
    const stats = this.eventStore.getStatistics();

    return {
      ...stats,
      activeSubscriptions: this.subscribers.size,
      bufferSize: this.recentEventsBuffer.length,
    };
  }

  /**
   * Clear all events (for testing)
   */
  async clear(): Promise<void> {
    await this.eventStore.clear();
    this.recentEventsBuffer = [];
    logger.info('Event bus cleared');
  }

  /**
   * Force save events to disk (for testing)
   */
  async forceSave(): Promise<void> {
    await this.eventStore.forceSave();
  }

  /**
   * Query events with filters
   */
  async queryEvents(filters?: EventFilter | EventFilter[]): Promise<WorkspaceEvent[]> {
    // Wait for initialization to complete before querying
    await this.ensureInitialized();
    const filterArray = Array.isArray(filters) ? filters : filters ? [filters] : [];
    return await this.queryEngine.query(filterArray);
  }

  /**
   * Dispose of the event bus and clean up resources
   */
  async dispose(): Promise<void> {
    // Dispose the event store (saves pending changes)
    await this.eventStore.dispose();

    // Clear subscribers
    this.subscribers.clear();

    // Remove all EventEmitter listeners
    this.removeAllListeners();

    // Clear buffer
    this.recentEventsBuffer = [];

    logger.info('WorkspaceEventBus disposed', {
      workspaceId: this.workspaceId,
      instanceId: this.instanceId,
    });
  }
}

// Type definitions for file info
interface FileInfo {
  path: string;
  relativePath: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  timestamp: string;
  actor: EventActor;
  changes?: {
    additions?: number;
    deletions?: number;
  };
}

// FileChangedEvent is already defined in types.ts

export interface EventStatistics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByActor: Record<string, number>;
  activeSubscriptions: number;
  bufferSize: number;
}

// ============================================================================
// Singleton Management
// ============================================================================

const eventBusInstances: Map<string, WorkspaceEventBus> = new Map();

/**
 * Get or create a WorkspaceEventBus for a workspace.
 * This provides singleton access to event buses by workspace ID.
 */
export function getWorkspaceEventBus(workspaceId: string): WorkspaceEventBus {
  let bus = eventBusInstances.get(workspaceId);
  if (!bus) {
    bus = new WorkspaceEventBus(workspaceId);
    eventBusInstances.set(workspaceId, bus);
    // Initialize asynchronously
    bus.initialize().catch((error) => {
      logger.error('Failed to initialize event bus', { workspaceId, error });
    });
  }
  return bus;
}

/**
 * Dispose of a workspace's event bus
 * This properly cleans up the EventStore and all subscriptions
 */
export async function disposeWorkspaceEventBus(workspaceId: string): Promise<void> {
  const bus = eventBusInstances.get(workspaceId);
  if (bus) {
    eventBusInstances.delete(workspaceId);
    await bus.dispose();
    logger.debug('Event bus disposed', { workspaceId });
  }
}

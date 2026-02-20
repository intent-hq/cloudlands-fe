/**
 * Unified Event Bus Client (Renderer Process)
 *
 * Renderer-side proxy for the unified event bus that communicates
 * with the main process via IPC.
 */

import { EventEmitter } from '../../../shared/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import type {
  WorkspaceEvent,
  WorkspaceEventType,
  EventFilter,
  EventSubscription,
  SubscribeOptions,
} from '../types';

const logger = new Logger('UnifiedEventBusClient');

/**
 * Simple client-side deduplication to prevent duplicate event processing
 * when the same event arrives through multiple IPC channels.
 */
class ClientEventDeduplicator {
  private recentEventIds = new Map<string, number>();
  private readonly windowMs = 1000; // 1 second deduplication window
  private readonly maxCacheSize = 500;

  isDuplicate(event: WorkspaceEvent): boolean {
    if (!event.id) return false;

    const lastSeen = this.recentEventIds.get(event.id);
    const now = Date.now();

    if (lastSeen && now - lastSeen < this.windowMs) {
      return true;
    }

    // Track this event
    this.recentEventIds.set(event.id, now);

    // Cleanup if cache is too large
    if (this.recentEventIds.size > this.maxCacheSize) {
      this.cleanup();
    }

    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    for (const [id, timestamp] of this.recentEventIds.entries()) {
      if (timestamp < cutoff) {
        this.recentEventIds.delete(id);
      }
    }
  }

  clear(): void {
    this.recentEventIds.clear();
  }
}

/**
 * Renderer-side event bus client
 *
 * Provides the same interface as the main process event bus
 * but communicates via IPC.
 */
export class UnifiedEventBusClient extends EventEmitter {
  private static instance: UnifiedEventBusClient;
  private subscribers: Map<string, EventSubscription> = new Map();
  private initialized = false;
  private deduplicator = new ClientEventDeduplicator();

  private constructor() {
    super();
    this.setMaxListeners(100);
    this.setupIPCListeners();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UnifiedEventBusClient {
    if (!UnifiedEventBusClient.instance) {
      UnifiedEventBusClient.instance = new UnifiedEventBusClient();
    }
    return UnifiedEventBusClient.instance;
  }

  /**
   * Setup IPC listeners for events from main process
   */
  private setupIPCListeners(): void {
    if (typeof window === 'undefined' || !window.electronAPI) {
      logger.warn('ElectronAPI not available, running in non-Electron environment');
      return;
    }

    // Listen for workspace events from main process
    // Note: The preload script passes data directly, not as a second parameter
    window.electronAPI.on('workspace:event', (data: WorkspaceEvent) => {
      this.handleIncomingEvent(data);
    });

    // Listen for broadcast events
    window.electronAPI.on('event:broadcast', (data: WorkspaceEvent) => {
      this.handleIncomingEvent(data);
    });

    // Listen for events:new channel (used by ActivityTimeline)
    window.electronAPI.on('events:new', (data: { workspaceId: string; event: WorkspaceEvent }) => {
      if (data.event) {
        this.handleIncomingEvent(data.event);
      }
    });

    this.initialized = true;
    logger.info('IPC listeners setup complete');
  }

  /**
   * Handle incoming event from main process
   */
  private handleIncomingEvent(event: WorkspaceEvent): void {
    // Check for duplicate events (same event arriving through multiple IPC channels)
    if (this.deduplicator.isDuplicate(event)) {
      logger.debug('Duplicate event skipped on client', {
        eventId: event.id,
        eventType: event.type,
      });
      return;
    }

    // Emit to local listeners
    this.emit(event.type, event);
    this.emit('event', event);

    // Notify subscribers
    for (const subscription of this.subscribers.values()) {
      try {
        // For now, call all subscribers - filtering should be done on main process
        subscription.callback(event);
      } catch (error) {
        logger.error('Subscriber callback error', {
          subscriptionId: subscription.id,
          error,
        });
      }
    }
  }

  /**
   * Emit an event (sends to main process)
   */
  async emitEvent(
    event: WorkspaceEvent,
    options?: { broadcast?: boolean; persist?: boolean },
  ): Promise<void> {
    if (!window.electronAPI) {
      logger.warn('Cannot emit event - ElectronAPI not available');
      return;
    }

    // Ensure event has required fields
    if (!event.id) event.id = uuidv4();
    if (!event.timestamp) event.timestamp = new Date().toISOString();

    try {
      // Send to main process
      await window.electronAPI.invoke('events:emit', {
        event,
        options,
      });

      logger.debug('Event sent to main process', {
        eventId: event.id,
        eventType: event.type,
      });
    } catch (error) {
      logger.error('Failed to emit event', { event, error });
      throw error;
    }
  }

  /**
   * Subscribe to events with filters
   */
  async subscribe<T extends WorkspaceEvent = WorkspaceEvent>(
    options: SubscribeOptions<T>,
  ): Promise<EventSubscription> {
    const subscription: EventSubscription = {
      id: uuidv4(),
      filters: options.filters || [],
      callback: options.callback as (event: WorkspaceEvent) => void,
      includeHistorical: options.includeHistorical || false,
    };

    // Store local subscription
    this.subscribers.set(subscription.id, subscription);

    // Register with main process if available
    if (window.electronAPI) {
      try {
        await window.electronAPI.invoke('events:subscribe', {
          subscriptionId: subscription.id,
          filters: subscription.filters,
          includeHistorical: subscription.includeHistorical,
          historicalLimit: options.historicalLimit,
        });
      } catch (error) {
        logger.error('Failed to register subscription with main process', {
          subscriptionId: subscription.id,
          error,
        });
      }
    }

    logger.debug('Subscription created', {
      subscriptionId: subscription.id,
      filterCount: subscription.filters.length,
    });

    return subscription;
  }

  /**
   * Unsubscribe from events
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    // Remove local subscription
    if (this.subscribers.delete(subscriptionId)) {
      logger.debug('Local subscription removed', { subscriptionId });
    }

    // Unregister with main process
    if (window.electronAPI) {
      try {
        await window.electronAPI.invoke('events:unsubscribe', { subscriptionId });
      } catch (error) {
        logger.error('Failed to unregister subscription with main process', {
          subscriptionId,
          error,
        });
      }
    }
  }

  /**
   * Query events with filters
   */
  async query(workspaceId: string, filters: EventFilter[], limit?: number): Promise<WorkspaceEvent[]> {
    if (!window.electronAPI) {
      logger.warn('Cannot query events - ElectronAPI not available');
      return [];
    }

    try {
      const events = await window.electronAPI.invoke('events:query', {
        workspaceId,
        filters,
        limit,
      });
      return events;
    } catch (error) {
      logger.error('Failed to query events', { workspaceId, filters, error });
      return [];
    }
  }

  /**
   * Get the last event of a specific type
   */
  async getLastEvent(
    type: WorkspaceEventType,
    workspaceId?: string,
  ): Promise<WorkspaceEvent | undefined> {
    if (!window.electronAPI) {
      logger.warn('Cannot get last event - ElectronAPI not available');
      return undefined;
    }

    try {
      const event = await window.electronAPI.invoke('events:getLastEvent', {
        type,
        workspaceId,
      });
      return event;
    } catch (error) {
      logger.error('Failed to get last event', { type, workspaceId, error });
      return undefined;
    }
  }

  /**
   * Get statistics from the main process
   */
  async getStatistics(): Promise<{
    workspaceCount: number;
    subscriberCount: number;
    cachedEventCount: number;
  }> {
    if (!window.electronAPI) {
      return {
        workspaceCount: 0,
        subscriberCount: this.subscribers.size,
        cachedEventCount: 0,
      };
    }

    try {
      const stats = await window.electronAPI.invoke('events:getStatistics', {});
      return stats;
    } catch (error) {
      logger.error('Failed to get statistics', { error });
      return {
        workspaceCount: 0,
        subscriberCount: this.subscribers.size,
        cachedEventCount: 0,
      };
    }
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.subscribers.clear();
    this.removeAllListeners();
    this.deduplicator.clear();
    logger.info('UnifiedEventBusClient destroyed');
  }
}

// Export singleton instance
export const unifiedEventBusClient = UnifiedEventBusClient.getInstance();

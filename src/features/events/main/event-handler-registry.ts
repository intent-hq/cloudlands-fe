/**
 * Event Handler Registry
 *
 * A generic registry for registering handlers that react to workspace events.
 * Uses UnifiedEventBus under the hood with filtering support.
 *
 * Usage:
 *   // Register a handler for task status changes
 *   eventHandlerRegistry.register('task:status-changed', async (event) => {
 *     console.log('Task status changed:', event.data);
 *   });
 *
 *   // Register with workspace filter
 *   eventHandlerRegistry.register('file:changed', handler, {
 *     workspaceId: 'specific-workspace-id'
 *   });
 *
 *   // Initialize to start listening (call once at app startup)
 *   eventHandlerRegistry.initialize();
 */

import { Logger } from '../../../shared/logger';
import { unifiedEventBus } from './unified-event-bus';
import type { WorkspaceEvent, WorkspaceEventType, EventFilter, EventSubscription } from '../types';

const logger = new Logger('EventHandlerRegistry');

/**
 * Handler function type - receives the full WorkspaceEvent
 */
export type EventHandler<T extends WorkspaceEvent = WorkspaceEvent> = (
  event: T,
) => Promise<void> | void;

/**
 * Options for registering a handler
 */
export interface RegisterHandlerOptions {
  /** Only handle events for a specific workspace */
  workspaceId?: string;
  /** Additional filters to apply */
  filters?: EventFilter[];
  /** Handler name for debugging */
  name?: string;
}

interface RegisteredHandler {
  eventType: WorkspaceEventType;
  handler: EventHandler;
  options: RegisterHandlerOptions;
  subscriptionId?: string;
}

/**
 * Generic Event Handler Registry
 *
 * Allows registering handlers for any WorkspaceEventType.
 * Handlers are invoked when matching events are emitted via UnifiedEventBus.
 */
class EventHandlerRegistry {
  private static instance: EventHandlerRegistry;
  private handlers: RegisteredHandler[] = [];
  private initialized = false;
  private subscriptions: Map<string, EventSubscription> = new Map();

  private constructor() {}

  static getInstance(): EventHandlerRegistry {
    if (!EventHandlerRegistry.instance) {
      EventHandlerRegistry.instance = new EventHandlerRegistry();
    }
    return EventHandlerRegistry.instance;
  }

  /**
   * Register a handler for a specific event type
   *
   * @param eventType - The event type to handle
   * @param handler - The handler function
   * @param options - Optional filters and configuration
   * @returns Unsubscribe function
   */
  register<T extends WorkspaceEvent = WorkspaceEvent>(
    eventType: WorkspaceEventType,
    handler: EventHandler<T>,
    options: RegisterHandlerOptions = {},
  ): () => void {
    const registeredHandler: RegisteredHandler = {
      eventType,
      handler: handler as EventHandler,
      options,
    };

    this.handlers.push(registeredHandler);

    logger.info('Handler registered', {
      eventType,
      name: options.name,
      workspaceId: options.workspaceId,
      handlerCount: this.handlers.length,
    });

    // If already initialized, create subscription immediately
    if (this.initialized) {
      this.createSubscriptionForHandler(registeredHandler);
    }

    // Return unsubscribe function
    return () => {
      const index = this.handlers.indexOf(registeredHandler);
      if (index > -1) {
        this.handlers.splice(index, 1);

        // Remove subscription if it exists
        if (registeredHandler.subscriptionId) {
          unifiedEventBus.unsubscribe(registeredHandler.subscriptionId);
          this.subscriptions.delete(registeredHandler.subscriptionId);
        }

        logger.debug('Handler unregistered', {
          eventType,
          name: options.name,
        });
      }
    };
  }

  /**
   * Initialize the registry - start listening to events
   * Should be called once during app startup
   */
  initialize(): void {
    if (this.initialized) {
      logger.warn('EventHandlerRegistry already initialized');
      return;
    }

    logger.info('Initializing EventHandlerRegistry', {
      handlerCount: this.handlers.length,
    });

    // Create subscriptions for all registered handlers
    for (const handler of this.handlers) {
      this.createSubscriptionForHandler(handler);
    }

    this.initialized = true;
    logger.info('EventHandlerRegistry initialized');
  }

  private createSubscriptionForHandler(registeredHandler: RegisteredHandler): void {
    const { eventType, handler, options } = registeredHandler;

    // Build filters
    const filters: EventFilter[] = [{ field: 'type', operator: 'equals', value: eventType }];

    if (options.workspaceId) {
      filters.push({
        field: 'workspaceId',
        operator: 'equals',
        value: options.workspaceId,
      });
    }

    if (options.filters) {
      filters.push(...options.filters);
    }

    // Subscribe via UnifiedEventBus
    const subscription = unifiedEventBus.subscribe({
      filters,
      callback: async (event) => {
        try {
          await handler(event);
        } catch (error) {
          logger.error('Error in event handler', error as Error, {
            eventType,
            eventId: event.id,
            name: options.name,
          });
        }
      },
    });

    registeredHandler.subscriptionId = subscription.id;
    this.subscriptions.set(subscription.id, subscription);

    logger.debug('Subscription created for handler', {
      eventType,
      subscriptionId: subscription.id,
      filterCount: filters.length,
    });
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get statistics for debugging
   */
  getStats(): {
    handlerCount: number;
    subscriptionCount: number;
    handlersByType: Record<string, number>;
  } {
    const handlersByType: Record<string, number> = {};
    for (const h of this.handlers) {
      handlersByType[h.eventType] = (handlersByType[h.eventType] || 0) + 1;
    }

    return {
      handlerCount: this.handlers.length,
      subscriptionCount: this.subscriptions.size,
      handlersByType,
    };
  }
}

// Export singleton
export const eventHandlerRegistry = EventHandlerRegistry.getInstance();

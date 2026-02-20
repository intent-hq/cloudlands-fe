/**
 * Workspace Event Handler
 * Manages workspace events and activity log
 */

import { createLogger } from '$lib/utils/client-logger';
import { onEventCreated, queryEvents } from '$features/events/events.client';
import { getDeduplicationService } from '$features/events/event-deduplication.service';
import type { Workspace } from '$shared/types';
import type { WorkspaceEvent } from '$features/events/types';

const logger = createLogger('workspace-event-handler');

export class WorkspaceEventHandler {
  private workspaceId: string;
  private workspace: Workspace | null = null;
  private events: WorkspaceEvent[] = [];
  private eventHandlers: Set<(events: WorkspaceEvent[]) => void> = new Set();
  private unsubscribeEvents: (() => void) | null = null;
  private lastEventQuery: number = 0;
  private eventQueryPromise: Promise<WorkspaceEvent[]> | null = null;
  private readonly EVENT_CACHE_TTL = 2000; // 2 seconds cache

  constructor(workspaceId: string, workspace: Workspace | null) {
    this.workspaceId = workspaceId;
    this.workspace = workspace;
  }

  setWorkspace(workspace: Workspace | null) {
    this.workspace = workspace;
  }

  // Initialize event subscription
  async initialize() {
    if (!this.workspaceId) return;

    const deduplicationService = getDeduplicationService();

    try {
      // Use loadEvents which has caching
      await this.loadEvents([], 50);

      // Track all initial events in deduplication service
      this.events.forEach((event) => deduplicationService.trackEvent(event));

      // Subscribe to new events
      this.unsubscribeEvents = onEventCreated((data) => {
        if (data.workspaceId === this.workspaceId) {
          // Check for duplicates before adding
          if (deduplicationService.isDuplicate(data.event)) {
            logger.debug('[WorkspaceEventHandler] Skipping duplicate event:', {
              eventId: data.event.id,
              type: data.event.type,
            });
            return;
          }

          logger.debug('[WorkspaceEventHandler] Received event update:', {
            event: data.event,
            workspaceId: this.workspaceId,
          });

          // Add new event to the list
          this.events = [data.event, ...this.events].slice(0, 100); // Keep last 100 events
          this.lastEventQuery = Date.now(); // Update cache timestamp
          this.notifyHandlers();
        }
      });

      logger.info('[WorkspaceEventHandler] Initialized event subscription', {
        workspaceId: this.workspaceId,
        initialEventCount: this.events.length,
      });
    } catch (error) {
      logger.error('[WorkspaceEventHandler] Failed to initialize events:', error);
    }
  }

  // Get current events
  getEvents(): WorkspaceEvent[] {
    return this.events;
  }

  // Add event handler
  onEventsUpdate(handler: (events: WorkspaceEvent[]) => void) {
    this.eventHandlers.add(handler);
    // Immediately call with current events
    handler(this.events);

    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  // Notify all handlers
  private notifyHandlers() {
    this.eventHandlers.forEach((handler) => handler(this.events));
  }

  // Load events for a specific workspace with caching
  async loadEvents(filters: any[] = [], limit: number = 50): Promise<WorkspaceEvent[]> {
    if (!this.workspaceId) return this.events;

    // Check if we have a recent cache
    const now = Date.now();
    if (this.events.length > 0 && now - this.lastEventQuery < this.EVENT_CACHE_TTL) {
      logger.debug('[loadEvents] Using cached events', {
        workspaceId: this.workspaceId,
        count: this.events.length,
        cacheAge: now - this.lastEventQuery,
      });
      return this.events;
    }

    // If there's already a query in progress, return that promise
    if (this.eventQueryPromise) {
      logger.debug('[loadEvents] Reusing in-progress query', {
        workspaceId: this.workspaceId,
      });
      return this.eventQueryPromise;
    }

    // Create new query promise
    const deduplicationService = getDeduplicationService();
    this.eventQueryPromise = (async () => {
      try {
        const events = await queryEvents(this.workspaceId, filters, limit);

        this.events = events || [];
        this.lastEventQuery = Date.now();

        // Track all loaded events in deduplication service
        this.events.forEach((event) => deduplicationService.trackEvent(event));

        this.notifyHandlers();

        logger.info('[loadEvents] Loaded events', {
          workspaceId: this.workspaceId,
          count: this.events.length,
        });

        return this.events;
      } catch (error) {
        logger.error('[loadEvents] Failed to load events:', error);
        return this.events; // Return existing events on error
      } finally {
        this.eventQueryPromise = null; // Clear the promise
      }
    })();

    return this.eventQueryPromise;
  }

  // Handle window focus to refresh events
  async handleWindowFocus() {
    logger.debug('[handleWindowFocus] Window focused, reloading events');
    await this.loadEvents();
  }

  // Cleanup
  cleanup() {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    this.eventHandlers.clear();
    this.events = [];
    this.lastEventQuery = 0;
    this.eventQueryPromise = null;
  }
}

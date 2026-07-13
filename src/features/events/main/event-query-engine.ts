/**
 * Event Query Engine
 *
 * Handles complex queries on workspace events including filtering, sorting, and aggregation.
 */

import {
  WorkspaceEvent,
  EventFilter,
  QueryOptions,
  QueryResult,
  AggregationOptions,
  AggregationResult,
} from '../types';
import { EventStore } from './event-store';
import { EventFilterEngine } from '../event-filter-engine';
import { Logger } from '../../../shared/logger';

const logger = new Logger('EventQueryEngine');

export class EventQueryEngine {
  private filterEngine: EventFilterEngine;

  constructor(private eventStore: EventStore) {
    this.filterEngine = new EventFilterEngine();
  }

  /**
   * Query events with filters
   */
  async query<T extends WorkspaceEvent = WorkspaceEvent>(filters: EventFilter[]): Promise<T[]> {
    const startTime = Date.now();

    // Get all events from store
    const allEvents = this.eventStore.getAll();

    // Apply filters
    const filteredEvents = this.filterEngine.filterEvents(allEvents, filters);

    // Sort by timestamp descending (most recent first) by default
    const sortedEvents = filteredEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const duration = Date.now() - startTime;
    logger.debug('Query completed', {
      totalEvents: allEvents.length,
      filteredEvents: sortedEvents.length,
      duration,
    });

    return sortedEvents as T[];
  }

  /**
   * Query with advanced options
   */
  async queryAdvanced<T extends WorkspaceEvent = WorkspaceEvent>(
    options: QueryOptions,
  ): Promise<QueryResult<T>> {
    const startTime = Date.now();

    // Get all events
    const allEvents = this.eventStore.getAll();

    // Apply filters
    let events = this.filterEngine.filterEvents(allEvents, options.filters);

    // Apply sorting
    if (options.sort) {
      events = this.sortEvents(events, options.sort.field, options.sort.order);
    } else {
      // Default sort by timestamp descending
      events = events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    // Calculate total before pagination
    const total = events.length;

    // Apply pagination
    if (options.offset !== undefined || options.limit !== undefined) {
      const offset = options.offset || 0;
      const limit = options.limit || events.length;
      events = events.slice(offset, offset + limit);
    }

    const duration = Date.now() - startTime;
    logger.debug('Advanced query completed', {
      total,
      returned: events.length,
      duration,
    });

    return {
      events: events as T[],
      total,
      hasMore: (options.offset || 0) + events.length < total,
    };
  }

  /**
   * Aggregate events
   */
  async aggregate(options: AggregationOptions): Promise<AggregationResult> {
    const startTime = Date.now();

    // Get all events
    const allEvents = this.eventStore.getAll();

    // Apply filters if provided
    const events = options.filters
      ? this.filterEngine.filterEvents(allEvents, options.filters)
      : allEvents;

    // Group events
    const groups = new Map<string, WorkspaceEvent[]>();

    for (const event of events) {
      const key = this.getFieldValue(event, options.groupBy);
      const groupKey = String(key || 'undefined');

      let group = groups.get(groupKey);
      if (!group) {
        group = [];
        groups.set(groupKey, group);
      }
      group.push(event);
    }

    // Calculate metrics for each group
    const result: AggregationResult = {
      groups: [],
    };

    for (const [key, groupEvents] of groups) {
      const metrics: Record<string, number> = {};

      for (const metric of options.metrics) {
        const value = this.calculateMetric(groupEvents, metric.field, metric.operation);
        metrics[metric.alias || `${metric.operation}_${metric.field}`] = value;
      }

      result.groups.push({
        key,
        metrics,
        events: groupEvents.slice(0, 10), // Include sample events
      });
    }

    // Sort groups by first metric descending
    if (options.metrics.length > 0) {
      const firstMetricKey =
        options.metrics[0].alias || `${options.metrics[0].operation}_${options.metrics[0].field}`;
      result.groups.sort(
        (a, b) => (b.metrics[firstMetricKey] || 0) - (a.metrics[firstMetricKey] || 0),
      );
    }

    const duration = Date.now() - startTime;
    logger.debug('Aggregation completed', {
      eventCount: events.length,
      groupCount: result.groups.length,
      duration,
    });

    return result;
  }

  /**
   * Get correlated events
   */
  async getCorrelated(correlationId: string): Promise<WorkspaceEvent[]> {
    const filters: EventFilter[] = [
      {
        field: 'correlationId',
        operator: 'equals',
        value: correlationId,
      },
    ];

    return this.query(filters);
  }

  /**
   * Get events by session
   */
  async getBySession(sessionId: string): Promise<WorkspaceEvent[]> {
    const filters: EventFilter[] = [
      {
        field: 'sessionId',
        operator: 'equals',
        value: sessionId,
      },
    ];

    return this.query(filters);
  }

  /**
   * Sort events
   */
  private sortEvents(
    events: WorkspaceEvent[],
    field: string,
    order: 'asc' | 'desc',
  ): WorkspaceEvent[] {
    return [...events].sort((a, b) => {
      const aValue = this.getFieldValue(a, field);
      const bValue = this.getFieldValue(b, field);

      if (aValue === bValue) return 0;
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      const comparison = aValue < bValue ? -1 : 1;
      return order === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Get nested field value
   */
  private getFieldValue(obj: any, field: string): any {
    const parts = field.split('.');
    let value = obj;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }

  /**
   * Calculate metric for a group of events
   */
  private calculateMetric(
    events: WorkspaceEvent[],
    field: string,
    operation: 'count' | 'sum' | 'avg' | 'min' | 'max',
  ): number {
    switch (operation) {
      case 'count':
        return events.length;

      case 'sum': {
        let sum = 0;
        for (const event of events) {
          const value = this.getFieldValue(event, field);
          if (typeof value === 'number') {
            sum += value;
          }
        }
        return sum;
      }

      case 'avg': {
        const sum = this.calculateMetric(events, field, 'sum');
        return events.length > 0 ? sum / events.length : 0;
      }

      case 'min': {
        let min = Infinity;
        for (const event of events) {
          const value = this.getFieldValue(event, field);
          if (typeof value === 'number' && value < min) {
            min = value;
          }
        }
        return min === Infinity ? 0 : min;
      }

      case 'max': {
        let max = -Infinity;
        for (const event of events) {
          const value = this.getFieldValue(event, field);
          if (typeof value === 'number' && value > max) {
            max = value;
          }
        }
        return max === -Infinity ? 0 : max;
      }

      default:
        return 0;
    }
  }

  /**
   * Search events by text
   */
  async search(searchTerm: string, limit: number = 50): Promise<WorkspaceEvent[]> {
    const allEvents = this.eventStore.getAll();
    const searchLower = searchTerm.toLowerCase();

    const matches = allEvents.filter((event) => {
      // Search in common fields
      if (event.type.toLowerCase().includes(searchLower)) return true;
      if (event.actor.name?.toLowerCase().includes(searchLower)) return true;

      // Search in event-specific data
      const eventStr = JSON.stringify(event).toLowerCase();
      return eventStr.includes(searchLower);
    });

    // Sort by relevance (most recent first for now)
    matches.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return matches.slice(0, limit);
  }
}

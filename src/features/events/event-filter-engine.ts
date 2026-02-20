/**
 * Event Filter Engine
 *
 * Handles filtering of workspace events based on filter criteria.
 */

import { WorkspaceEvent, EventFilter, FilterOperator } from './types';
import { Logger } from '../../shared/logger';

const logger = new Logger('EventFilterEngine');

export class EventFilterEngine {
  /**
   * Check if an event matches all filters
   */
  matches(event: WorkspaceEvent, filters: EventFilter[]): boolean {
    if (!filters || filters.length === 0) {
      return true; // No filters means match all
    }

    // All filters must match (AND logic)
    return filters.every((filter) => this.matchesFilter(event, filter));
  }

  /**
   * Check if an event matches a single filter
   */
  private matchesFilter(event: WorkspaceEvent, filter: EventFilter): boolean {
    // Validate filter
    if (!filter || !filter.field) {
      logger.warn('Invalid filter - missing field', { filter });
      return false;
    }

    // Skip meta filters
    if (filter.field.startsWith('_')) {
      return true;
    }

    const value = this.getFieldValue(event, filter.field);

    // Use 'equals' as default operator if not specified
    const operator = filter.operator || 'equals';

    if (value === undefined && operator !== 'not_equals') {
      return false;
    }

    return this.compareValues(value, filter.value, operator);
  }

  /**
   * Get nested field value from event
   */
  private getFieldValue(event: any, field: string): any {
    const parts = field.split('.');
    let value = event;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }

  /**
   * Compare values based on operator
   */
  private compareValues(actual: any, expected: any, operator: FilterOperator): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected;

      case 'not_equals':
        return actual !== expected;

      case 'greater_than':
        return this.compareGreaterThan(actual, expected);

      case 'less_than':
        return this.compareLessThan(actual, expected);

      case 'starts_with':
        return typeof actual === 'string' && actual.startsWith(expected);

      case 'ends_with':
        return typeof actual === 'string' && actual.endsWith(expected);

      case 'contains':
        return this.contains(actual, expected);

      case 'matches':
        return this.matchesPattern(actual, expected);

      case 'in':
        return Array.isArray(expected) && expected.includes(actual);

      case 'not_in':
        return Array.isArray(expected) && !expected.includes(actual);

      default:
        logger.warn('Unknown filter operator', { operator });
        return false;
    }
  }

  /**
   * Compare for greater than
   */
  private compareGreaterThan(actual: any, expected: any): boolean {
    if (typeof actual === 'number' && typeof expected === 'number') {
      return actual > expected;
    }

    if (typeof actual === 'string' && typeof expected === 'string') {
      // For dates in ISO format
      return actual > expected;
    }

    if (actual instanceof Date && expected instanceof Date) {
      return actual > expected;
    }

    // Try to convert to dates
    try {
      const actualDate = new Date(actual);
      const expectedDate = new Date(expected);
      return actualDate > expectedDate;
    } catch {
      return false;
    }
  }

  /**
   * Compare for less than
   */
  private compareLessThan(actual: any, expected: any): boolean {
    if (typeof actual === 'number' && typeof expected === 'number') {
      return actual < expected;
    }

    if (typeof actual === 'string' && typeof expected === 'string') {
      return actual < expected;
    }

    if (actual instanceof Date && expected instanceof Date) {
      return actual < expected;
    }

    // Try to convert to dates
    try {
      const actualDate = new Date(actual);
      const expectedDate = new Date(expected);
      return actualDate < expectedDate;
    } catch {
      return false;
    }
  }

  /**
   * Check if value contains expected
   */
  private contains(actual: any, expected: any): boolean {
    if (typeof actual === 'string' && typeof expected === 'string') {
      return actual.includes(expected);
    }

    if (Array.isArray(actual)) {
      return actual.includes(expected);
    }

    if (actual && typeof actual === 'object') {
      return JSON.stringify(actual).includes(String(expected));
    }

    return false;
  }

  /**
   * Check if value matches pattern
   */
  private matchesPattern(actual: any, pattern: string | RegExp): boolean {
    if (typeof actual !== 'string') {
      return false;
    }

    try {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      return regex.test(actual);
    } catch (error) {
      logger.warn('Invalid regex pattern', { pattern, error });
      return false;
    }
  }

  /**
   * Apply filters to an array of events
   */
  filterEvents(events: WorkspaceEvent[], filters: EventFilter[]): WorkspaceEvent[] {
    if (!filters || filters.length === 0) {
      return events;
    }

    // Extract limit filter if present
    const limitFilter = filters.find((f) => f.field === '_limit');
    const limit = limitFilter?.value as number | undefined;

    // Filter events
    const filteredEvents = events.filter((event) =>
      this.matches(
        event,
        filters.filter((f) => !f.field.startsWith('_')),
      ),
    );

    // Apply limit if specified
    if (limit && limit > 0) {
      return filteredEvents.slice(0, limit);
    }

    return filteredEvents;
  }
}

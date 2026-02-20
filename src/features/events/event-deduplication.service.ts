/**
 * Event Deduplication Service
 *
 * Centralized service for event deduplication across the entire system.
 * Prevents duplicate events from being processed within a configurable time window.
 */

import { Logger } from '../../shared/logger';
import type { WorkspaceEvent } from './types';
import { TRACKING_CONFIG } from '../file-tracking/tracking.config';

const logger = new Logger('EventDeduplicationService');

export interface DeduplicationConfig {
  enabled: boolean;
  windowMs: number;
  maxCacheSize: number;
  fields: string[];
}

export interface DeduplicationStats {
  totalChecked: number;
  duplicatesFound: number;
  cacheSize: number;
  lastCleanup: string;
}

export class EventDeduplicationService {
  static instance: EventDeduplicationService | null = null;

  private recentEvents: Map<string, number> = new Map();
  private bloomFilter: Set<string> = new Set(); // Fast pre-check for duplicates
  private config: DeduplicationConfig;
  private stats: DeduplicationStats;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 30000; // 30 seconds
  private readonly BLOOM_FILTER_MAX_SIZE = 10000; // Limit bloom filter size

  private constructor(config?: Partial<DeduplicationConfig>) {
    this.config = {
      enabled: config?.enabled ?? TRACKING_CONFIG.events.deduplicationEnabled,
      windowMs: config?.windowMs ?? TRACKING_CONFIG.events.deduplicationWindow,
      maxCacheSize: config?.maxCacheSize ?? TRACKING_CONFIG.events.maxDeduplicationCacheSize,
      fields: config?.fields ?? [...TRACKING_CONFIG.events.deduplicationFields],
    };

    this.stats = {
      totalChecked: 0,
      duplicatesFound: 0,
      cacheSize: 0,
      lastCleanup: new Date().toISOString(),
    };

    // Start periodic cleanup
    this.startPeriodicCleanup();

    logger.info('Event deduplication service initialized', this.config);
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<DeduplicationConfig>): EventDeduplicationService {
    if (!EventDeduplicationService.instance) {
      EventDeduplicationService.instance = new EventDeduplicationService(config);
    }
    return EventDeduplicationService.instance;
  }

  /**
   * Check if an event is a duplicate
   */
  isDuplicate(event: WorkspaceEvent): boolean {
    if (!this.config.enabled) {
      return false;
    }

    this.stats.totalChecked++;

    const key = this.getEventKey(event);

    // Fast check using bloom filter first
    if (!this.bloomFilter.has(key)) {
      // Definitely not a duplicate
      this.trackEvent(event);
      return false;
    }

    // Bloom filter says it might be a duplicate, check the actual map
    const lastSeen = this.recentEvents.get(key);

    if (!lastSeen) {
      // False positive from bloom filter - not actually a duplicate
      this.trackEvent(event);
      return false;
    }

    const timeDiff = Date.now() - lastSeen;
    const isDupe = timeDiff < this.config.windowMs;

    if (isDupe) {
      this.stats.duplicatesFound++;
      // Log at info level for agent:subscribed to debug deduplication issues
      const logLevel = event.type === 'agent:subscribed' ? 'info' : 'debug';
      logger[logLevel]('Duplicate event detected', {
        type: event.type,
        key,
        timeDiff,
        window: this.config.windowMs,
      });
    } else {
      // Update timestamp for this event
      this.trackEvent(event);
    }

    return isDupe;
  }

  /**
   * Check multiple events for duplicates
   * Returns array of non-duplicate events
   */
  filterDuplicates(events: WorkspaceEvent[]): WorkspaceEvent[] {
    if (!this.config.enabled) {
      return events;
    }

    return events.filter((event) => !this.isDuplicate(event));
  }

  /**
   * Track an event (mark as seen)
   */
  trackEvent(event: WorkspaceEvent): void {
    const key = this.getEventKey(event);
    const now = Date.now();

    // Add to both bloom filter and map
    this.bloomFilter.add(key);
    this.recentEvents.set(key, now);
    this.stats.cacheSize = this.recentEvents.size;

    // Check if cleanup is needed
    if (
      this.recentEvents.size > this.config.maxCacheSize ||
      this.bloomFilter.size > this.BLOOM_FILTER_MAX_SIZE
    ) {
      this.cleanup();
    }
  }

  /**
   * Generate a unique key for an event based on configured fields
   */
  private getEventKey(event: WorkspaceEvent): string {
    const keyParts: string[] = [];
    const fieldValues: Record<string, any> = {};

    for (const field of this.config.fields) {
      const value = this.getNestedValue(event, field);
      fieldValues[field] = value;
      if (value !== undefined && value !== null) {
        keyParts.push(String(value));
      }
    }

    // Always include event ID if no other fields match
    if (keyParts.length === 0 && event.id) {
      keyParts.push(event.id);
    }

    const key = keyParts.join('-');

    // Log key generation for agent:subscribed events to debug deduplication
    if (event.type === 'agent:subscribed') {
      logger.info('Deduplication key generated for agent:subscribed', {
        eventId: event.id,
        key,
        fieldValues,
        keyPartsCount: keyParts.length,
      });
    }

    return key;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Clean up old entries from cache
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    let removed = 0;
    const keysToRemoveFromBloom: string[] = [];

    // Remove expired entries
    for (const [key, timestamp] of this.recentEvents.entries()) {
      if (timestamp < cutoff) {
        this.recentEvents.delete(key);
        keysToRemoveFromBloom.push(key);
        removed++;
      }
    }

    // If still too large, keep only most recent half
    if (this.recentEvents.size > this.config.maxCacheSize) {
      const entries = Array.from(this.recentEvents.entries());
      entries.sort((a, b) => b[1] - a[1]);
      const toKeep = entries.slice(0, Math.floor(this.config.maxCacheSize / 2));
      const toRemove = entries.slice(Math.floor(this.config.maxCacheSize / 2));

      // Track keys being removed for bloom filter cleanup
      toRemove.forEach(([key]) => keysToRemoveFromBloom.push(key));

      const beforeSize = this.recentEvents.size;
      this.recentEvents = new Map(toKeep);
      removed += beforeSize - this.recentEvents.size;
    }

    // Clean bloom filter if it's too large or has many removed items
    if (
      this.bloomFilter.size > this.BLOOM_FILTER_MAX_SIZE ||
      keysToRemoveFromBloom.length > this.bloomFilter.size * 0.3
    ) {
      // Rebuild bloom filter from current map keys
      this.bloomFilter = new Set(this.recentEvents.keys());
      logger.debug('Rebuilt bloom filter', { size: this.bloomFilter.size });
    }

    this.stats.cacheSize = this.recentEvents.size;
    this.stats.lastCleanup = new Date().toISOString();

    if (removed > 0) {
      logger.debug('Cleaned up event cache', {
        removed,
        remaining: this.recentEvents.size,
      });
    }
  }

  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    this.stopPeriodicCleanup();

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);

    // Don't prevent process from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop periodic cleanup
   */
  private stopPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clear all cached events
   */
  clear(): void {
    this.recentEvents.clear();
    this.bloomFilter.clear();
    this.stats.cacheSize = 0;
    logger.debug('Event cache cleared');
  }

  /**
   * Get current statistics
   */
  getStats(): DeduplicationStats {
    return { ...this.stats };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DeduplicationConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };

    logger.info('Deduplication config updated', this.config);
  }

  /**
   * Destroy the service
   */
  destroy(): void {
    this.stopPeriodicCleanup();
    this.clear();
    EventDeduplicationService.instance = null;
    logger.info('Event deduplication service destroyed');
  }
}

// Export singleton getter
export function getDeduplicationService(
  config?: Partial<DeduplicationConfig>,
): EventDeduplicationService {
  return EventDeduplicationService.getInstance(config);
}

// Export for testing
export function resetDeduplicationService(): void {
  const instance = EventDeduplicationService.instance;
  if (instance) {
    instance.destroy();
  }
}

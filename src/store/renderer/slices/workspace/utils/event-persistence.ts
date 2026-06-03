/**
 * Event Persistence Service
 * Handles saving and loading workspace events to/from storage
 */

import type { WorkspaceEvent } from '$features/events/types';
import { browser } from '$app/environment';
import { Logger } from '$shared/logger';

const logger = new Logger('EventPersistence');
const STORAGE_PREFIX = 'workspace-events-';
const MAX_STORED_EVENTS = 500;
const STORAGE_VERSION = 1;

interface StoredEventData {
  version: number;
  events: WorkspaceEvent[];
  lastUpdated: string;
}

export class EventPersistenceService {
  private workspaceId: string;
  private storageKey: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    this.storageKey = `${STORAGE_PREFIX}${workspaceId}`;
  }

  /**
   * Save events to storage
   */
  async saveEvents(events: WorkspaceEvent[]): Promise<void> {
    if (!browser) return;

    try {
      // Limit the number of events to store
      const eventsToStore = events.slice(0, MAX_STORED_EVENTS);

      const data: StoredEventData = {
        version: STORAGE_VERSION,
        events: eventsToStore,
        lastUpdated: new Date().toISOString(),
      };

      // Try localStorage first
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      } catch {
        // If localStorage fails (quota exceeded), try to clean up old data
        this.cleanupOldEvents();
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (error) {
      logger.error('[EventPersistence] Failed to save events:', error as Error);
    }
  }

  /**
   * Load events from storage
   */
  async loadEvents(): Promise<WorkspaceEvent[]> {
    if (!browser) return [];

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return [];

      const data: StoredEventData = JSON.parse(stored);

      // Check version compatibility
      if (data.version !== STORAGE_VERSION) {
        logger.warn('[EventPersistence] Storage version mismatch, clearing old data');
        this.clearEvents();
        return [];
      }

      // Validate and return events
      if (Array.isArray(data.events)) {
        return data.events;
      }
    } catch (error) {
      logger.error('[EventPersistence] Failed to load events:', error as Error);
      // Clear corrupted data
      this.clearEvents();
    }

    return [];
  }

  /**
   * Clear stored events
   */
  clearEvents(): void {
    if (!browser) return;

    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      logger.error('[EventPersistence] Failed to clear events:', error as Error);
    }
  }

  /**
   * Clean up old events from all workspaces
   */
  private cleanupOldEvents(): void {
    if (!browser) return;

    try {
      const keys = Object.keys(localStorage);
      const eventKeys = keys.filter((key) => key.startsWith(STORAGE_PREFIX));

      // Sort by last updated and remove oldest
      const entries: Array<{ key: string; lastUpdated: string }> = [];

      for (const key of eventKeys) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          if (data.lastUpdated) {
            entries.push({ key, lastUpdated: data.lastUpdated });
          }
        } catch {
          // Remove corrupted entries
          localStorage.removeItem(key);
        }
      }

      // Sort by date and keep only recent ones
      entries.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());

      // Remove oldest entries if we have too many
      if (entries.length > 10) {
        for (let i = 10; i < entries.length; i++) {
          localStorage.removeItem(entries[i].key);
        }
      }
    } catch (error) {
      logger.error('[EventPersistence] Failed to cleanup old events:', error as Error);
    }
  }

  /**
   * Get storage size info
   */
  getStorageInfo(): { used: number; available: number } | null {
    if (!browser) return null;

    try {
      const stored = localStorage.getItem(this.storageKey);
      const used = stored ? new Blob([stored]).size : 0;

      // Estimate available space (localStorage typically has 5-10MB limit)
      const estimatedTotal = 5 * 1024 * 1024; // 5MB
      const available = estimatedTotal - used;

      return { used, available };
    } catch {
      return null;
    }
  }
}

/**
 * Export events to JSON file
 */
export function exportEventsToFile(events: WorkspaceEvent[], workspaceId: string): void {
  if (!browser) return;

  try {
    const data = {
      workspaceId,
      exportDate: new Date().toISOString(),
      eventCount: events.length,
      events,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workspace-events-${workspaceId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    logger.error('[EventPersistence] Failed to export events:', error as Error);
  }
}

/**
 * Import events from JSON file
 */
export async function importEventsFromFile(file: File): Promise<WorkspaceEvent[]> {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (Array.isArray(data.events)) {
      return data.events;
    }

    throw new Error('Invalid event file format');
  } catch (error) {
    logger.error('[EventPersistence] Failed to import events:', error as Error);
    throw error;
  }
}

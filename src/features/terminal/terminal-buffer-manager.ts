/**
 * Terminal Buffer Manager
 *
 * Handles terminal buffer persistence and restoration
 * with proper error handling and size limits
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('TerminalBufferManager');

interface BufferSnapshot {
  lines: string[];
  cursorX: number;
  cursorY: number;
  timestamp: number;
  version: number;
}

// PERF: Index key for fast terminal buffer key lookups
// Instead of iterating all localStorage keys, we maintain an index
const TERMINAL_BUFFER_INDEX_KEY = 'terminal-buffer-index';

interface BufferIndexEntry {
  key: string;
  timestamp: number;
}

// PERF: Cache for buffer index to avoid repeated localStorage reads
let bufferIndexCache: Map<string, number> | null = null;
let bufferIndexCacheTime = 0;
const BUFFER_INDEX_CACHE_TTL = 5000; // 5 seconds

/**
 * Get the buffer index from localStorage or cache
 * PERF: Caches the index to avoid repeated JSON parsing
 */
function getBufferIndex(): Map<string, number> {
  const now = Date.now();
  if (bufferIndexCache && now - bufferIndexCacheTime < BUFFER_INDEX_CACHE_TTL) {
    return bufferIndexCache;
  }

  try {
    const stored = localStorage.getItem(TERMINAL_BUFFER_INDEX_KEY);
    if (stored) {
      const entries = JSON.parse(stored) as BufferIndexEntry[];
      bufferIndexCache = new Map(entries.map((e) => [e.key, e.timestamp]));
    } else {
      bufferIndexCache = new Map();
    }
  } catch {
    bufferIndexCache = new Map();
  }

  bufferIndexCacheTime = now;
  return bufferIndexCache;
}

/**
 * Save the buffer index to localStorage
 */
function saveBufferIndex(index: Map<string, number>): void {
  try {
    const entries: BufferIndexEntry[] = Array.from(index.entries()).map(([key, timestamp]) => ({
      key,
      timestamp,
    }));
    localStorage.setItem(TERMINAL_BUFFER_INDEX_KEY, JSON.stringify(entries));
    bufferIndexCache = index;
    bufferIndexCacheTime = Date.now();
  } catch  {
    // Ignore - best effort
  }
}

/**
 * Add a key to the buffer index
 */
function addToBufferIndex(key: string, timestamp: number): void {
  const index = getBufferIndex();
  index.set(key, timestamp);
  saveBufferIndex(index);
}

/**
 * Remove a key from the buffer index
 */
function removeFromBufferIndex(key: string): void {
  const index = getBufferIndex();
  index.delete(key);
  saveBufferIndex(index);
}

export class TerminalBufferManager {
  private static readonly BUFFER_VERSION = 1;
  private static readonly MAX_BUFFER_SIZE = 10000; // lines
  private static readonly MAX_LINE_LENGTH = 1000; // characters
  private static readonly RETENTION_PERIOD = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly STORAGE_QUOTA_BUFFER = 100 * 1024; // 100KB safety buffer

  private storageKey: string;
  private fallbackStorage = new Map<string, BufferSnapshot>();

  constructor(
    private workspaceId: string,
    private terminalId: string,
  ) {
    this.storageKey = `terminal-buffer-${workspaceId}-${terminalId}`;
  }

  /**
   * Save buffer snapshot with error handling and size limits
   */
  async saveBuffer(lines: string[], cursorX: number, cursorY: number): Promise<boolean> {
    try {
      // Trim lines to max buffer size
      const trimmedLines = this.trimBuffer(lines);

      // Create snapshot
      const snapshot: BufferSnapshot = {
        lines: trimmedLines,
        cursorX,
        cursorY,
        timestamp: Date.now(),
        version: TerminalBufferManager.BUFFER_VERSION,
      };

      // Check storage quota before saving
      if (await this.hasStorageSpace(snapshot)) {
        try {
          localStorage.setItem(this.storageKey, JSON.stringify(snapshot));
          // PERF: Register in index for fast cleanup lookups
          addToBufferIndex(this.storageKey, snapshot.timestamp);
          logger.debug(`Saved buffer for terminal ${this.terminalId}`);
          return true;
        } catch (error) {
          // Fall back to in-memory storage
          logger.warn('localStorage failed, using fallback storage:', error);
          this.fallbackStorage.set(this.storageKey, snapshot);
          return true;
        }
      } else {
        // Storage quota exceeded, try to clean up old buffers
        await this.cleanupOldBuffers();

        // Try one more time
        try {
          localStorage.setItem(this.storageKey, JSON.stringify(snapshot));
          // PERF: Register in index for fast cleanup lookups
          addToBufferIndex(this.storageKey, snapshot.timestamp);
          return true;
        } catch {
          // Use fallback storage
          this.fallbackStorage.set(this.storageKey, snapshot);
          return true;
        }
      }
    } catch (error) {
      logger.error('Failed to save buffer:', error);
      return false;
    }
  }

  /**
   * Restore buffer snapshot with validation
   */
  async restoreBuffer(): Promise<BufferSnapshot | null> {
    try {
      // Try localStorage first
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const snapshot = JSON.parse(stored) as BufferSnapshot;

        // Validate snapshot
        if (this.isValidSnapshot(snapshot)) {
          logger.debug(`Restored buffer for terminal ${this.terminalId}`);
          return snapshot;
        } else {
          // Invalid snapshot, remove it
          localStorage.removeItem(this.storageKey);
        }
      }

      // Try fallback storage
      const fallback = this.fallbackStorage.get(this.storageKey);
      if (fallback && this.isValidSnapshot(fallback)) {
        return fallback;
      }

      return null;
    } catch (error) {
      logger.error('Failed to restore buffer:', error);
      return null;
    }
  }

  /**
   * Clear buffer for this terminal
   */
  async clearBuffer(): Promise<void> {
    try {
      localStorage.removeItem(this.storageKey);
      this.fallbackStorage.delete(this.storageKey);
      // PERF: Remove from index
      removeFromBufferIndex(this.storageKey);
    } catch (error) {
      logger.error('Failed to clear buffer:', error);
    }
  }

  /**
   * Trim buffer to size limits
   */
  private trimBuffer(lines: string[]): string[] {
    // Remove trailing empty lines
    while (lines.length > 0 && !lines[lines.length - 1].trim()) {
      lines.pop();
    }

    // Limit total lines
    if (lines.length > TerminalBufferManager.MAX_BUFFER_SIZE) {
      lines = lines.slice(-TerminalBufferManager.MAX_BUFFER_SIZE);
    }

    // Limit line length
    return lines.map((line) =>
      line.length > TerminalBufferManager.MAX_LINE_LENGTH
        ? `${line.substring(0, TerminalBufferManager.MAX_LINE_LENGTH)}…`
        : line,
    );
  }

  /**
   * Check if snapshot is valid
   */
  private isValidSnapshot(snapshot: BufferSnapshot): boolean {
    // Check version
    if (snapshot.version !== TerminalBufferManager.BUFFER_VERSION) {
      return false;
    }

    // Check age
    if (Date.now() - snapshot.timestamp > TerminalBufferManager.RETENTION_PERIOD) {
      return false;
    }

    // Check structure
    if (!Array.isArray(snapshot.lines)) {
      return false;
    }

    return true;
  }

  /**
   * Check available storage space
   */
  private async hasStorageSpace(snapshot: BufferSnapshot): Promise<boolean> {
    try {
      const size = JSON.stringify(snapshot).length;

      // Check if navigator.storage.estimate is available
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const available = (estimate.quota || 0) - (estimate.usage || 0);
        return available > size + TerminalBufferManager.STORAGE_QUOTA_BUFFER;
      }

      // Fallback: assume we have space
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Clean up old buffers from all terminals
   * PERF: Uses indexed lookups instead of iterating all localStorage keys
   */
  private async cleanupOldBuffers(): Promise<void> {
    try {
      const keysToRemove: string[] = [];
      const now = Date.now();

      // PERF: Use the buffer index for O(n) where n = terminal buffers, not all localStorage keys
      const index = getBufferIndex();

      for (const [key, timestamp] of index) {
        // Quick timestamp check from index (avoids JSON parsing for most entries)
        if (now - timestamp > TerminalBufferManager.RETENTION_PERIOD) {
          keysToRemove.push(key);
        }
      }

      // Remove old buffers and update index
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
        removeFromBufferIndex(key);
        logger.debug(`Cleaned up old buffer: ${key}`);
      }

      // If index is empty or stale, do a one-time rebuild from localStorage
      // This handles legacy buffers that weren't indexed
      if (index.size === 0) {
        await this.rebuildBufferIndex();
      }
    } catch (error) {
      logger.error('Failed to cleanup old buffers:', error);
    }
  }

  /**
   * Rebuild the buffer index from localStorage (one-time migration)
   * PERF: Only called when index is empty, to handle pre-existing buffers
   */
  private async rebuildBufferIndex(): Promise<void> {
    try {
      const newIndex = new Map<string, number>();

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('terminal-buffer-') && key !== TERMINAL_BUFFER_INDEX_KEY) {
          try {
            const stored = localStorage.getItem(key);
            if (stored) {
              const snapshot = JSON.parse(stored) as BufferSnapshot;
              newIndex.set(key, snapshot.timestamp);
            }
          } catch {
            // Invalid data, skip it
          }
        }
      }

      if (newIndex.size > 0) {
        saveBufferIndex(newIndex);
        logger.debug(`Rebuilt buffer index with ${newIndex.size} entries`);
      }
    } catch (error) {
      logger.error('Failed to rebuild buffer index:', error);
    }
  }

  /**
   * Get buffer statistics
   */
  getStats(): { size: number; lineCount: number; age: number } | null {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const snapshot = JSON.parse(stored) as BufferSnapshot;
        return {
          size: stored.length,
          lineCount: snapshot.lines.length,
          age: Date.now() - snapshot.timestamp,
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}

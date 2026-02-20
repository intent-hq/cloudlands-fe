import { Logger } from '../../shared/logger';

const logger = new Logger('GitCache');

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// PERF: Limit cache size to prevent unbounded growth
const MAX_CACHE_ENTRIES = 100;

/**
 * Simple in-memory cache for git operations
 * Reduces redundant git operations during startup
 */
export class GitCache {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly DEFAULT_TTL = 5000; // 5 seconds default TTL

  /**
   * Get cached data if still valid
   */
  get<T>(key: string, ttl: number = this.DEFAULT_TTL): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > ttl) {
      // Cache expired
      this.cache.delete(key);
      return null;
    }

    logger.debug(`Cache hit for ${key} (age: ${age}ms)`);
    return entry.data as T;
  }

  /**
   * Set cache data
   */
  set<T>(key: string, data: T): void {
    // PERF: Enforce max entries limit to prevent unbounded growth
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      // Remove oldest entry
      const oldestKey = this.findOldestEntry();
      if (oldestKey) {
        this.cache.delete(oldestKey);
        logger.debug(`Cache evicted oldest entry: ${oldestKey}`);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
    logger.debug(`Cache set for ${key}`);
  }

  /**
   * Find the oldest cache entry
   */
  private findOldestEntry(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Get the age of cached data in milliseconds
   */
  getAge(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }
    return Date.now() - entry.timestamp;
  }

  /**
   * Clear specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    logger.debug(`Cache invalidated for ${key}`);
  }

  /**
   * Clear all cache entries for a workspace
   */
  invalidateWorkspace(workspaceId: string): void {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      // Check if key contains the workspaceId to handle various cache key formats:
      // - "git-status-${workspaceId}"
      // - "workspace:${workspaceId}:operation"
      if (key.includes(workspaceId)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
    logger.debug(`Cache invalidated for workspace ${workspaceId} (${keysToDelete.length} entries)`);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.debug(`Cache cleared (${size} entries)`);
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
export const gitCache = new GitCache();

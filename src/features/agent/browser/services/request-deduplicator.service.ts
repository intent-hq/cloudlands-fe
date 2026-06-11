/**
 * Request Deduplicator Service
 *
 * Prevents duplicate concurrent requests by tracking pending operations
 * and returning existing promises for identical requests.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('RequestDeduplicator');

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
  key: string;
}

// Track keys that have been cleared to prevent re-caching from in-flight requests
// Keys are removed after a short delay to avoid memory leaks
const CLEARED_KEY_EXPIRY_MS = 10000; // 10 seconds

interface DeduplicationOptions {
  ttl?: number; // Time to live for cached results (ms)
  keyGenerator?: (...args: any[]) => string;
}

export class RequestDeduplicator {
  private static instance: RequestDeduplicator;
  private pendingRequests = new Map<string, PendingRequest<any>>();
  private completedRequests = new Map<string, { result: any; timestamp: number }>();
  // Track cleared keys to prevent re-caching from in-flight requests after stop/interrupt
  private clearedKeys = new Map<string, number>(); // key -> timestamp when cleared
  private readonly DEFAULT_TTL = 5000; // 5 seconds
  private readonly MAX_CACHE_SIZE = 100;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.startCleanupInterval();
  }

  static getInstance(): RequestDeduplicator {
    if (!RequestDeduplicator.instance) {
      RequestDeduplicator.instance = new RequestDeduplicator();
    }
    return RequestDeduplicator.instance;
  }

  /**
   * Execute a request with deduplication
   */
  async deduplicate<T>(
    key: string,
    operation: () => Promise<T>,
    options: DeduplicationOptions = {},
  ): Promise<T> {
    const ttl = options.ttl ?? this.DEFAULT_TTL;

    // Check for pending request
    const pending = this.pendingRequests.get(key);
    if (pending) {
      logger.debug(`Deduplicating request: ${key} (returning pending promise)`);
      return pending.promise;
    }

    // Check for recently completed request (within TTL)
    const completed = this.completedRequests.get(key);
    if (completed && Date.now() - completed.timestamp < ttl) {
      logger.debug(`Deduplicating request: ${key} (returning cached result)`);
      return completed.result;
    }

    // Create new request
    logger.debug(`Starting new request: ${key}`);
    const promise = this.executeRequest(key, operation);

    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now(),
      key,
    });

    return promise;
  }

  /**
   * Check if a key was recently cleared (to prevent re-caching from in-flight requests)
   */
  private wasRecentlyCleared(key: string): boolean {
    const clearedTime = this.clearedKeys.get(key);
    if (!clearedTime) return false;

    const now = Date.now();
    if (now - clearedTime < CLEARED_KEY_EXPIRY_MS) {
      return true;
    }

    // Expired, clean it up
    this.clearedKeys.delete(key);
    return false;
  }

  /**
   * Execute the actual request
   */
  private async executeRequest<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation();

      // Move from pending to completed
      this.pendingRequests.delete(key);

      // Only cache if the key wasn't cleared while the request was in-flight
      // This prevents stale results from being cached after stop/interrupt
      if (!this.wasRecentlyCleared(key)) {
        // Cache the result
        this.completedRequests.set(key, {
          result,
          timestamp: Date.now(),
        });

        // Enforce cache size limit
        this.enforceCacheLimit();
      } else {
        logger.debug(`Skipping cache for cleared key: ${key}`);
      }

      logger.debug(`Request completed: ${key}`);
      return result;
    } catch (error) {
      // Remove from pending on error
      this.pendingRequests.delete(key);
      logger.error(`Request failed: ${key}`, error);
      throw error;
    }
  }

  /**
   * Generate a key for agent creation requests
   */
  static generateAgentCreationKey(workspaceId: string, options: any): string {
    const parts = [
      'agent-create',
      workspaceId,
      options.name || '',
      options.model || '',
      options.systemPrompt || '',
      options.agentType || '',
      options.instruction || '',
    ];
    return parts.join(':');
  }

  /**
   * Generate a key for message sending requests
   */
  static generateMessageKey(agentId: string, content: string, contextReferences?: any[]): string {
    const contextHash = contextReferences
      ? JSON.stringify(contextReferences).substring(0, 100)
      : '';
    return `message:${agentId}:${content.substring(0, 100)}:${contextHash}`;
  }

  /**
   * Generate a key for session operations
   */
  static generateSessionKey(operation: string, agentId: string, workspaceId: string): string {
    return `session:${operation}:${workspaceId}:${agentId}`;
  }

  /**
   * Clear a specific key from cache
   */
  clearKey(key: string): void {
    this.pendingRequests.delete(key);
    this.completedRequests.delete(key);
    logger.debug(`Cleared cache for key: ${key}`);
  }

  /**
   * Clear all cached requests for a specific agent
   * This should be called when stopping/interrupting an agent to ensure
   * subsequent messages are not deduplicated against the interrupted request.
   */
  clearKeysForAgent(agentId: string): void {
    let clearedCount = 0;
    const now = Date.now();

    // Clear from pending requests and track cleared keys
    for (const key of this.pendingRequests.keys()) {
      if (key.includes(agentId)) {
        this.pendingRequests.delete(key);
        // Track this key as cleared to prevent re-caching from in-flight requests
        this.clearedKeys.set(key, now);
        clearedCount++;
      }
    }

    // Clear from completed requests
    for (const key of this.completedRequests.keys()) {
      if (key.includes(agentId)) {
        this.completedRequests.delete(key);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      logger.info(`Cleared ${clearedCount} cached requests for agent: ${agentId}`);
    }
  }

  /**
   * Clear all cached requests
   */
  clearAll(): void {
    const pendingCount = this.pendingRequests.size;
    const completedCount = this.completedRequests.size;

    this.pendingRequests.clear();
    this.completedRequests.clear();
    this.clearedKeys.clear();

    logger.info(
      `Cleared all cached requests (pending: ${pendingCount}, completed: ${completedCount})`,
    );
  }

  /**
   * Enforce cache size limit
   */
  private enforceCacheLimit(): void {
    if (this.completedRequests.size > this.MAX_CACHE_SIZE) {
      // Remove oldest entries
      const sortedEntries = Array.from(this.completedRequests.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      );

      const toRemove = sortedEntries.slice(0, sortedEntries.length - this.MAX_CACHE_SIZE);
      for (const [key] of toRemove) {
        this.completedRequests.delete(key);
      }

      logger.debug(`Enforced cache limit, removed ${toRemove.length} entries`);
    }
  }

  /**
   * Start cleanup interval for expired entries
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000); // Run every minute
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let removedCount = 0;

    // Clean up old pending requests (stuck for more than 5 minutes)
    for (const [key, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > 300000) {
        // 5 minutes
        this.pendingRequests.delete(key);
        removedCount++;
        logger.warn(`Removed stuck pending request: ${key}`);
      }
    }

    // Clean up expired completed requests
    for (const [key, entry] of this.completedRequests.entries()) {
      if (now - entry.timestamp > this.DEFAULT_TTL * 2) {
        this.completedRequests.delete(key);
        removedCount++;
      }
    }

    // Clean up expired cleared keys
    for (const [key, timestamp] of this.clearedKeys.entries()) {
      if (now - timestamp > CLEARED_KEY_EXPIRY_MS) {
        this.clearedKeys.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.debug(`Cleanup removed ${removedCount} expired entries`);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    pendingCount: number;
    completedCount: number;
    totalSize: number;
  } {
    return {
      pendingCount: this.pendingRequests.size,
      completedCount: this.completedRequests.size,
      totalSize: this.pendingRequests.size + this.completedRequests.size,
    };
  }

  /**
   * Dispose of the service
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearAll();
  }
}

// Export singleton instance
export const requestDeduplicator = RequestDeduplicator.getInstance();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    requestDeduplicator.dispose();
  });
}

// Export static key generators for convenience
export const { generateAgentCreationKey, generateMessageKey, generateSessionKey } =
  RequestDeduplicator;

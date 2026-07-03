/**
 * Request Deduplicator Service
 *
 * Collapses multiple concurrent identical requests into a single in-flight
 * operation by returning the shared pending promise. Once that promise has
 * resolved (or rejected) the entry is dropped, so a subsequent call with the
 * same key issues a fresh request — completed results are NOT cached. Caching
 * resolved BE responses would hide BE state changes/errors; latency hiding
 * belongs in the BE, not in this client-side wrapper.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('RequestDeduplicator');

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
  key: string;
}

interface DeduplicationOptions {
  keyGenerator?: (...args: any[]) => string;
}

export class RequestDeduplicator {
  private static instance: RequestDeduplicator;
  private pendingRequests = new Map<string, PendingRequest<any>>();
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
   * Execute a request with in-flight deduplication. Concurrent callers with the
   * same key share the same pending promise; a call made after the prior one
   * resolved issues a fresh request.
   */
  async deduplicate<T>(
    key: string,
    operation: () => Promise<T>,
    _options: DeduplicationOptions = {},
  ): Promise<T> {
    const pending = this.pendingRequests.get(key);
    if (pending) {
      logger.debug(`Deduplicating request: ${key} (returning pending promise)`);
      return pending.promise;
    }

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
   * Execute the actual request and drop the pending entry when it settles.
   */
  private async executeRequest<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation();
      this.pendingRequests.delete(key);
      logger.debug(`Request completed: ${key}`);
      return result;
    } catch (error) {
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
   * Clear a specific in-flight key
   */
  clearKey(key: string): void {
    this.pendingRequests.delete(key);
    logger.debug(`Cleared pending request for key: ${key}`);
  }

  /**
   * Clear all in-flight requests for a specific agent.
   * Should be called when stopping/interrupting an agent so a subsequent
   * message is not deduplicated against the interrupted request.
   */
  clearKeysForAgent(agentId: string): void {
    let clearedCount = 0;
    for (const key of this.pendingRequests.keys()) {
      if (key.includes(agentId)) {
        this.pendingRequests.delete(key);
        clearedCount++;
      }
    }
    if (clearedCount > 0) {
      logger.info(`Cleared ${clearedCount} pending requests for agent: ${agentId}`);
    }
  }

  /**
   * Clear all in-flight requests
   */
  clearAll(): void {
    const pendingCount = this.pendingRequests.size;
    this.pendingRequests.clear();
    logger.info(`Cleared all pending requests (pending: ${pendingCount})`);
  }

  /**
   * Start cleanup interval for stuck pending requests
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStuckPending();
    }, 60000); // Run every minute
  }

  /**
   * Drop pending entries that have been in-flight for more than 5 minutes.
   * Defensive: real operations should always settle and clear themselves.
   */
  private cleanupStuckPending(): void {
    const now = Date.now();
    let removedCount = 0;
    for (const [key, request] of this.pendingRequests.entries()) {
      if (now - request.timestamp > 300000) {
        this.pendingRequests.delete(key);
        removedCount++;
        logger.warn(`Removed stuck pending request: ${key}`);
      }
    }
    if (removedCount > 0) {
      logger.debug(`Cleanup removed ${removedCount} stuck pending entries`);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    pendingCount: number;
  } {
    return {
      pendingCount: this.pendingRequests.size,
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

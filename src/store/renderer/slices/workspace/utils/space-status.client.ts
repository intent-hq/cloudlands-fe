/**
 * Space Status Client
 *
 * Client-side service for fetching and caching workspace status summaries.
 * Used for hover cards to show live observability of other workspaces.
 *
 * Features:
 * - TTL-based caching with LRU eviction
 * - Request deduplication for concurrent fetches
 * - Event-based cache invalidation for real-time updates
 */

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { invoke } from '$shared/generated/ipc-client';
import type { WorkspaceId } from '$shared/types/branded-ids';
import {
  type SpaceLiveStatus,
  type CachedSpaceStatus,
  type SpaceStatusCacheConfig,
  DEFAULT_CACHE_CONFIG,
} from './space-status.types';

interface IPCResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Client for fetching workspace status summaries with caching.
 * Singleton instance for efficient cache sharing across components.
 */
class SpaceStatusClient {
  private static instance: SpaceStatusClient;
  private cache = new Map<string, CachedSpaceStatus>();
  private pendingRequests = new Map<string, {
    promise: Promise<SpaceLiveStatus | null>;
    version: number;
  }>();
  private invalidationVersions = new Map<string, number>();
  private pendingInvalidations = new Set<string>();
  private invalidationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private config: SpaceStatusCacheConfig;
  private listenerIds: Array<{ channel: string; id: string }> = [];
  private isSubscribed = false;

  private constructor(config: SpaceStatusCacheConfig = DEFAULT_CACHE_CONFIG) {
    this.config = config;
  }

  static getInstance(): SpaceStatusClient {
    if (!SpaceStatusClient.instance) {
      SpaceStatusClient.instance = new SpaceStatusClient();
    }
    return SpaceStatusClient.instance;
  }

  /**
   * Initialize event subscriptions for cache invalidation.
   * Call this once when the app starts to enable real-time cache updates.
   */
  initializeEventSubscriptions(): void {
    if (this.isSubscribed) return;
    if (typeof window === 'undefined' || !window.electronAPI) return;

    // Helper to subscribe and track listener
    const subscribe = (channel: string, handler: (data: { workspaceId?: string }) => void) => {
      const id = window.electronAPI.on(channel, handler);
      this.listenerIds.push({ channel, id });
    };

    // Subscribe to note events (task status changes)
    subscribe('note:updated', (data) => {
      if (data.workspaceId) {
        this.invalidate(data.workspaceId as WorkspaceId);
      }
    });

    subscribe('note:created', (data) => {
      if (data.workspaceId) {
        this.invalidate(data.workspaceId as WorkspaceId);
      }
    });

    subscribe('note:deleted', (data) => {
      if (data.workspaceId) {
        this.invalidate(data.workspaceId as WorkspaceId);
      }
    });

    // Subscribe to file tracking events (file changes)
    subscribe('file-tracking:changes-updated', (data) => {
      if (data.workspaceId) {
        this.invalidate(data.workspaceId as WorkspaceId);
      }
    });

    // Subscribe to workspace-changes as backup
    subscribe('workspace-changes', (data) => {
      if (data.workspaceId) {
        this.invalidate(data.workspaceId as WorkspaceId);
      }
    });

    this.isSubscribed = true;
  }

  /**
   * Cleanup event subscriptions.
   * Call this when the app is shutting down.
   */
  cleanup(): void {
    if (typeof window !== 'undefined' && window.electronAPI) {
      for (const { channel, id } of this.listenerIds) {
        window.electronAPI.offById(channel, id);
      }
    }
    this.listenerIds = [];
    this.isSubscribed = false;
    this.clearInvalidationFlushTimer();
    this.pendingInvalidations.clear();
  }

  /**
   * Get the status for a workspace, using cache if available and fresh.
   * Deduplicates concurrent requests for the same workspace.
   */
  async getStatus(workspaceId: WorkspaceId): Promise<SpaceLiveStatus | null> {
    const cacheKey = workspaceId;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached) && !this.pendingInvalidations.has(cacheKey)) {
      return cached.status;
    }

    // Check for pending request to avoid duplicate fetches
    const currentVersion = this.getInvalidationVersion(cacheKey);
    const pending = this.pendingRequests.get(cacheKey);
    if (pending && pending.version === currentVersion) {
      return pending.promise;
    }

    // Fetch fresh data
    const fetchPromise = this.fetchStatus(workspaceId, currentVersion);
    this.pendingRequests.set(cacheKey, { promise: fetchPromise, version: currentVersion });

    try {
      const status = await fetchPromise;
      return status;
    } finally {
      if (this.pendingRequests.get(cacheKey)?.promise === fetchPromise) {
        this.pendingRequests.delete(cacheKey);
      }
    }
  }

  /**
   * Invalidate cache for a specific workspace.
   * Called when we know the workspace data has changed.
   */
  invalidate(workspaceId: WorkspaceId): void {
    const cacheKey = workspaceId;
    this.invalidationVersions.set(cacheKey, this.getInvalidationVersion(cacheKey) + 1);
    this.pendingInvalidations.add(cacheKey);
    this.scheduleInvalidationFlush();
  }

  /**
   * Invalidate all cached statuses.
   */
  invalidateAll(): void {
    this.clearInvalidationFlushTimer();
    this.pendingInvalidations.clear();
    for (const workspaceId of this.cache.keys()) {
      this.invalidationVersions.set(workspaceId, this.getInvalidationVersion(workspaceId) + 1);
    }
    this.cache.clear();
  }

  /**
   * Get cached status without fetching (for synchronous access).
   */
  getCached(workspaceId: WorkspaceId): SpaceLiveStatus | null {
    const cached = this.cache.get(workspaceId);
    if (cached && this.isCacheValid(cached) && !this.pendingInvalidations.has(workspaceId)) {
      return cached.status;
    }
    return null;
  }

  private getInvalidationVersion(workspaceId: string): number {
    return this.invalidationVersions.get(workspaceId) ?? 0;
  }

  private scheduleInvalidationFlush(): void {
    if (this.invalidationFlushTimer) return;
    this.invalidationFlushTimer = setTimeout(() => {
      this.invalidationFlushTimer = null;
      this.flushPendingInvalidations();
    }, 0);
  }

  private clearInvalidationFlushTimer(): void {
    if (!this.invalidationFlushTimer) return;
    clearTimeout(this.invalidationFlushTimer);
    this.invalidationFlushTimer = null;
  }

  private flushPendingInvalidations(): void {
    for (const workspaceId of this.pendingInvalidations) {
      this.cache.delete(workspaceId);
    }
    this.pendingInvalidations.clear();
  }

  private isCacheValid(cached: CachedSpaceStatus): boolean {
    return Date.now() - cached.fetchedAt < this.config.ttlMs;
  }

  private async fetchStatus(
    workspaceId: WorkspaceId,
    invalidationVersion: number,
  ): Promise<SpaceLiveStatus | null> {
    if (typeof window === 'undefined' || !window.electronAPI) {
      return null;
    }

    try {
      const response = await invoke<IPCResponse<SpaceLiveStatus>>(
        IPC_CHANNELS.WORKSPACE.GET_HOVER_STATUS,
        { workspaceId },
      );

      if (!response.ok || !response.data) {
        return null;
      }

      // Update cache only if no newer invalidation arrived while the request was in flight.
      if (this.getInvalidationVersion(workspaceId) === invalidationVersion) {
        this.pendingInvalidations.delete(workspaceId);
        this.cache.set(workspaceId, {
          status: response.data,
          fetchedAt: Date.now(),
        });
      }

      // Enforce max cache size (LRU-like: remove oldest entries)
      this.enforceMaxCacheSize();

      return response.data;
    } catch {
      return null;
    }
  }

  private enforceMaxCacheSize(): void {
    if (this.cache.size <= this.config.maxEntries) return;

    // Remove oldest entries until we're under the limit
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);

    const toRemove = entries.slice(0, entries.length - this.config.maxEntries);
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }
  }
}

// Export singleton instance
export const spaceStatusClient = SpaceStatusClient.getInstance();

// Export class for testing
export { SpaceStatusClient };

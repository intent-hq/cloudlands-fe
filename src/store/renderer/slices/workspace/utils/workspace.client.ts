/**
 * Workspace IPC Client
 *
 * Client-side wrapper for workspace IPC communication.
 * Used by renderer process to communicate with main process.
 */

import type {
  Workspace,
  WorkspaceId,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  Result,
  WorkspaceDiffSummary,
  WorkspaceGitSummary,
  WorkspaceTask,
} from '$shared/types';
import { Logger } from '$shared/logger';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { invoke as invokeIpc } from '$shared/generated/ipc-client';
import { appClient } from '$lib/client';

const logger = new Logger('WorkspaceClient');
const WORKSPACE_CLIENT_CACHE_MAX_ENTRIES = 100;

/**
 * Normalize workspace path fields to use forward slashes.
 * This ensures consistent path separators regardless of OS,
 * since the main process may return Windows-style backslashes.
 */
export function normalizeWorkspacePaths(ws: Workspace): Workspace {
  return {
    ...ws,
    path: ws.path?.replaceAll('\\', '/'),
    repositoryPath: ws.repositoryPath?.replaceAll('\\', '/'),
    worktreePath: ws.worktreePath?.replaceAll('\\', '/'),
  };
}

/**
 * Client for workspace IPC communication between renderer and main process.
 * Provides caching, request deduplication, and error handling.
 *
 * @example
 * ```typescript
 * const workspace = await workspaceClient.getWorkspace('workspace-123');
 * if (workspace.ok) {
 *   console.log(workspace.data.name);
 * }
 * ```
 */
export class WorkspaceClient {
  // Request deduplication - prevent duplicate concurrent requests
  private pendingRequests = new Map<string, Promise<any>>();

  // Simple cache for GET operations
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_TTL = 5000; // 5 seconds cache for GET operations

  // Monotonic counter to prevent stale in-flight responses from being cached.
  // Incremented on every mutation (clearCache). Requests capture the counter at start
  // and only cache if it hasn't changed (no mutation occurred during the request).
  private mutationCounter: number = 0;

  /**
   * Generate a cache key for request deduplication and caching.
   *
   * @param channel - IPC channel name
   * @param data - Request data
   * @returns Unique cache key
   */
  private getCacheKey(channel: string, data?: any): string {
    return `${channel}:${JSON.stringify(data || {})}`;
  }

  private pruneExpiredCacheEntries(now = Date.now()): void {
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp >= this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  private setCacheEntry(key: string, data: any): void {
    this.pruneExpiredCacheEntries();
    this.cache.delete(key);
    this.cache.set(key, { data, timestamp: Date.now() });

    while (this.cache.size > WORKSPACE_CLIENT_CACHE_MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Invoke an IPC call with caching and deduplication.
   *
   * @param channel - IPC channel to invoke
   * @param data - Data to send with the request
   * @returns Result containing response data or error
   */
  private async invoke<T>(channel: string, data?: any): Promise<Result<T, string>> {
    try {
      const requestMutationCounter = this.mutationCounter;
      // Check for pending request (deduplication)
      const cacheKey = this.getCacheKey(channel, data);
      this.pruneExpiredCacheEntries();
      const pending = this.pendingRequests.get(cacheKey);
      if (pending) {
        logger.debug(`[WorkspaceClient] Reusing pending request for ${channel}`);
        return pending;
      }

      // Check cache for GET operations
      if (channel.includes(':get') || channel.includes(':list')) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
          logger.debug(`[WorkspaceClient] Using cached response for ${channel}`);
          return { ok: true, data: cached.data };
        }
        if (cached) {
          this.cache.delete(cacheKey);
        }
      }

      // Create the request promise
      const requestPromise = (async () => {
        if (typeof window !== 'undefined' && window.electronAPI) {
          // Ensure data is serializable before IPC call
          // This catches "An object could not be cloned" errors early with better diagnostics
          let serializedData = data;
          if (data !== undefined) {
            try {
              // Use JSON round-trip to ensure data is plain and serializable
              serializedData = JSON.parse(JSON.stringify(data));
            } catch (serializeError) {
              logger.error(`[WorkspaceClient] Data serialization failed for ${channel}:`, {
                error: serializeError,
                dataKeys: data ? Object.keys(data) : [],
              });
              // Try to identify which field is causing the issue
              if (data && typeof data === 'object') {
                for (const [key, value] of Object.entries(data)) {
                  try {
                    JSON.stringify(value);
                  } catch {
                    logger.error(`[WorkspaceClient] Non-serializable field: ${key}`, {
                      type: typeof value,
                      constructor: value?.constructor?.name,
                    });
                  }
                }
              }
              throw new Error(
                `Data serialization failed: ${serializeError instanceof Error ? serializeError.message : 'Unknown error'}`,
              );
            }
          }

          const response = await invokeIpc(channel, serializedData);
          // Handle both Result and CommandResponse formats
          const result = this.normalizeResponse<T>(response);

          // Cache successful GET operations only if no mutation occurred during this request
          if (result.ok && (channel.includes(':get') || channel.includes(':list'))) {
            if (requestMutationCounter === this.mutationCounter) {
              this.setCacheEntry(cacheKey, result.data);
            }
          }

          return result;
        }
        return { ok: false, error: 'IPC not available' } as Result<T, string>;
      })();

      // Store pending request
      this.pendingRequests.set(cacheKey, requestPromise);

      try {
        const result = await requestPromise;
        return result;
      } finally {
        // Clean up pending request
        this.pendingRequests.delete(cacheKey);
      }
    } catch (error) {
      logger.error(`[WorkspaceClient] IPC error for ${channel}:`, error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'IPC call failed',
      };
    }
  }

  /**
   * Clear cached data for a specific workspace or all workspaces.
   *
   * @param workspaceId - Optional workspace ID to clear cache for
   * @example
   * ```typescript
   * // Clear cache for specific workspace
   * workspaceClient.clearCache('workspace-123');
   *
   * // Clear all cache
   * workspaceClient.clearCache();
   * ```
   */
  clearCache(workspaceId?: string) {
    this.mutationCounter++;
    if (workspaceId) {
      // Clear cache entries related to this workspace
      for (const [key] of this.cache) {
        if (key.includes(workspaceId)) {
          this.cache.delete(key);
        }
      }
      // Also clear pending requests for this workspace so in-flight stale
      // requests aren't reused by subsequent callers
      for (const [key] of this.pendingRequests) {
        if (key.includes(workspaceId)) {
          this.pendingRequests.delete(key);
        }
      }
    } else {
      // Clear all cache and pending requests
      this.cache.clear();
      this.pendingRequests.clear();
    }
  }

  private normalizeResponse<T>(response: any): Result<T, string> {
    // Guard against undefined/null responses
    if (response === undefined || response === null) {
      return { ok: false, error: 'No response received' };
    }
    // Handle Result format (ok/error)
    if ('ok' in response) {
      if (response.ok) {
        return { ok: true, data: response.data };
      } else {
        return { ok: false, error: response.error || 'Unknown error' };
      }
    }
    // Handle CommandResponse format (success/error)
    if ('success' in response) {
      if (response.success) {
        return { ok: true, data: response.data };
      } else {
        return { ok: false, error: response.error || 'Unknown error' };
      }
    }
    // Fallback
    return { ok: false, error: 'Invalid response format' };
  }

  /**
   * List all workspaces
   * @param options.lite When true, skip heavy computations (diffSummary, agentSummary, taskStats, gitSummary)
   *                     to avoid blocking other IPC operations like workspace:create
   */
  async list(options?: { lite?: boolean }): Promise<Result<Workspace[], string>> {
    // For backward compatibility, handle both old and new response formats
    const result = await this.invoke<any>(WORKSPACE_CHANNELS.LIST, { lite: options?.lite });

    if (result.ok) {
      // Check if it's the new paginated format
      if (result.data && 'workspaces' in result.data) {
        return { ok: true, data: result.data.workspaces.map(normalizeWorkspacePaths) };
      }
      // Old format - array of workspaces
      return { ok: true, data: (result.data as Workspace[]).map(normalizeWorkspacePaths) };
    }

    return result as Result<Workspace[], string>;
  }

  async create(request: CreateWorkspaceRequest): Promise<Result<Workspace, string>> {
    // Use inline string format to avoid logger truncation
    const ia = (request as any).initialAgent;
    logger.info(
      `[WorkspaceClient] create called: title=${request.title}, hasInitialAgent=${!!ia}, specialist=${ia?.specialist}, model=${ia?.model}, keys=${ia ? Object.keys(ia).join(',') : 'none'}`,
    );
    const result = await this.invoke<Workspace>(WORKSPACE_CHANNELS.CREATE, request);
    logger.info('[WorkspaceClient] create result', {
      ok: result.ok,
      scope: request.scope,
      error: result.ok ? undefined : result.error,
    });
    if (result.ok) {
      return { ok: true, data: normalizeWorkspacePaths(result.data) };
    }
    return result;
  }

  async preflightCloneCheck(githubUrl: string): Promise<Result<null, string>> {
    return this.invoke<null>(WORKSPACE_CHANNELS.PREFLIGHT_CLONE_CHECK, { githubUrl });
  }

  async get(id: WorkspaceId): Promise<Result<Workspace, string>> {
    const result = await this.invoke<Workspace>(WORKSPACE_CHANNELS.GET, { id });
    if (result.ok) {
      return { ok: true, data: normalizeWorkspacePaths(result.data) };
    }
    return result;
  }

  async open(id: WorkspaceId): Promise<Result<Workspace, string>> {
    const result = await this.invoke<Workspace>(WORKSPACE_CHANNELS.OPEN, { id });
    if (result.ok) {
      return { ok: true, data: normalizeWorkspacePaths(result.data) };
    }
    return result;
  }

  async close(id: WorkspaceId): Promise<Result<void, string>> {
    return this.invoke<void>(WORKSPACE_CHANNELS.CLOSE, { id });
  }

  async update(request: UpdateWorkspaceRequest): Promise<Result<Workspace, string>> {
    // Daemon-backed mutation (`workspace.update`, PROTOCOL §5.1) through the
    // AppClient seam; the legacy `workspace:update` IPC path is gone. The
    // daemon returns the authoritative updated Workspace.
    const result = await appClient.workspaces.update(request);
    if (result.success && result.workspace) {
      // Clear cache for this workspace after update
      this.clearCache(request.id);
      // Also clear list cache since this operation changes which/how workspaces are returned
      this.clearCache();
      return { ok: true, data: normalizeWorkspacePaths(result.workspace) };
    }
    return { ok: false, error: result.error || 'Failed to update workspace' };
  }

  async delete(id: WorkspaceId): Promise<Result<void, string>> {
    // Daemon-backed mutation (`workspace.delete`, PROTOCOL §5.1) through the
    // AppClient seam; the legacy `workspace:delete` IPC path is gone.
    const result = await appClient.workspaces.delete(id);
    // Clear cache for this workspace after deletion
    if (result.success) {
      this.clearCache(id);
      // Also clear list cache since this operation changes which/how workspaces are returned
      this.clearCache();
      return { ok: true, data: undefined };
    }
    return { ok: false, error: result.error || 'Failed to delete workspace' };
  }

  async archive(id: WorkspaceId): Promise<Result<void, string>> {
    // Daemon-backed mutation (`workspace.archive`, PROTOCOL §5.1) through the
    // AppClient seam; the legacy `workspace:archive` IPC path is gone.
    const result = await appClient.workspaces.archive(id);
    // Clear cache for this workspace and list cache after archiving
    if (result.success) {
      this.clearCache(id);
      // Also clear list cache since archiving changes which workspaces are returned
      this.clearCache();
      return { ok: true, data: undefined };
    }
    return { ok: false, error: result.error || 'Failed to archive workspace' };
  }

  async unarchive(id: WorkspaceId): Promise<Result<void, string>> {
    // Daemon-backed mutation (`workspace.unarchive`, PROTOCOL §5.1) — the
    // archive-undo path routes through the same seam as archive.
    const result = await appClient.workspaces.unarchive(id);
    // Clear cache for this workspace and list cache after unarchiving
    if (result.success) {
      this.clearCache(id);
      // Also clear list cache since unarchiving changes which workspaces are returned
      this.clearCache();
      return { ok: true, data: undefined };
    }
    return { ok: false, error: result.error || 'Failed to unarchive workspace' };
  }

  async duplicate(id: WorkspaceId, newTitle?: string): Promise<Result<Workspace, string>> {
    const result = await this.invoke<Workspace>(WORKSPACE_CHANNELS.DUPLICATE, { id, newTitle });
    if (result.ok) {
      return { ok: true, data: normalizeWorkspacePaths(result.data) };
    }
    return result;
  }

  async renameBranch(id: WorkspaceId, newBranchName: string): Promise<Result<Workspace, string>> {
    const result = await this.invoke<Workspace>(WORKSPACE_CHANNELS.RENAME_BRANCH, {
      id,
      newBranchName,
    });
    // Clear cache for this workspace after rename
    if (result.ok) {
      this.clearCache(id);
      // Also clear list cache since this operation changes which/how workspaces are returned
      this.clearCache();
      return { ok: true, data: normalizeWorkspacePaths(result.data) };
    }
    return result;
  }

  /**
   * Invoke an IPC call bypassing the client cache and deduplication.
   * Used for on-demand summary endpoints whose freshness is event-driven
   * (e.g., refreshed by 'workspace:tasks-changed') rather than TTL-based.
   */
  private async invokeFresh<T>(channel: string, data?: any): Promise<Result<T, string>> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const response = await invokeIpc(channel, data);
        return this.normalizeResponse<T>(response);
      }
      return { ok: false, error: 'IPC not available' };
    } catch (error) {
      logger.error(`[WorkspaceClient] IPC error for ${channel}:`, error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'IPC call failed',
      };
    }
  }

  /** Fetch the on-demand diff summary for a workspace (null when unavailable). */
  async getDiffSummary(
    workspaceId: WorkspaceId,
  ): Promise<Result<WorkspaceDiffSummary | null, string>> {
    return this.invokeFresh<WorkspaceDiffSummary | null>(WORKSPACE_CHANNELS.GET_DIFF_SUMMARY, {
      workspaceId,
    });
  }

  /** Fetch the on-demand git summary for a workspace (null when unavailable). */
  async getGitSummary(
    workspaceId: WorkspaceId,
  ): Promise<Result<WorkspaceGitSummary | null, string>> {
    return this.invokeFresh<WorkspaceGitSummary | null>(WORKSPACE_CHANNELS.GET_GIT_SUMMARY, {
      workspaceId,
    });
  }

  /** Fetch the on-demand canonical task list for a workspace. */
  async getTasks(workspaceId: WorkspaceId): Promise<Result<WorkspaceTask[], string>> {
    return this.invokeFresh<WorkspaceTask[]>(WORKSPACE_CHANNELS.GET_TASKS, { workspaceId });
  }

}

export const workspaceClient = new WorkspaceClient();

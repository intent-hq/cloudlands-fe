/**
 * Utility to load agent files from disk
 *
 * OPTIMIZATION: This now uses the backend's cached persistence list endpoint
 * instead of doing file I/O from the renderer process. The backend maintains
 * a 5-second cache that persists across page refreshes, significantly reducing
 * the time to load agents on workspace navigation.
 *
 * Previous approach: Multiple IPC calls (home-directory, file:list, file:read-batch)
 * New approach: Single IPC call to agent:persistence:list with backend caching
 */

import { invoke } from '$lib/electron-bridge';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const logger = new Logger('AgentLoader');

// Cache the home directory to avoid repeated IPC calls (used by agentFileExists, deleteAgentFile, etc.)
let cachedHomeDir: string | null = null;

// Frontend cache with short TTL to dedupe rapid calls within the same page session
// The backend has a longer 5-second cache that persists across page refreshes
interface AgentCacheEntry {
  agents: StoredAgent[];
  timestamp: number;
  loadPromise?: Promise<StoredAgent[]>;
}
const agentCache = new Map<string, AgentCacheEntry>();
const CACHE_TTL_MS = 10000; // 10 second frontend cache - backend has 30 second cache
const MAX_AGENT_CACHE_ENTRIES = 50;

function pruneAgentCache(now = Date.now()): void {
  for (const [workspaceId, entry] of agentCache) {
    if (!entry.loadPromise && now - entry.timestamp >= CACHE_TTL_MS) {
      agentCache.delete(workspaceId);
    }
  }

  while (agentCache.size > MAX_AGENT_CACHE_ENTRIES) {
    const oldestCompletedKey = [...agentCache.entries()].find(([, entry]) => !entry.loadPromise)?.[0];
    if (!oldestCompletedKey) break;
    agentCache.delete(oldestCompletedKey);
  }
}

function setAgentCacheEntry(workspaceId: string, entry: AgentCacheEntry): void {
  agentCache.delete(workspaceId);
  agentCache.set(workspaceId, entry);
  pruneAgentCache(entry.timestamp);
}

/**
 * Invalidate the agent cache for a workspace
 * Call this when you know agents have changed (e.g., after creating/deleting an agent)
 */
export function invalidateAgentCache(workspaceId: string): void {
  agentCache.delete(workspaceId);
  logger.debug('Invalidated agent cache', { workspaceId });
}

/**
 * Invalidate all agent caches
 */
export function invalidateAllAgentCaches(): void {
  agentCache.clear();
  logger.debug('Invalidated all agent caches');
}

export interface StoredAgent {
  id: string;
  sessionId?: string | null;
  workspaceId: string;
  name: string;
  status: string;
  messages: any[];
  createdAt: string;
  lastActivity: string;
  startedAt?: string;
  endedAt?: string;
  metadata?: any;
  provider?: string;
  isInitialAgent?: boolean;
}

/**
 * Get all stored agents for a workspace using the backend's cached persistence list
 *
 * OPTIMIZATION: Uses the backend's agent:persistence:list endpoint which has a 5-second
 * cache that persists across page refreshes. This is much faster than the previous
 * approach of doing file I/O from the renderer process via multiple IPC calls.
 *
 * Previous approach: ~1000ms (home-directory + file:list + file:read-batch)
 * New approach: ~10-50ms (single IPC call, backend cache hit)
 */
export async function getStoredAgentsFromDisk(workspaceId: string): Promise<StoredAgent[]> {
  const startTime = performance.now();
  pruneAgentCache();

  // OPTIMIZATION: Check frontend cache first to dedupe rapid calls within same page session
  const cached = agentCache.get(workspaceId);
  if (cached) {
    const cacheAge = Date.now() - cached.timestamp;
    if (cacheAge < CACHE_TTL_MS) {
      // If there's an in-flight request, wait for it to complete
      if (cached.loadPromise) {
        logger.debug(`Waiting for in-flight agent load for workspace ${workspaceId}`);
        return cached.loadPromise;
      }
      // Return cached result
      logger.debug(
        `Returning cached agents for workspace ${workspaceId} (age: ${cacheAge}ms, count: ${cached.agents.length})`,
      );
      return cached.agents;
    }
  }

  // Create a promise for this load operation to dedupe concurrent requests
  const loadPromise = (async (): Promise<StoredAgent[]> => {
    try {
      // Use the backend's cached persistence list endpoint
      // This is much faster than doing file I/O from the renderer
      const response = await invoke<{
        success: boolean;
        data?: any[];
        error?: string;
      }>(IPC_CHANNELS.AGENT.PERSISTENCE_LIST, { workspaceId });

      if (!response?.success) {
        logger.warn('Failed to load agents from backend', {
          workspaceId,
          error: response?.error,
        });
        return [];
      }

      // Transform backend agent sessions to StoredAgent format
      // Backend returns { success: true, data: { agents: [...] } }
      // Handle both wrapped and unwrapped formats for compatibility
      const responseData = response.data as any;
      const backendAgents = Array.isArray(responseData) ? responseData : responseData?.agents || [];
      const agents: StoredAgent[] = backendAgents
        .filter((agent: any) => {
          // Skip terminal IDs
          if (agent.id?.startsWith('terminal-')) {
            return false;
          }
          // Skip deleted agents
          const status = agent.session?.status || agent.status || 'Active';
          if (status === 'Deleted' || status === 'deleted') {
            return false;
          }
          return true;
        })
        .map((agent: any) => ({
          id: agent.id,
          sessionId: agent.session?.backendAgentId || agent.backendAgentId || null,
          workspaceId: agent.workspaceId || workspaceId,
          name: agent.name || 'Agent',
          status: agent.session?.status || agent.status || 'Active',
          messages: agent.session?.messages || agent.messages || [],
          createdAt: agent.createdAt || new Date().toISOString(),
          lastActivity:
            agent.session?.lastActivity ||
            agent.updatedAt ||
            agent.createdAt ||
            new Date().toISOString(),
          startedAt: agent.session?.startedAt || agent.startedAt,
          endedAt: agent.session?.endedAt || agent.endedAt,
          metadata: agent.metadata,
          provider: agent.provider || agent.session?.provider || agent.config?.provider || agent.metadata?.provider,
          isInitialAgent: agent.metadata?.isInitialAgent || false,
        }));

      logger.info(
        `Found ${agents.length} stored agents for workspace ${workspaceId} in ${(performance.now() - startTime).toFixed(1)}ms`,
      );

      // Update frontend cache
      setAgentCacheEntry(workspaceId, {
        agents,
        timestamp: Date.now(),
        loadPromise: undefined,
      });

      return agents;
    } catch (error) {
      logger.error('Failed to load agents from backend:', error);
      // Clear the cache entry on error so next call will retry
      agentCache.delete(workspaceId);
      return [];
    }
  })();

  // Store the promise in cache so concurrent calls can wait for it
  setAgentCacheEntry(workspaceId, {
    agents: cached?.agents || [],
    timestamp: Date.now(),
    loadPromise,
  });

  return loadPromise;
}

/**
 * Check if an agent file exists on disk
 */
export async function agentFileExists(workspaceId: string, agentId: string): Promise<boolean> {
  try {
    // Get home directory (use cached value if available)
    if (!cachedHomeDir) {
      const homeResponse = await invoke<{ success: boolean; data?: string }>(
        'system:home-directory',
      );
      cachedHomeDir = homeResponse?.data || process.env.HOME || process.env.USERPROFILE || '~';
    }
    const homeDir = cachedHomeDir;
    const agentFilePath = `${homeDir}/intent/${workspaceId}/.workspace/agents/${agentId}.json`;

    const existsResponse = await invoke<{ success: boolean; data?: boolean }>('file:exists', {
      path: agentFilePath,
    });

    return existsResponse?.success && existsResponse?.data === true;
  } catch (error) {
    logger.error('Failed to check agent file existence:', error);
    return false;
  }
}

/**
 * Delete an agent file from disk
 */
export async function deleteAgentFile(workspaceId: string, agentId: string): Promise<boolean> {
  try {
    // Get home directory (use cached value if available)
    if (!cachedHomeDir) {
      const homeResponse = await invoke<{ success: boolean; data?: string }>(
        'system:home-directory',
      );
      cachedHomeDir = homeResponse?.data || process.env.HOME || process.env.USERPROFILE || '~';
    }
    const homeDir = cachedHomeDir;
    const agentDir = `${homeDir}/intent/${workspaceId}/.workspace/agents`;

    // Delete both the agent session file and the config file
    const agentFilePath = `${agentDir}/${agentId}.json`;
    const configFilePath = `${agentDir}/${agentId}-config.json`;

    let sessionDeleted = false;
    let configDeleted = false;

    // Delete the main agent session file
    const deleteResponse = await invoke<{ success: boolean; error?: string }>('file:delete', {
      path: agentFilePath,
    });

    if (deleteResponse?.success) {
      logger.info(`Deleted agent session file: ${agentId}`);
      sessionDeleted = true;
    } else {
      logger.debug(`Failed to delete agent session file (may not exist): ${deleteResponse?.error}`);
    }

    // Also delete the config file if it exists
    const configDeleteResponse = await invoke<{ success: boolean; error?: string }>('file:delete', {
      path: configFilePath,
    });

    if (configDeleteResponse?.success) {
      logger.info(`Deleted agent config file: ${agentId}-config.json`);
      configDeleted = true;
    } else {
      logger.debug(
        `Failed to delete agent config file (may not exist): ${configDeleteResponse?.error}`,
      );
    }

    // Return true if at least one file was deleted
    return sessionDeleted || configDeleted;
  } catch (error) {
    logger.error('Failed to delete agent file:', error);
    return false;
  }
}

/**
 * Delete only the agent config file from disk
 */
export async function deleteAgentConfigFile(
  workspaceId: string,
  agentId: string,
): Promise<boolean> {
  try {
    // Get home directory (use cached value if available)
    if (!cachedHomeDir) {
      const homeResponse = await invoke<{ success: boolean; data?: string }>(
        'system:home-directory',
      );
      cachedHomeDir = homeResponse?.data || process.env.HOME || process.env.USERPROFILE || '~';
    }
    const homeDir = cachedHomeDir;
    const configFilePath = `${homeDir}/intent/${workspaceId}/.workspace/agents/${agentId}-config.json`;

    const deleteResponse = await invoke<{ success: boolean; error?: string }>('file:delete', {
      path: configFilePath,
    });

    if (deleteResponse?.success) {
      logger.info(`Deleted agent config file: ${agentId}-config.json`);
      return true;
    } else {
      logger.debug(`Failed to delete agent config file (may not exist): ${deleteResponse?.error}`);
      return false;
    }
  } catch (error) {
    logger.error('Failed to delete agent config file:', error);
    return false;
  }
}

/**
 * Line Changes Store (Client-side)
 *
 * Client-side reactive store for line change statistics.
 * This store syncs with the main process store via IPC.
 */

import type { WorkspaceId, SessionId } from '$shared/types';
import type { AgentId } from '$shared/types/branded-ids';
import { lineChangesClient } from './line-changes.client';
import { createLogger } from '$lib/utils/client-logger';
import { listenSync } from '$lib/electron-bridge';

const logger = createLogger('LineChangesStore');

export interface LineChangeStats {
  additions: number;
  deletions: number;
  timestamp: string;
}

export interface FileLineChange {
  path: string;
  additions: number;
  deletions: number;
  action: 'create' | 'modify' | 'delete';
}

class LineChangesStore {
  #workspaceStats = $state<Map<WorkspaceId, LineChangeStats>>(new Map());
  #agentStats = $state<Map<AgentId, LineChangeStats>>(new Map());
  #fileChanges = $state<Map<string, FileLineChange[]>>(new Map());
  private syncTimers = new Map<string, number>();
  private readonly SYNC_INTERVAL = 5000; // Sync every 5 seconds

  constructor() {
    // Start periodic sync
    this.startPeriodicSync();
    // Listen for workspace changes
    this.setupWorkspaceChangesListener();
  }

  /**
   * Get workspace line change statistics
   */
  getWorkspaceStats(workspaceId: WorkspaceId): LineChangeStats | undefined {
    return this.#workspaceStats.get(workspaceId);
  }

  /**
   * Get agent line change statistics
   */
  getAgentStats(agentId: AgentId): LineChangeStats | undefined {
    return this.#agentStats.get(agentId);
  }

  /**
   * Get file changes for a workspace or agent
   */
  getFileChanges(id: WorkspaceId | AgentId): FileLineChange[] {
    return this.#fileChanges.get(id) || [];
  }

  /**
   * Get all workspace/agent IDs that have file changes
   */
  get fileChanges(): Map<string, FileLineChange[]> {
    return this.#fileChanges;
  }

  /**
   * Update workspace statistics locally
   */
  updateWorkspaceStats(workspaceId: WorkspaceId, stats: Partial<LineChangeStats>): void {
    // Validate stats
    if (!stats || typeof stats !== 'object') {
      logger.warn(`Invalid stats provided for workspace ${workspaceId}`, stats);
      stats = {};
    }

    const existing = this.#workspaceStats.get(workspaceId) || {
      additions: 0,
      deletions: 0,
      timestamp: new Date().toISOString(),
    };

    const updated = {
      ...existing,
      ...stats,
      timestamp: stats.timestamp || new Date().toISOString(),
    };

    // Create a new Map to trigger Svelte reactivity (Map.set() doesn't trigger updates)
    const newMap = new Map(this.#workspaceStats);
    newMap.set(workspaceId, updated);
    this.#workspaceStats = newMap;
    logger.info(`Updated workspace stats for ${workspaceId}:`, updated);

    // Sync with main process
    lineChangesClient.updateWorkspaceStats(workspaceId, updated);
  }

  /**
   * Update agent statistics locally
   */
  updateAgentStats(agentId: AgentId, stats: Partial<LineChangeStats>): void {
    const existing = this.#agentStats.get(agentId) || {
      additions: 0,
      deletions: 0,
      timestamp: new Date().toISOString(),
    };

    const updated = {
      ...existing,
      ...stats,
      timestamp: stats.timestamp || new Date().toISOString(),
    };

    this.#agentStats.set(agentId, updated);
    logger.info(`Updated agent stats for ${agentId}:`, updated);

    // Sync with main process
    lineChangesClient.updateAgentStats(agentId, updated);
  }

  /**
   * Track file changes and update statistics
   */
  trackFileChanges(id: WorkspaceId | AgentId, changes: FileLineChange[]): void {
    this.#fileChanges.set(id, changes);

    // Calculate aggregate statistics
    const stats = changes.reduce(
      (acc, change) => ({
        additions: acc.additions + change.additions,
        deletions: acc.deletions + change.deletions,
      }),
      { additions: 0, deletions: 0 },
    );

    // Determine if this is a workspace or agent ID and update accordingly
    // Agent IDs start with 'agent-' prefix, everything else is a workspace ID
    const isAgentId = id.startsWith('agent-');

    if (isAgentId) {
      this.updateAgentStats(id as AgentId, stats);
    } else {
      // Treat as workspace ID (e.g., 'exotic-bee-b0y1')
      this.updateWorkspaceStats(id as WorkspaceId, stats);
    }
  }

  /**
   * Sync stats from main process
   */
  async syncFromMain(workspaceId?: WorkspaceId, agentId?: AgentId): Promise<void> {
    try {
      if (workspaceId) {
        const stats = await lineChangesClient.getWorkspaceStats(workspaceId);
        if (stats) {
          this.#workspaceStats.set(workspaceId, stats);
        }
      }

      if (agentId) {
        const stats = await lineChangesClient.getAgentStats(agentId);
        if (stats) {
          this.#agentStats.set(agentId, stats);
        }
      }
    } catch (error) {
      logger.error('Failed to sync stats from main process:', error as Error);
    }
  }

  /**
   * Sync all workspace stats from main process
   */
  async syncAllWorkspaceStats(): Promise<void> {
    try {
      const allStats = await lineChangesClient.getAllWorkspaceStats();
      if (allStats && typeof allStats === 'object') {
        // Create a new Map to trigger Svelte reactivity
        const newMap = new Map(this.#workspaceStats);
        for (const [workspaceId, stats] of Object.entries(allStats)) {
          if (stats && stats.additions !== undefined && stats.deletions !== undefined) {
            newMap.set(workspaceId as WorkspaceId, stats);
          }
        }
        this.#workspaceStats = newMap;
        logger.info(`Synced ${Object.keys(allStats).length} workspace stats from main`);
      }
    } catch (error) {
      logger.error('Failed to sync all workspace stats from main process:', error as Error);
    }
  }

  // Store interval ID for cleanup
  private syncInterval: NodeJS.Timeout | null = null;

  /**
   * Start periodic sync with main process
   */
  private startPeriodicSync(): void {
    // Clear any existing interval
    this.stopPeriodicSync();

    // Sync all tracked workspaces and agents periodically
    this.syncInterval = setInterval(() => {
      for (const workspaceId of this.#workspaceStats.keys()) {
        this.syncFromMain(workspaceId);
      }
      for (const agentId of this.#agentStats.keys()) {
        this.syncFromMain(undefined, agentId);
      }
    }, this.SYNC_INTERVAL);
  }

  /**
   * Stop periodic sync
   */
  private stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopPeriodicSync();
  }

  /**
   * Setup listener for workspace-changes events
   */
  private setupWorkspaceChangesListener(): void {
    try {
      listenSync('workspace-changes', (event: any) => {
        const payload = event?.payload || event || {};
        logger.info('[LineChangesStore] Received workspace-changes event', payload);

        if (payload && payload.workspaceId && payload.diffChunk) {
          const { workspaceId, diffChunk } = payload;

          // diffChunk is an object with a files array, not an array itself
          const files = diffChunk.files;
          if (!files || !Array.isArray(files)) {
            logger.warn('[LineChangesStore] diffChunk.files is not an array', { diffChunk });
            return;
          }

          // Convert diffChunk.files to FileLineChange array
          const fileChanges: FileLineChange[] = files.map((file: any) => ({
            path: file.path,
            additions: file.additions || 0,
            deletions: file.deletions || 0,
            action: file.action || 'modify',
          }));

          // Update the store
          this.trackFileChanges(workspaceId, fileChanges);
          logger.info(
            `[LineChangesStore] Updated ${fileChanges.length} file changes for workspace ${workspaceId}`,
          );
        }
      });

      logger.info('[LineChangesStore] Workspace changes listener setup complete');
    } catch (error) {
      logger.error('[LineChangesStore] Failed to setup workspace changes listener:', error);
    }
  }

  /**
   * Clear workspace statistics
   */
  clearWorkspaceStats(workspaceId: WorkspaceId): void {
    this.#workspaceStats.delete(workspaceId);
    this.#fileChanges.delete(workspaceId);
    lineChangesClient.clearWorkspaceStats(workspaceId);
  }

  /**
   * Clear agent statistics
   */
  clearAgentStats(agentId: AgentId): void {
    this.#agentStats.delete(agentId);
    this.#fileChanges.delete(agentId);
    lineChangesClient.clearAgentStats(agentId);
  }
}

// Export singleton instance
export const lineChangesStore = new LineChangesStore();

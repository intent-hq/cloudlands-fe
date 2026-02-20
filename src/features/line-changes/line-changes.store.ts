/**
 * Line Changes Store
 *
 * Centralized store for tracking line change statistics across workspaces and agents.
 * This store maintains a cache of line change data with automatic invalidation.
 */

import { Logger } from '../../shared/logger';
import type { AgentId } from '$shared/types/branded-ids';
import type { WorkspaceId, SessionId } from '../../shared/types';
import { EventEmitter } from '../../lib/utils/browser-event-emitter';

const logger = new Logger('LineChangesStore');

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

class LineChangesStore extends EventEmitter {
  private workspaceStats = new Map<WorkspaceId, LineChangeStats>();
  private agentStats = new Map<AgentId, LineChangeStats>();
  private fileChanges = new Map<string, FileLineChange[]>();
  private readonly CACHE_TTL = 5000; // 5 seconds cache TTL
  private cacheTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    super();
  }

  /**
   * Get workspace line change statistics
   */
  getWorkspaceStats(workspaceId: WorkspaceId): LineChangeStats | undefined {
    return this.workspaceStats.get(workspaceId);
  }

  /**
   * Get all workspace stats as an object
   */
  getAllWorkspaceStats(): Record<WorkspaceId, LineChangeStats> {
    const result: Record<WorkspaceId, LineChangeStats> = {} as Record<WorkspaceId, LineChangeStats>;
    for (const [id, stats] of this.workspaceStats.entries()) {
      result[id] = stats;
    }
    return result;
  }

  /**
   * Get agent line change statistics
   */
  getAgentStats(agentId: AgentId): LineChangeStats | undefined {
    return this.agentStats.get(agentId);
  }

  /**
   * Get file changes for a workspace or agent
   */
  getFileChanges(id: WorkspaceId | AgentId): FileLineChange[] {
    return this.fileChanges.get(id) || [];
  }

  /**
   * Update workspace statistics
   */
  updateWorkspaceStats(workspaceId: WorkspaceId, stats: Partial<LineChangeStats>): void {
    // Guard against undefined stats
    if (!stats) {
      logger.warn(`updateWorkspaceStats called with undefined stats for ${workspaceId}`);
      stats = {};
    }

    const existing = this.workspaceStats.get(workspaceId);

    const updated: LineChangeStats = {
      additions: stats.additions ?? existing?.additions ?? 0,
      deletions: stats.deletions ?? existing?.deletions ?? 0,
      timestamp: stats.timestamp || new Date().toISOString(),
    };

    this.workspaceStats.set(workspaceId, updated);
    this.emit('workspace-stats-updated', { workspaceId, stats: updated });
    this.scheduleCacheInvalidation(`workspace:${workspaceId}`);

    logger.info(`Updated workspace stats for ${workspaceId}:`, updated);
  }

  /**
   * Update agent statistics
   */
  updateAgentStats(agentId: AgentId, stats: Partial<LineChangeStats>): void {
    // Guard against undefined stats
    if (!stats) {
      logger.warn(`updateAgentStats called with undefined stats for ${agentId}`);
      stats = {};
    }

    const existing = this.agentStats.get(agentId);

    const updated: LineChangeStats = {
      additions: stats.additions ?? existing?.additions ?? 0,
      deletions: stats.deletions ?? existing?.deletions ?? 0,
      timestamp: stats.timestamp || new Date().toISOString(),
    };

    this.agentStats.set(agentId, updated);
    this.emit('agent-stats-updated', { agentId, stats: updated });
    this.scheduleCacheInvalidation(`agent:${agentId}`);

    logger.debug(`Updated agent stats for ${agentId}:`, updated);
  }

  /**
   * Track file changes and update statistics
   */
  trackFileChanges(id: WorkspaceId | AgentId, changes: FileLineChange[]): void {
    // Get existing file changes
    const existingChanges = this.fileChanges.get(id) || [];

    // Create a map of existing changes by file path for efficient lookup
    const changeMap = new Map<string, FileLineChange>();
    existingChanges.forEach((change) => changeMap.set(change.path, change));

    // Update or add new changes
    changes.forEach((change) => {
      changeMap.set(change.path, change);
    });

    // Convert map back to array
    const updatedChanges = Array.from(changeMap.values());
    this.fileChanges.set(id, updatedChanges);

    // Calculate aggregate statistics from all changes
    const stats = updatedChanges.reduce(
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

    logger.info(
      `Tracked ${changes.length} file changes for ${id}, total files: ${updatedChanges.length}`,
    );
  }

  /**
   * Clear workspace statistics
   */
  clearWorkspaceStats(workspaceId: WorkspaceId): void {
    this.workspaceStats.delete(workspaceId);
    this.fileChanges.delete(workspaceId);
    this.emit('workspace-stats-cleared', { workspaceId });
    logger.info(`Cleared workspace stats for ${workspaceId}`);
  }

  /**
   * Clear agent statistics
   */
  clearAgentStats(agentId: AgentId): void {
    this.agentStats.delete(agentId);
    this.fileChanges.delete(agentId);
    this.emit('agent-stats-cleared', { agentId });
    logger.info(`Cleared agent stats for ${agentId}`);
  }

  /**
   * Schedule cache invalidation
   */
  private scheduleCacheInvalidation(key: string): void {
    // Clear existing timer if any
    const existingTimer = this.cacheTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new invalidation
    const timer = setTimeout(() => {
      if (key.startsWith('workspace:')) {
        const workspaceId = key.replace('workspace:', '') as WorkspaceId;
        this.workspaceStats.delete(workspaceId);
        logger.debug(`Cache invalidated for workspace ${workspaceId}`);
      } else if (key.startsWith('agent:')) {
        const agentId = key.replace('agent:', '') as AgentId;
        this.agentStats.delete(agentId);
        logger.debug(`Cache invalidated for agent ${agentId}`);
      }
      this.cacheTimers.delete(key);
    }, this.CACHE_TTL);

    this.cacheTimers.set(key, timer);
  }

  /**
   * Clear all data
   */
  clearAll(): void {
    this.workspaceStats.clear();
    this.agentStats.clear();
    this.fileChanges.clear();

    // Clear all cache timers
    for (const timer of this.cacheTimers.values()) {
      clearTimeout(timer);
    }
    this.cacheTimers.clear();

    this.emit('all-stats-cleared');
    logger.info('Cleared all line change statistics');
  }
}

// Export singleton instance
export const lineChangesStore = new LineChangesStore();

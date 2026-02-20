/**
 * Line Changes Client
 *
 * Client-side service for fetching line change statistics from the main process.
 */

import { invoke } from '$lib/electron-bridge';
import type { AgentId } from '$shared/types/branded-ids';
import { createLogger } from '$lib/utils/client-logger';
import type { WorkspaceId, SessionId } from '$shared/types';
import type { LineChangeStats } from './line-changes.store.svelte';

const logger = createLogger('LineChangesClient');

export class LineChangesClient {
  private static instance: LineChangesClient;

  private constructor() {}

  static getInstance(): LineChangesClient {
    if (!LineChangesClient.instance) {
      LineChangesClient.instance = new LineChangesClient();
    }
    return LineChangesClient.instance;
  }

  /**
   * Get workspace line change statistics
   */
  async getWorkspaceStats(workspaceId: WorkspaceId): Promise<LineChangeStats | null> {
    try {
      const result = (await invoke('line-changes:get-workspace-stats', { workspaceId })) as {
        success: boolean;
        data?: LineChangeStats;
        error?: string;
      };
      if (result.success) {
        return result.data || null;
      }
      logger.error(`Failed to get workspace stats: ${result.error}`);
      return null;
    } catch (error) {
      logger.error('Error fetching workspace stats:', error as Error);
      return null;
    }
  }

  /**
   * Get all workspace line change statistics
   */
  async getAllWorkspaceStats(): Promise<Record<WorkspaceId, LineChangeStats>> {
    try {
      const result = (await invoke('line-changes:get-all-workspace-stats', {})) as {
        success: boolean;
        data?: Record<WorkspaceId, LineChangeStats>;
        error?: string;
      };
      if (result.success) {
        return result.data || {};
      }
      logger.error(`Failed to get all workspace stats: ${result.error}`);
      return {};
    } catch (error) {
      logger.error('Error fetching all workspace stats:', error as Error);
      return {};
    }
  }

  /**
   * Get agent line change statistics
   */
  async getAgentStats(agentId: AgentId): Promise<LineChangeStats | null> {
    try {
      const result = (await invoke('line-changes:get-agent-stats', { agentId })) as {
        success: boolean;
        data?: LineChangeStats;
        error?: string;
      };
      if (result.success) {
        return result.data || null;
      }
      logger.error(`Failed to get agent stats: ${result.error}`);
      return null;
    } catch (error) {
      logger.error('Error fetching agent stats:', error as Error);
      return null;
    }
  }

  /**
   * Calculate diff between two contents
   */
  async calculateDiff(
    oldContent: string,
    newContent: string,
  ): Promise<{ additions: number; deletions: number } | null> {
    try {
      const result = (await invoke('line-changes:calculate-diff', { oldContent, newContent })) as {
        success: boolean;
        data?: { additions: number; deletions: number };
        error?: string;
      };
      if (result.success) {
        return result.data || null;
      }
      logger.error(`Failed to calculate diff: ${result.error}`);
      return null;
    } catch (error) {
      logger.error('Error calculating diff:', error as Error);
      return null;
    }
  }

  /**
   * Update workspace stats manually
   */
  async updateWorkspaceStats(
    workspaceId: WorkspaceId,
    stats: Partial<LineChangeStats>,
  ): Promise<boolean> {
    try {
      const result = (await invoke('line-changes:update-workspace-stats', {
        workspaceId,
        stats,
      })) as { success: boolean };
      return result.success;
    } catch (error) {
      logger.error('Error updating workspace stats:', error as Error);
      return false;
    }
  }

  /**
   * Update agent stats manually
   */
  async updateAgentStats(agentId: AgentId, stats: Partial<LineChangeStats>): Promise<boolean> {
    try {
      const result = (await invoke('line-changes:update-agent-stats', { agentId, stats })) as {
        success: boolean;
      };
      return result.success;
    } catch (error) {
      logger.error('Error updating agent stats:', error as Error);
      return false;
    }
  }

  /**
   * Clear workspace stats
   */
  async clearWorkspaceStats(workspaceId: WorkspaceId): Promise<boolean> {
    try {
      const result = (await invoke('line-changes:clear-workspace-stats', { workspaceId })) as {
        success: boolean;
      };
      return result.success;
    } catch (error) {
      logger.error('Error clearing workspace stats:', error as Error);
      return false;
    }
  }

  /**
   * Clear agent stats
   */
  async clearAgentStats(agentId: AgentId): Promise<boolean> {
    try {
      const result = (await invoke('line-changes:clear-agent-stats', { agentId })) as {
        success: boolean;
      };
      return result.success;
    } catch (error) {
      logger.error('Error clearing agent stats:', error as Error);
      return false;
    }
  }
}

// Export singleton instance
export const lineChangesClient = LineChangesClient.getInstance();

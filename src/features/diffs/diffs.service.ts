/**
 * Diffs Service
 *
 * Pure business logic for diff operations.
 * No side effects, no state, just functions.
 */

import type { Result, DiffChunk, WorkspaceId } from '../../shared/types';
import type { DiffsRepository } from './main/diffs.repository';
import { FileSystemDiffsRepository } from './main/diffs.repository';
import { unifiedEventBus } from '../events/main/unified-event-bus';
import { Logger } from '../../shared/logger';

const logger = new Logger('DiffsService');

// In-memory cache for performance
const diffsCache = new Map<string, DiffChunk[]>();

export class DiffsService {
  constructor(private readonly repository: DiffsRepository = new FileSystemDiffsRepository()) {}

  /**
   * List all diffs for a workspace
   */
  async listDiffs(workspaceId: string): Promise<Result<DiffChunk[], string>> {
    try {
      // Try to load from cache first
      if (diffsCache.has(workspaceId)) {
        return {
          ok: true,
          data: diffsCache.get(workspaceId) || [],
        };
      }

      // Try to load from repository
      const diffs = await this.repository.findByWorkspace(workspaceId);
      diffsCache.set(workspaceId, diffs);

      return {
        ok: true,
        data: diffs,
      };
    } catch (error) {
      logger.error('Failed to list diffs', error as Error, { workspaceId });
      return {
        ok: false,
        error: (error as Error).message || 'Failed to list diffs',
      };
    }
  }

  /**
   * Create a new diff
   */
  async createDiff(workspaceId: WorkspaceId, diff: DiffChunk): Promise<Result<DiffChunk, string>> {
    try {
      // Get existing diffs from cache or repository
      let diffs = diffsCache.get(workspaceId);
      if (!diffs) {
        diffs = await this.repository.findByWorkspace(workspaceId);
      }

      // Add new diff
      diffs.push(diff);
      diffsCache.set(workspaceId, diffs);

      // Save to repository
      await this.repository.save(workspaceId, diffs);

      // Emit event
      unifiedEventBus.emitDomainEvent('workspace:updated', { workspaceId, changes: { diffs } });

      return {
        ok: true,
        data: diff,
      };
    } catch (error) {
      logger.error('Failed to create diff', error as Error, { workspaceId });
      return {
        ok: false,
        error: (error as Error).message || 'Failed to create diff',
      };
    }
  }

  /**
   * Update an existing diff
   */
  async updateDiff(workspaceId: WorkspaceId, diff: DiffChunk): Promise<Result<DiffChunk, string>> {
    try {
      // Get existing diffs from cache or repository
      let diffs = diffsCache.get(workspaceId);
      if (!diffs) {
        diffs = await this.repository.findByWorkspace(workspaceId);
      }

      // Find and update the diff
      const index = diffs.findIndex((d) => d.file === diff.file);
      if (index === -1) {
        return {
          ok: false,
          error: 'Diff not found',
        };
      }

      diffs[index] = diff;
      diffsCache.set(workspaceId, diffs);

      // Save to repository
      await this.repository.save(workspaceId, diffs);

      // Emit event
      unifiedEventBus.emitDomainEvent('workspace:updated', { workspaceId, changes: { diffs } });

      return {
        ok: true,
        data: diff,
      };
    } catch (error) {
      logger.error('Failed to update diff', error as Error, { workspaceId });
      return {
        ok: false,
        error: (error as Error).message || 'Failed to update diff',
      };
    }
  }

  /**
   * Mark an agent as active
   */
  async markAgentActive(
    workspaceId: string,
    agentName: string,
    durationMs: number,
  ): Promise<Result<boolean, string>> {
    try {
      // This is a placeholder - in a real app, this would track agent activity
      logger.debug(`Agent ${agentName} active for ${durationMs}ms in workspace ${workspaceId}`);

      return {
        ok: true,
        data: true,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message || 'Failed to mark agent active',
      };
    }
  }

  /**
   * Get current changes for a workspace
   */
  async getCurrentChanges(workspaceId: string): Promise<Result<any, string>> {
    try {
      // This is a placeholder - in a real app, this would get current git changes
      return {
        ok: true,
        data: {
          files: [],
          additions: 0,
          deletions: 0,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message || 'Failed to get current changes',
      };
    }
  }

  /**
   * Start tracking agent execution
   */
  async startAgentExecution(
    workspaceId: string,
    agentName: string,
    sessionId?: string,
    turnNumber?: number,
  ): Promise<Result<boolean, string>> {
    try {
      logger.debug(
        `Starting agent execution tracking for ${agentName} in workspace ${workspaceId}`,
        { sessionId, turnNumber },
      );
      return {
        ok: true,
        data: true,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message || 'Failed to start agent execution tracking',
      };
    }
  }

  /**
   * Stop tracking agent execution
   */
  async stopAgentExecution(workspaceId: string): Promise<Result<boolean, string>> {
    try {
      logger.debug(`Stopping agent execution tracking for workspace ${workspaceId}`);
      return {
        ok: true,
        data: true,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message || 'Failed to stop agent execution tracking',
      };
    }
  }
}

// Export singleton instance
export const diffsService = new DiffsService();

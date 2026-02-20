/**
 * Line Changes IPC Handlers
 *
 * IPC handlers for line change statistics requests from the renderer process.
 */

import { ipcMain } from 'electron';
import type { AgentId } from '$shared/types/branded-ids';
import { Logger } from '../../shared/logger';
import { lineChangesStore, type LineChangeStats } from './line-changes.store';
import { lineChangesService } from './line-changes.service';
import type { WorkspaceId } from '../../shared/types';
import { LINE_CHANGES_CHANNELS } from '../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../main/ipc-validation-middleware';
import {
  LineChangesGetWorkspaceStatsSchema,
  LineChangesGetAgentStatsSchema,
  LineChangesCalculateDiffSchema,
  LineChangesUpdateWorkspaceStatsSchema,
  LineChangesUpdateAgentStatsSchema,
  LineChangesClearWorkspaceStatsSchema,
  LineChangesClearAgentStatsSchema,
} from '../../main/ipc-schemas';

const logger = new Logger('LineChangesIPC');

export function registerLineChangesIPC(): void {
  logger.info('[LineChangesIPC] Registering IPC handlers');

  // Get workspace line stats
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.GET_WORKSPACE_STATS,
    createSafeValidatedHandler(
      LineChangesGetWorkspaceStatsSchema,
      async (_, validated: any) => {
        try {
          const workspaceId = validated.workspaceId as WorkspaceId;
          const stats = lineChangesStore.getWorkspaceStats(workspaceId);
          return {
            success: true,
            data: stats || { additions: 0, deletions: 0, timestamp: new Date().toISOString() },
          };
        } catch (error) {
          logger.error(
            `Failed to get workspace line stats for ${validated.workspaceId}`,
            error as Error,
          );
          return {
            success: false,
            error: (error as Error).message || 'Failed to get workspace line stats',
          };
        }
      },
      LINE_CHANGES_CHANNELS.GET_WORKSPACE_STATS,
    ),
  );

  // Get all workspace line stats
  ipcMain.handle(LINE_CHANGES_CHANNELS.GET_ALL_WORKSPACE_STATS, async () => {
    try {
      const allStats = lineChangesStore.getAllWorkspaceStats();
      return {
        success: true,
        data: allStats,
      };
    } catch (error) {
      logger.error('Failed to get all workspace line stats', error as Error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to get all workspace line stats',
      };
    }
  });

  // Get agent line stats
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.GET_AGENT_STATS,
    createSafeValidatedHandler(
      LineChangesGetAgentStatsSchema,
      async (_, validated: any) => {
        try {
          const stats = lineChangesStore.getAgentStats(validated.agentId as AgentId);
          return {
            success: true,
            data: stats || { additions: 0, deletions: 0, timestamp: new Date().toISOString() },
          };
        } catch (error) {
          logger.error(`Failed to get agent line stats for ${validated.agentId}`, error as Error);
          return {
            success: false,
            error: (error as Error).message || 'Failed to get agent line stats',
          };
        }
      },
      LINE_CHANGES_CHANNELS.GET_AGENT_STATS,
    ),
  );

  // Calculate diff between two contents
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.CALCULATE_DIFF,
    createSafeValidatedHandler(
      LineChangesCalculateDiffSchema,
      async (_, validated: any) => {
        try {
          const stats = lineChangesService.calculateContentDiff(
            validated.oldContent || '',
            validated.newContent || '',
          );
          return {
            success: true,
            data: stats,
          };
        } catch (error) {
          logger.error('Failed to calculate diff', error as Error);
          return {
            success: false,
            error: (error as Error).message || 'Failed to calculate diff',
          };
        }
      },
      LINE_CHANGES_CHANNELS.CALCULATE_DIFF,
    ),
  );

  // Update workspace stats manually (for testing or manual sync)
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.UPDATE_WORKSPACE_STATS,
    createSafeValidatedHandler(
      LineChangesUpdateWorkspaceStatsSchema,
      async (_, validated: any) => {
        try {
          const normalizedStats = (validated.stats || {}) as Partial<LineChangeStats>;
          lineChangesStore.updateWorkspaceStats(
            validated.workspaceId as WorkspaceId,
            normalizedStats,
          );
          return {
            success: true,
          };
        } catch (error) {
          logger.error(
            `Failed to update workspace stats for ${validated.workspaceId}`,
            error as Error,
          );
          return {
            success: false,
            error: (error as Error).message || 'Failed to update workspace stats',
          };
        }
      },
      LINE_CHANGES_CHANNELS.UPDATE_WORKSPACE_STATS,
    ),
  );

  // Update agent stats manually (for testing or manual sync)
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.UPDATE_AGENT_STATS,
    createSafeValidatedHandler(
      LineChangesUpdateAgentStatsSchema,
      async (_, validated: any) => {
        try {
          const normalizedStats = (validated.stats || {}) as Partial<LineChangeStats>;
          lineChangesStore.updateAgentStats(validated.agentId as AgentId, normalizedStats);
          return {
            success: true,
          };
        } catch (error) {
          logger.error(`Failed to update agent stats for ${validated.agentId}`, error as Error);
          return {
            success: false,
            error: (error as Error).message || 'Failed to update agent stats',
          };
        }
      },
      LINE_CHANGES_CHANNELS.UPDATE_AGENT_STATS,
    ),
  );

  // Clear workspace stats
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.CLEAR_WORKSPACE_STATS,
    createSafeValidatedHandler(
      LineChangesClearWorkspaceStatsSchema,
      async (_, validated: any) => {
        try {
          lineChangesStore.clearWorkspaceStats(validated.workspaceId as WorkspaceId);
          return {
            success: true,
          };
        } catch (error) {
          logger.error(
            `Failed to clear workspace stats for ${validated.workspaceId}`,
            error as Error,
          );
          return {
            success: false,
            error: (error as Error).message || 'Failed to clear workspace stats',
          };
        }
      },
      LINE_CHANGES_CHANNELS.CLEAR_WORKSPACE_STATS,
    ),
  );

  // Clear agent stats
  ipcMain.handle(
    LINE_CHANGES_CHANNELS.CLEAR_AGENT_STATS,
    createSafeValidatedHandler(
      LineChangesClearAgentStatsSchema,
      async (_, validated: any) => {
        try {
          lineChangesStore.clearAgentStats(validated.agentId as AgentId);
          return {
            success: true,
          };
        } catch (error) {
          logger.error(`Failed to clear agent stats for ${validated.agentId}`, error as Error);
          return {
            success: false,
            error: (error as Error).message || 'Failed to clear agent stats',
          };
        }
      },
      LINE_CHANGES_CHANNELS.CLEAR_AGENT_STATS,
    ),
  );

  logger.info('[LineChangesIPC] IPC handlers registered successfully');
}

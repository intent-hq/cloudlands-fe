/**
 * Session Stats IPC Handler
 *
 * Exposes session credit usage stats to the renderer process.
 */

import { ipcMain } from 'electron';
import { SESSION_STATS_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { SessionStatsGetSchema } from '../../../main/ipc-schemas';
import { getAggregatedSessionStats } from './session-stats.service';
import { Logger } from '$shared/logger';

const logger = new Logger('SessionStatsIPC');

export function setupSessionStatsIPC(): void {
  logger.info('Setting up session stats IPC handlers');

  ipcMain.handle(
    SESSION_STATS_CHANNELS.GET,
    createSafeValidatedHandler(
      SessionStatsGetSchema,
      async (_event, validated) => {
        try {
          const stats = await getAggregatedSessionStats(validated.sessionIds);
          return { success: true, data: stats };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(
            'Failed to get session stats',
            error instanceof Error ? error : new Error(message),
          );
          return { success: false, error: message };
        }
      },
      SESSION_STATS_CHANNELS.GET,
    ),
  );

  logger.info('Session stats IPC handlers setup complete');
}

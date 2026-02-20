/**
 * Line Attribution IPC
 *
 * IPC handlers for loading line attribution data in the UI
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { lineAttributionService } from './line-attribution.service';
import type { WorkspaceId, NoteId } from '../../../shared/types';
import { LINE_ATTRIBUTION_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  LineAttributionLoadSchema,
  LineAttributionComputeNowSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('LineAttributionIPC');

export function setupLineAttributionIPC(): void {
  logger.info('Setting up line attribution IPC handlers');

  // Load line attribution data for a note
  ipcMain.handle(
    LINE_ATTRIBUTION_CHANNELS.LOAD,
    createSafeValidatedHandler(
      LineAttributionLoadSchema,
      async (_event, validated) => {
        try {
          const data = await lineAttributionService.load(
            validated.workspaceId as WorkspaceId,
            validated.noteId as NoteId,
          );
          return {
            success: true,
            data,
          };
        } catch (error) {
          logger.error('Failed to load line attribution data', error as Error, {
            workspaceId: validated.workspaceId,
            noteId: validated.noteId,
          });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to load line attribution data',
          };
        }
      },
      LINE_ATTRIBUTION_CHANNELS.LOAD,
    ),
  );

  // Compute line attributions immediately (for testing/debugging)
  ipcMain.handle(
    LINE_ATTRIBUTION_CHANNELS.COMPUTE_NOW,
    createSafeValidatedHandler(
      LineAttributionComputeNowSchema,
      async (_event, validated) => {
        try {
          await lineAttributionService.computeNow(
            validated.workspaceId as WorkspaceId,
            validated.noteId as NoteId,
          );
          return {
            success: true,
          };
        } catch (error) {
          logger.error('Failed to compute line attributions', error as Error, {
            workspaceId: validated.workspaceId,
            noteId: validated.noteId,
          });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to compute line attributions',
          };
        }
      },
      LINE_ATTRIBUTION_CHANNELS.COMPUTE_NOW,
    ),
  );

  logger.info('Line attribution IPC handlers setup complete');
}

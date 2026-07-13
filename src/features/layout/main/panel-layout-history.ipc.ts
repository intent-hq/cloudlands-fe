/**
 * Panel Layout History IPC Handlers
 *
 * Main process handlers for panel layout history persistence.
 */

import { ipcMain } from 'electron';
import {
  FileSystemPanelLayoutHistoryRepository,
  type PanelLayoutHistoryData,
} from './panel-layout-history.repository';
import { Logger } from '../../../shared/logger';
import { WorkspaceId as WorkspaceIdFn } from '../../../shared/types/branded-ids';
import { PANEL_LAYOUT_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  PanelLayoutLoadSchema,
  PanelLayoutSaveSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('PanelLayoutHistoryIPC');

const repository = new FileSystemPanelLayoutHistoryRepository();

export function setupPanelLayoutHistoryIPC() {
  logger.info('[PanelLayoutHistoryIPC] Setting up IPC handlers');

  /**
   * Load panel layout history for a workspace
   */
  ipcMain.handle(
    PANEL_LAYOUT_CHANNELS.LOAD,
    createSafeValidatedHandler(
      PanelLayoutLoadSchema,
      async (_event, validated: any): Promise<PanelLayoutHistoryData | null> => {
        try {
          const workspaceId = WorkspaceIdFn(validated.workspaceId);
          return await repository.load(workspaceId);
        } catch (error) {
          logger.error(
            `[PanelLayoutHistoryIPC] Failed to load history for workspace: ${validated.workspaceId}`,
            error as Error,
          );
          return null;
        }
      },
      PANEL_LAYOUT_CHANNELS.LOAD,
    ),
  );

  /**
   * Save panel layout history for a workspace
   */
  ipcMain.handle(
    PANEL_LAYOUT_CHANNELS.SAVE,
    createSafeValidatedHandler(
      PanelLayoutSaveSchema,
      async (_event, validated: any): Promise<boolean> => {
        try {
          const workspaceId = WorkspaceIdFn(validated.workspaceId);
          await repository.save(workspaceId, validated.data);
          return true;
        } catch (error) {
          logger.error(
            `[PanelLayoutHistoryIPC] Failed to save history for workspace: ${validated.workspaceId}`,
            error as Error,
          );
          return false;
        }
      },
      PANEL_LAYOUT_CHANNELS.SAVE,
    ),
  );

  logger.info('[PanelLayoutHistoryIPC] IPC handlers setup complete');
}

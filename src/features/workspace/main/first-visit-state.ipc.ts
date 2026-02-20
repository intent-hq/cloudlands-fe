/**
 * First Visit State IPC
 *
 * IPC handlers for first visit state operations.
 * Exposes repository methods to renderer process.
 */

import { ipcMain } from 'electron';
import { FileSystemFirstVisitStateRepository } from './first-visit-state.repository';
import { Logger } from '../../../shared/logger';
import type { FirstVisitState, WorkspaceId } from '../../../shared/types';
import { WorkspaceId as WorkspaceIdFn } from '../../../shared/types/branded-ids';
import { FIRST_VISIT_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  FirstVisitStateLoadSchema,
  FirstVisitStateSaveSchema,
  FirstVisitStateDeleteSchema,
  FirstVisitStateExistsSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('FirstVisitStateIPC');

// Create singleton repository instance
const repository = new FileSystemFirstVisitStateRepository();

export function setupFirstVisitStateIPC() {
  logger.info('[FirstVisitStateIPC] Setting up IPC handlers');

  /**
   * Load first visit state for a workspace
   */
  ipcMain.handle(
    FIRST_VISIT_CHANNELS.LOAD,
    createSafeValidatedHandler(
      FirstVisitStateLoadSchema,
      async (_event, validated: any): Promise<FirstVisitState | null> => {
        try {
          const workspaceId = WorkspaceIdFn(validated.workspaceId);
          return await repository.load(workspaceId);
        } catch (error) {
          logger.error(
            `[FirstVisitStateIPC] Failed to load state for workspace: ${validated.workspaceId}`,
            error as Error,
          );
          return null;
        }
      },
      FIRST_VISIT_CHANNELS.LOAD,
    ),
  );

  /**
   * Save first visit state for a workspace
   */
  ipcMain.handle(
    FIRST_VISIT_CHANNELS.SAVE,
    createSafeValidatedHandler(
      FirstVisitStateSaveSchema,
      async (_event, validated: any): Promise<boolean> => {
        try {
          const workspaceId = WorkspaceIdFn(validated.workspaceId);
          // Cast the state's workspaceId as well
          const state = {
            ...validated.state,
            workspaceId: WorkspaceIdFn(validated.state.workspaceId),
          } as FirstVisitState;
          await repository.save(workspaceId, state);
          return true;
        } catch (error) {
          logger.error(
            `[FirstVisitStateIPC] Failed to save state for workspace: ${validated.workspaceId}`,
            error as Error,
          );
          return false;
        }
      },
      FIRST_VISIT_CHANNELS.SAVE,
    ),
  );

  /**
   * Delete first visit state for a workspace
   */
  ipcMain.handle(
    FIRST_VISIT_CHANNELS.DELETE,
    createSafeValidatedHandler(
      FirstVisitStateDeleteSchema,
      async (_event, validated: any): Promise<boolean> => {
        try {
          const workspaceId = WorkspaceIdFn(validated.workspaceId);
          await repository.delete(workspaceId);
          return true;
        } catch (error) {
          logger.error(
            `[FirstVisitStateIPC] Failed to delete state for workspace: ${validated.workspaceId}`,
            error as Error,
          );
          return false;
        }
      },
      FIRST_VISIT_CHANNELS.DELETE,
    ),
  );

  /**
   * Check if first visit state exists for a workspace
   */
  ipcMain.handle(
    FIRST_VISIT_CHANNELS.EXISTS,
    createSafeValidatedHandler(
      FirstVisitStateExistsSchema,
      async (_event, validated: any): Promise<boolean> => {
        try {
          const workspaceId = WorkspaceIdFn(validated.workspaceId);
          return await repository.exists(workspaceId);
        } catch (error) {
          logger.error(
            `[FirstVisitStateIPC] Failed to check existence for workspace: ${validated.workspaceId}`,
            error as Error,
          );
          return false;
        }
      },
      FIRST_VISIT_CHANNELS.EXISTS,
    ),
  );

  logger.info('[FirstVisitStateIPC] IPC handlers setup complete');
}

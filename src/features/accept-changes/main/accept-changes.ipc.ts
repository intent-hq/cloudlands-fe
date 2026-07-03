/**
 * Accept Changes IPC Handlers
 *
 * The accept-changes workflow (status, prepare, execute, merge-PR,
 * add-remote) is served by the intentd daemon over `backendRequest`
 * (PROTOCOL.md §5.18). Only the local filesystem probe
 * `accept-changes:check-path-has-changes` remains on Electron IPC.
 */

import {
  ipcMain,
  IpcMainInvokeEvent,
} from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { Logger } from '../../../shared/logger';
import { AcceptChangesService } from './accept-changes.service';

const logger = new Logger('AcceptChangesIPC');

const CheckPathHasChangesSchema = z.object({
  targetPath: z.string(),
});

let acceptChangesService: AcceptChangesService | null = null;

function getService(): AcceptChangesService {
  if (!acceptChangesService) {
    acceptChangesService = new AcceptChangesService();
  }
  return acceptChangesService;
}

export function registerAcceptChangesHandlers(): void {
  logger.info('Registering accept changes IPC handlers');
  const channels = IPC_CHANNELS.ACCEPT_CHANGES;

  // Check if path has uncommitted changes
  ipcMain.handle(
    channels.CHECK_PATH_HAS_CHANGES,
    createSafeValidatedHandler(
      CheckPathHasChangesSchema,
      async (_: IpcMainInvokeEvent, validated: z.infer<typeof CheckPathHasChangesSchema>) => {
        const service = getService();
        const result = await service.checkPathHasChanges(validated.targetPath);
        return { success: true, data: result };
      },
      channels.CHECK_PATH_HAS_CHANGES,
    ),
  );

  logger.info('Accept changes IPC handlers registered');
}

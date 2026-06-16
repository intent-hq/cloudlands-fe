/**
 * Token Usage IPC Handler
 *
 * Exposes the main-store tokenUsage slice to the renderer. GET returns the
 * current cached snapshot for a workspace and dispatches `refreshRequested`
 * so the saga can decide whether a (throttled) rescan is needed. Updated
 * snapshots are pushed on `TOKEN_USAGE_CHANNELS.CHANGED` by the saga.
 */

import { ipcMain } from 'electron';
import { TOKEN_USAGE_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { TokenUsageGetSchema } from '../../../main/ipc-schemas';
import { Logger } from '$shared/logger';
import type { WorkspaceTokenUsageSnapshot } from '../token-usage-types';
import {
  getMainState,
  mainDispatch,
} from '../../../store/main/redux-store-bridge';
import { refreshRequested } from '../../../store/main/slices/token-usage/token-usage-slice';
import { selectWorkspaceTokenUsage } from '../../../store/main/slices/token-usage/token-usage-selectors';

const logger = new Logger('TokenUsageIPC');

export function setupTokenUsageIPC(): void {
  logger.info('Setting up token usage IPC handlers');

  ipcMain.handle(
    TOKEN_USAGE_CHANNELS.GET,
    createSafeValidatedHandler(
      TokenUsageGetSchema,
      async (_event, validated) => {
        try {
          const { workspaceId } = validated;
          const ws = selectWorkspaceTokenUsage.select(getMainState(), workspaceId);
          const snapshot: WorkspaceTokenUsageSnapshot = {
            workspaceId,
            byAgentId: ws.byAgentId,
            totals: ws.totals,
            byModel: ws.byModel,
            lastScanAt: ws.lastScanAt,
            status: ws.status,
          };
          // Saga enforces the refresh throttle + in-flight guard.
          mainDispatch(refreshRequested(workspaceId));
          return { success: true, data: snapshot };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(
            'Failed to get token usage',
            error instanceof Error ? error : new Error(message),
          );
          return { success: false, error: message };
        }
      },
      TOKEN_USAGE_CHANNELS.GET,
    ),
  );

  logger.info('Token usage IPC handlers setup complete');
}


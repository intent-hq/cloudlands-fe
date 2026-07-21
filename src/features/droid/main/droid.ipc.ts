/**
 * Droid IPC Handlers
 *
 * IPC handlers for Factory Droid CLI integration. Model listing is a thin
 * call to the daemon's per-provider catalog (`models.list { providerId }`,
 * PROTOCOL §6.7) — the daemon owns the ACP probe, caching, and warning
 * labeling (not installed / auth required).
 */

import { ipcMain } from 'electron';
import { DROID_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { getDroidPath } from './droid-resolver';

const logger = new Logger('DroidIPC');

export function setupDroidIPC() {
  // Check if droid is available (installed)
  ipcMain.handle(DROID_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking droid availability');
      const droidPath = await getDroidPath();
      const isAvailable = droidPath !== null;
      logger.info('Droid availability check', { isAvailable, droidPath });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('Droid not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for droid — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    DROID_CHANNELS.GET_MODELS,
    async (_event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('droid', params),
  );
}

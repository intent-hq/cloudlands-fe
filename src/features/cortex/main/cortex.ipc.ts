/**
 * Cortex IPC Handlers
 *
 * IPC handlers for Cortex ACP adapter integration. Model listing is a thin
 * call to the daemon's per-provider catalog (`models.list { providerId }`,
 * PROTOCOL §6.7) — the daemon owns the catalog and the feature-code gating.
 */

import { ipcMain } from 'electron';
import { CORTEX_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { resolveCortexCommand } from './cortex-resolver';

const logger = new Logger('CortexIPC');

export function setupCortexIPC() {
  // Check if cortex-acp is available
  ipcMain.handle(CORTEX_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking cortex-acp availability');
      const resolved = await resolveCortexCommand();
      const isAvailable = !!resolved;
      logger.info('Cortex availability check', {
        isAvailable,
        command: resolved?.command,
      });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('Cortex not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Cortex — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    CORTEX_CHANNELS.GET_MODELS,
    async (_event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('cortex', params),
  );
}


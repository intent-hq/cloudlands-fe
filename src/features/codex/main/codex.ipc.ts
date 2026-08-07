/**
 * Codex IPC Handlers
 *
 * IPC handlers for Codex ACP adapter integration. Availability and model
 * listing are both daemon-owned: the codex CLI resolves through
 * `host.findBinary` (PROTOCOL §5.14) and models through the per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7).
 */

import { ipcMain } from 'electron';
import { CODEX_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { findBinary } from '../../../shared/main/find-binary';

const logger = new Logger('CodexIPC');

export function setupCodexIPC() {
  // Codex availability keys off the real `codex` CLI on the daemon host —
  // the ACP adapter is spawned (and pinned) by intentd.
  ipcMain.handle(CODEX_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking Codex availability');
      const codexPath = await findBinary('codex', { cache: false });
      logger.info('Codex availability check', {
        isAvailable: codexPath !== null,
        command: codexPath,
      });
      return { success: true, available: codexPath !== null };
    } catch (error) {
      logger.info('Codex not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Codex — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    CODEX_CHANNELS.GET_MODELS,
    async (_event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('codex', params),
  );
}

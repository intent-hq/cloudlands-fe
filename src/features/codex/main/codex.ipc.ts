/**
 * Codex IPC Handlers
 *
 * IPC handlers for Codex ACP adapter integration.
 * Models are maintained as a static list since the Codex CLI/MCP server
 * does not expose a model listing endpoint.
 */

import { ipcMain } from 'electron';
import { getCodexModelList } from '../../../shared/config/open-ai-codex-models';
import { CODEX_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { resolveCodexCommand } from './codex-resolver';

const logger = new Logger('CodexIPC');

export function setupCodexIPC() {
  // Check if codex-acp is available
  ipcMain.handle(CODEX_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking codex-acp availability');
      const resolved = await resolveCodexCommand();
      const isAvailable = !!resolved;
      logger.info('Codex availability check', {
        isAvailable,
        command: resolved?.command,
        usesNpx: resolved?.usesNpx,
      });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('Codex not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Codex (static list - Codex CLI doesn't expose model listing)
  ipcMain.handle(CODEX_CHANNELS.GET_MODELS, async () => {
    try {
      const resolved = await resolveCodexCommand();
      if (!resolved) {
        return { success: true, data: [], warning: 'Codex not available' };
      }

      const models = getCodexModelList();
      logger.info('Returning Codex model list', { count: models.length });
      return { success: true, data: models };
    } catch (error) {
      logger.warn('Could not get models for Codex', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });
}

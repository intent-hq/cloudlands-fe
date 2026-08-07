/**
 * Claude Code IPC Handlers
 *
 * IPC handlers for Claude Code ACP adapter integration. Availability and
 * model listing are both daemon-owned: binaries resolve through
 * `host.findBinary` (PROTOCOL §5.14) and models through the per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7).
 */

import { ipcMain } from 'electron';
import { CLAUDE_CODE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { findBinary } from '../../../shared/main/find-binary';
import { CLAUDE_CODE_NPX_MISSING_WARNING } from '../../../shared/constants/claude-code';

const logger = new Logger('ClaudeCodeIPC');

export function setupClaudeCodeIPC() {
  // Check if the claude-agent-acp adapter can run (claude CLI + npx present
  // on the daemon host). intentd spawns the pinned adapter via npx.
  ipcMain.handle(CLAUDE_CODE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking claude-agent-acp availability');
      const claudePath = await findBinary('claude', { cache: false });
      if (!claudePath) {
        logger.info('Claude Code availability check', { isAvailable: false });
        return { success: true, available: false };
      }
      const npxPath = await findBinary('npx', { cache: false });
      logger.info('Claude Code availability check', {
        isAvailable: npxPath !== null,
        command: claudePath,
      });
      if (npxPath) {
        return { success: true, available: true };
      }
      return { success: true, available: false, warning: CLAUDE_CODE_NPX_MISSING_WARNING };
    } catch (error) {
      logger.info('Claude Code not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Claude Code — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    CLAUDE_CODE_CHANNELS.GET_MODELS,
    async (_event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('claude-code', params),
  );
}

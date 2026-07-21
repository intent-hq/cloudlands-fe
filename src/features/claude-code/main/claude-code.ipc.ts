/**
 * Claude Code IPC Handlers
 *
 * IPC handlers for Claude Code ACP adapter integration. Model listing is a
 * thin call to the daemon's per-provider catalog (`models.list
 * { providerId }`, PROTOCOL §6.7) — the daemon owns the ACP probe, caching,
 * and default-model fallback.
 */

import { ipcMain } from 'electron';
import { CLAUDE_CODE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import {
  CLAUDE_CODE_NPX_MISSING_WARNING,
  resolveClaudeCodeCommandDetailed,
} from './claude-code-resolver';

const logger = new Logger('ClaudeCodeIPC');

export function setupClaudeCodeIPC() {
  // Check if the claude-agent-acp adapter can run (claude CLI + npx present)
  ipcMain.handle(CLAUDE_CODE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking claude-agent-acp availability');
      const resolution = await resolveClaudeCodeCommandDetailed();
      logger.info('Claude Code availability check', {
        isAvailable: resolution.ok,
        command: resolution.ok ? resolution.resolved.command : undefined,
        reason: resolution.ok ? undefined : resolution.reason,
      });
      if (resolution.ok) {
        return { success: true, available: true };
      }
      if (resolution.reason === 'npx-missing') {
        return { success: true, available: false, warning: CLAUDE_CODE_NPX_MISSING_WARNING };
      }
      return { success: true, available: false };
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

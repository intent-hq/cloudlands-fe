/**
 * Claude Code IPC Handlers
 *
 * IPC handlers for Claude Code ACP adapter integration. Availability and
 * model listing are both daemon-owned: availability comes from
 * `host.providerDiscovery` (PROTOCOL §5.14) and models through the per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7).
 */

import { ipcMain } from 'electron';
import { CLAUDE_CODE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { getBackendClient } from '../../backend/main/backend.ipc';
import type { NpxStatus } from '../../../shared/types/provider-availability';
import { CLAUDE_CODE_NPX_MISSING_WARNING } from '../../../shared/constants/claude-code';

const logger = new Logger('ClaudeCodeIPC');

export function setupClaudeCodeIPC() {
  // The daemon resolves the bundled adapter runtime or a configured override.
  ipcMain.handle(CLAUDE_CODE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking claude-agent-acp availability');
      const discovery = await getBackendClient().request<{
        providers: Array<{ id: string; installed: boolean; gatedOff?: string | null }>;
        npx?: NpxStatus;
      }>('host.providerDiscovery', {});
      const row = discovery.providers.find((provider) => provider.id === 'claude-code');
      const available = row?.installed === true && !row.gatedOff;
      logger.info('Claude Code availability check', { isAvailable: available });
      if (row && !row.installed && !row.gatedOff && discovery.npx?.resolvedPath === null) {
        return { success: true, available, warning: CLAUDE_CODE_NPX_MISSING_WARNING };
      }
      return { success: true, available };
    } catch (error) {
      logger.info('Claude Code not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Claude Code — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    CLAUDE_CODE_CHANNELS.GET_MODELS,
    async (event, params?: { forceRefresh?: boolean; workspaceId?: string }) =>
      getProviderModelsEnvelope('claude-code', params, event),
  );
}

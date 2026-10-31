/**
 * Claude Code IPC Handlers
 *
 * Model listing for Claude Code is a thin call to the daemon's per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7). Availability is
 * probed by the renderer's provider-status bridge against the daemon host.
 */

import { ipcMain } from 'electron';
import { CLAUDE_CODE_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupClaudeCodeIPC() {
  // Get available models for Claude Code — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    CLAUDE_CODE_CHANNELS.GET_MODELS,
    async (
      event,
      params?: { forceRefresh?: boolean; workspaceId?: string; providerRef?: string },
    ) => getProviderModelsEnvelope('claude-code', params, event),
  );
}

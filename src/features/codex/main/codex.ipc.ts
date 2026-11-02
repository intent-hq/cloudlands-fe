/**
 * Codex IPC Handlers
 *
 * Model listing for Codex is a thin call to the daemon's per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7). Availability is
 * probed by the renderer's provider-status bridge against the daemon host.
 */

import { ipcMain } from 'electron';
import { CODEX_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupCodexIPC() {
  // Get available models for Codex — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    CODEX_CHANNELS.GET_MODELS,
    async (
      event,
      params?: { forceRefresh?: boolean; workspaceId?: string; providerRef?: string },
    ) => getProviderModelsEnvelope('codex', params, event),
  );
}

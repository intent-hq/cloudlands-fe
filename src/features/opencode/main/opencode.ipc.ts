/**
 * OpenCode IPC Handlers
 *
 * Model listing for OpenCode is a thin call to the daemon's per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7). Availability is
 * probed by the renderer's provider-status bridge against the daemon host.
 */

import { ipcMain } from 'electron';
import { OPENCODE_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupOpencodeIPC() {
  // Get available models for OpenCode — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    OPENCODE_CHANNELS.GET_MODELS,
    async (
      event,
      params?: { forceRefresh?: boolean; workspaceId?: string; providerRef?: string },
    ) => getProviderModelsEnvelope('opencode', params, event),
  );
}

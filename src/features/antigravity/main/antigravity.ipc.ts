/**
 * Antigravity IPC Handlers
 *
 * Model listing for Antigravity is a thin call to the daemon's per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7). Availability is
 * probed by the renderer's provider-status bridge against the daemon host.
 */

import { ipcMain } from 'electron';
import { ANTIGRAVITY_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupAntigravityIPC() {
  // Get available models for Antigravity — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    ANTIGRAVITY_CHANNELS.GET_MODELS,
    async (event, params?: { forceRefresh?: boolean; workspaceId?: string }) =>
      getProviderModelsEnvelope('antigravity', params, event),
  );
}

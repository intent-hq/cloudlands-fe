/**
 * Droid IPC Handlers
 *
 * Model listing for Droid is a thin call to the daemon's per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7). Availability is
 * probed by the renderer's provider-status bridge against the daemon host.
 */

import { ipcMain } from 'electron';
import { DROID_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupDroidIPC() {
  // Get available models for Droid — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    DROID_CHANNELS.GET_MODELS,
    async (
      event,
      params?: { forceRefresh?: boolean; workspaceId?: string; providerRef?: string },
    ) => getProviderModelsEnvelope('droid', params, event),
  );
}

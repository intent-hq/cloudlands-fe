/**
 * Cortex IPC Handlers
 *
 * Model listing for Cortex is a thin call to the daemon's per-provider
 * catalog (`models.list { providerId }`, PROTOCOL §6.7). Availability is
 * probed by the renderer's provider-status bridge against the daemon host.
 */

import { ipcMain } from 'electron';
import { CORTEX_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupCortexIPC() {
  // Get available models for Cortex — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    CORTEX_CHANNELS.GET_MODELS,
    async (
      event,
      params?: { forceRefresh?: boolean; workspaceId?: string; providerRef?: string },
    ) => getProviderModelsEnvelope('cortex', params, event),
  );
}

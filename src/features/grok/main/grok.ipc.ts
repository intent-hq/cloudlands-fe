/**
 * Grok IPC Handlers
 *
 * IPC handlers for the Grok Build CLI integration. Model listing is a thin
 * call to the daemon's per-provider catalog (`models.list { providerId }`,
 * PROTOCOL §6.7) — the daemon owns probing, caching, and warning labeling,
 * degrading to an empty list plus a `warning` when no model source is
 * available.
 */

import { ipcMain } from 'electron';
import { GROK_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupGrokIPC() {
  // Get available models for grok — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(GROK_CHANNELS.GET_MODELS, async (_event, params?: { forceRefresh?: boolean }) =>
    getProviderModelsEnvelope('grok', params),
  );
}

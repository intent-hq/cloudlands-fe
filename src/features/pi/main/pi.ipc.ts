/**
 * Pi IPC Handlers
 *
 * IPC handlers for the Pi ACP adapter integration. Model listing is a thin
 * call to the daemon's per-provider catalog (`models.list { providerId }`,
 * PROTOCOL §6.7) — the daemon owns the ACP probe, caching, and default-model
 * fallback.
 */

import { ipcMain } from 'electron';
import { PI_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import {
  installPiMcpAdapter,
  isPiMcpAdapterInstalled,
} from './pi-resolver';

export function setupPiIPC() {
  ipcMain.handle(PI_CHANNELS.CHECK_MCP_ADAPTER, async () => isPiMcpAdapterInstalled());

  ipcMain.handle(PI_CHANNELS.INSTALL_MCP_ADAPTER, async () => installPiMcpAdapter());

  // Get available models for Pi — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    PI_CHANNELS.GET_MODELS,
    async (_event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('pi', params),
  );
}

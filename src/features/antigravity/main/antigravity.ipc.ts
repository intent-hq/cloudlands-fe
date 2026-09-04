import { ipcMain } from 'electron';
import { ANTIGRAVITY_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupAntigravityIPC() {
  ipcMain.handle(
    ANTIGRAVITY_CHANNELS.GET_MODELS,
    async (event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('antigravity', params, event),
  );
}

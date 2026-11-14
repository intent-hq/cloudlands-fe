/**
 * The main-process `providers:get-models` handler: one route for every
 * provider's model list, a thin call to the daemon catalog (`models.list`,
 * PROTOCOL §6.7). A new provider needs no wiring here (intent-hq/intent#9253).
 */

import { ipcMain } from 'electron';
import { PROVIDERS_CHANNELS } from '../../../shared/ipc/channels';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';

export function setupProviderModelsIPC(): void {
  ipcMain.handle(PROVIDERS_CHANNELS.GET_MODELS, async (event, params?: unknown) =>
    getProviderModelsEnvelope(params, event),
  );
}

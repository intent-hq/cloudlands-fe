// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
interface BackendStatusPayload {
  status?: string;
  reconnected?: boolean;
}
import { selectCanAdministerHost } from '../../principal/principal-selectors';
import { selectModelBootContext } from '../model-selectors';
import { appClient } from '$lib/client';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { loadModelCatalog } from './model-catalog-request';
import { createModelBootSaga } from './model-boot-saga-factory';

export const { loadModelsOnBootWorker, modelBootSaga } = createModelBootSaga({
  createBackendConnectedChannel,
  selectCanAdministerHost,
  selectModelBootContext,
  selectActiveProviderId,
  settings: { getProviderSettings: () => appClient.settings.getProviderSettings() },
  loadModelCatalog,
});

function createBackendConnectedChannel(): EventChannel<{ reconnected: boolean }> {
  return eventChannel<{ reconnected: boolean }>((emit) => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      return () => {};
    }
    const api = window.electronAPI;
    const listenerId = api.on(
      IPC_CHANNELS.BACKEND.STATUS,
      (payload: BackendStatusPayload | undefined) => {
        if (payload?.status !== 'connected') return;
        emit({ reconnected: payload.reconnected === true });
      },
    );
    return () => api.offById(IPC_CHANNELS.BACKEND.STATUS, listenerId);
  }, buffers.sliding(1));
}

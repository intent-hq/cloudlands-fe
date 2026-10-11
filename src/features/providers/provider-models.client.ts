// Svelte client binding; remove this facade when the Svelte renderer retires.
import { invoke } from '$lib/electron-bridge';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { selectProviderDisplayName } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import {
  createProviderModelsClient,
  PROVIDER_MODEL_CHANNELS,
} from './provider-models-client-factory';
export type { ProviderModelEntry, ProviderModelsResult } from './provider-models-types';

/**
 * Invoke a provider model IPC channel, preferring the real Electron bridge
 * (`window.electronAPI`) so the request reaches the live main-process handler.
 * Falls back to the mock-routed invoke when no real bridge is present
 * (daemon/web builds, unit tests) — there the channel is served by
 * `model-catalog-bridge-seeder.ts`. The dev browser mock also installs a
 * `window.electronAPI` (answering `*:get-models` with an empty catalog), so
 * the platform detector — not bridge presence — decides the transport.
 */
async function invokeModelChannel<T>(channel: string, data?: unknown): Promise<T> {
  if (isElectronPlatform() && window.electronAPI?.invoke) {
    return (await window.electronAPI.invoke(channel, data)) as T;
  }
  return await invoke<T>(channel, data);
}

export const { getProviderModels } = createProviderModelsClient({
  displayName: (id, workspaceId) =>
    selectProviderDisplayName.select(appStore.state, id, workspaceId),
  readModels: (providerId, options) =>
    invokeModelChannel(
      PROVIDER_MODEL_CHANNELS[providerId],
      options.forceRefresh === true || options.workspaceId
        ? {
            ...(options.forceRefresh === true ? { forceRefresh: true } : {}),
            ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
          }
        : undefined,
    ),
});

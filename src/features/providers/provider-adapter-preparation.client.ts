import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import { electronAPI } from '$lib/client/live/backend-transport';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createProviderAdapterPreparer } from '$shared/provider-adapter-preparation';

const prepare = createProviderAdapterPreparer();

/** Capture the route before discovery, never resolve a new host after it. */
export async function prepareOnboardingAdapters(connectionContext: string): Promise<void> {
  try {
    if (isElectronPlatform()) {
      const api = electronAPI();
      await api?.invoke(IPC_CHANNELS.PROVIDERS.PREPARE_ADAPTERS, connectionContext);
    } else {
      const client = resolveBackendTransport();
      await prepare(client, connectionContext);
    }
  } catch {
    // Optional preparation must never become an onboarding error or toast.
  }
}

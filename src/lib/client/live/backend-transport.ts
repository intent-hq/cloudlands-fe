import { createBackendRuntime } from './backend-transport-runtime';

/**
 * Compatibility facade for existing LiveAppClient domains and Svelte callers.
 * Keep their lazy Store access until the legacy renderer is retired; new renderers
 * bind the shared implementation to their own canonical Store.
 */
const backend = createBackendRuntime(async () => {
  const { store } = await import('$store/renderer/store');
  return {
    remoteEnabled: () => store.state.userPreferences?.labsRemoteAgentsEnabled === true,
    connectionGeneration: () => store.state.daemonHealth.connectionGeneration,
  };
});

export const {
  captureBackendRepositoryResource,
  captureBackendRepositoryRoute,
  captureBackendRepositorySelection,
  backendRequest,
  observeBackendNodeCapabilities,
  backendSubscribe,
  backendUnsubscribe,
  detectLiveStateCapability,
  onBackendNotification,
  onBackendReconnected,
  prepareBackendNativeReview,
  captureBackendRepositoryCheckout,
} = backend;

export type { BackendNotification } from './backend-transport-types';
export { electronAPI } from './electron-ipc-transport';

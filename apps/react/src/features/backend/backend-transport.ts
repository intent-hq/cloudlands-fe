import { store } from '@/store';
import { createBackendRuntime } from '$lib/client/live/backend-transport-runtime';

/** One renderer binding; transport selection and placement policy stay canonical. */
export const backend = createBackendRuntime(() => ({
  remoteEnabled: () => store.state.userPreferences.labsRemoteAgentsEnabled === true,
  connectionGeneration: () => store.state.daemonHealth.connectionGeneration,
}));

export const {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
  observeBackendNodeCapabilities,
  detectLiveStateCapability,
  captureBackendRepositoryResource,
  captureBackendRepositoryRoute,
  captureBackendRepositorySelection,
  captureBackendRepositoryCheckout,
  prepareBackendNativeReview,
} = backend;

export type {
  BackendNotification,
  BackendRequestOptions,
} from '$lib/client/live/backend-transport-types';

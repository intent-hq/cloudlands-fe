// Svelte client binding; remove this facade when the Svelte renderer retires.
import { selectPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-selectors';
import { store } from '$store/renderer/store';
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { createProviderAuthStatusClient } from './provider-auth-status-client-factory';

export const providerAuthStatusClient = createProviderAuthStatusClient({
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
  connectionContext: () => selectPrincipalConnectionContext.select(store.state),
});
export const {
  getProviderAuthVerdicts,
  invalidateProviderAuthStatus,
  __resetProviderAuthStatusForTests,
} = providerAuthStatusClient;

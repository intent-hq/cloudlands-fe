import { createProviderModelCatalogRead } from '$lib/client/live/provider-model-catalog-read';
import { store } from '@/store';
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '@/features/backend/backend-transport';
import {
  selectHostRole,
  selectPrincipalConnectionContext,
} from '@/store/principal/principal-selectors';
import {
  selectProviderCatalogEntries,
  selectProviderDisplayName,
  selectNormalizedProviderId,
} from '@/store/provider-catalog/provider-catalog-selectors';
import { BackendModelsClient } from '$lib/client/live/backend-models-client';
import { BackendProvidersClient } from '$lib/client/live/backend-providers-client';
import { createSpecialistCatalogRead } from '$lib/client/live/specialist-catalog-read';
import { createProviderAuthStatusClient } from '../../../../../src/features/providers/provider-auth-status-client-factory';
import { createProviderModelsClient } from '../../../../../src/features/providers/provider-models-client-factory';
import { createProviderStatusClient } from '../../../../../src/features/providers/provider-status-client-factory';
import { createModelReads } from '../../../../../src/store/renderer/slices/model/model-read-client';

/** All reads use the renderer's existing BackendRuntime and current admitted identity. */
export const models = new BackendModelsClient(backendRequest);
export const providers = new BackendProvidersClient(backendRequest);
export const listSpecialistCatalog = createSpecialistCatalogRead(backendRequest);
export const providerAuthStatusClient = createProviderAuthStatusClient({
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
  connectionContext: () => selectPrincipalConnectionContext.select(store.state),
});
export const { getProviderAuthVerdicts, invalidateProviderAuthStatus } = providerAuthStatusClient;
export const providerStatusClient = createProviderStatusClient({
  backendRequest,
  getProviderAuthVerdicts,
  hostRole: () => selectHostRole.select(store.state),
  connectionContext: () => selectPrincipalConnectionContext.select(store.state),
  catalogEntries: () => selectProviderCatalogEntries.select(store.state),
});
const { getProviderModels } = createProviderModelsClient({
  displayName: (id, workspaceId) => selectProviderDisplayName.select(store.state, id, workspaceId),
  readModels: createProviderModelCatalogRead(backendRequest),
});
export const { fetchModelsForProvider, getModelsForProvider, getModelsForProviderForLoadingState } =
  createModelReads({
    getProviderModels,
    normalizeProviderId: (id) => selectNormalizedProviderId.select(store.state, id),
  });

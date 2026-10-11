// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { selectProviderModelsClearEpoch } from '../../provider-models/provider-models-selectors';
import { appClient } from '$lib/client';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { selectModelBootContext } from '../model-selectors';
import { createModelCatalogRequest } from './model-catalog-request-factory';

export const { loadModelCatalog } = createModelCatalogRequest({
  selectProviderModelsClearEpoch,
  selectActiveProviderId,
  selectModelBootContext,
  models: { list: (providerId, workspaceId) => appClient.models.list(providerId, workspaceId) },
});

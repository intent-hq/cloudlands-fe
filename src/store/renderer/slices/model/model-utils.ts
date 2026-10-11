// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { getProviderModels } from '$features/providers/provider-models.client';
import { store as appStore } from '../../store';
import { selectNormalizedProviderId } from '../provider-catalog/provider-catalog-selectors';
import { createModelReads } from './model-read-client';
export type { ProviderModel } from './model-read-client';

export const { fetchModelsForProvider, getModelsForProviderForLoadingState, getModelsForProvider } =
  createModelReads({
    getProviderModels,
    normalizeProviderId: (id) => selectNormalizedProviderId.select(appStore.state, id),
  });

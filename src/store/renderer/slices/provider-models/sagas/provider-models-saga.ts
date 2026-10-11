// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { notify } from '$lib/components/patterns/notify';
import { getModelsForProviderForLoadingState } from '../../model/model-utils';
import {
  selectNormalizedProviderId,
  selectProviderDisplayName,
} from '../../provider-catalog/provider-catalog-selectors';
import {
  selectObservedModelProviders,
  selectObservedModelProviderKeys,
  selectProviderModelsCacheEntry,
  selectProviderModelsClearEpoch,
  selectProviderModelsRequests,
} from '../provider-models-selectors';
import { createProviderModelsSaga } from './provider-models-saga-factory';

export const { providerModelsSaga } = createProviderModelsSaga({
  selectNormalizedProviderId,
  selectProviderDisplayName,
  selectObservedModelProviders,
  selectObservedModelProviderKeys,
  selectProviderModelsCacheEntry,
  selectProviderModelsClearEpoch,
  selectProviderModelsRequests,
  notify,
  getModelsForProviderForLoadingState,
});

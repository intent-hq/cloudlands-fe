import { notify } from '@/components/patterns/notify';
import { getModelsForProviderForLoadingState } from '@/features/providers/provider-read-clients';
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
import { createProviderModelsSaga } from '../../../../../../src/store/renderer/slices/provider-models/sagas/provider-models-saga-factory';

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

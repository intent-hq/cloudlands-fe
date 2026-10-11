import { selectProviderModelsClearEpoch } from '../../provider-models/provider-models-selectors';
import { models } from '@/features/providers/provider-read-clients';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { selectModelBootContext } from '../model-selectors';
import { createModelCatalogRequest } from '../../../../../../src/store/renderer/slices/model/sagas/model-catalog-request-factory';

export const { loadModelCatalog } = createModelCatalogRequest({
  selectProviderModelsClearEpoch,
  selectActiveProviderId,
  selectModelBootContext,
  models: models,
});

import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { providers } from '@/features/providers/provider-read-clients';
import { createProviderCatalogSaga } from '../../../../../../src/store/renderer/slices/provider-catalog/sagas/provider-catalog-saga-factory';

export const { hydrateProviderCatalog } = createProviderCatalogSaga({
  selectPrincipalConnectionContext,
  providers: providers,
});

// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { appClient } from '$lib/client';
import { createProviderCatalogSaga } from './provider-catalog-saga-factory';

export const { hydrateProviderCatalog } = createProviderCatalogSaga({
  selectPrincipalConnectionContext,
  providers: {
    catalog: (...args: Parameters<typeof appClient.providers.catalog>) =>
      appClient.providers.catalog(...args),
  },
});

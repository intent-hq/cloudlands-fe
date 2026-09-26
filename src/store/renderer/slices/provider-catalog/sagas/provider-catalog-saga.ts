import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { call, put } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { providerCatalogLoaded } from '../provider-catalog-slice';

const logger = createLogger('ProviderCatalogSaga');

export function* hydrateProviderCatalog() {
  const connection = yield* selectPrincipalConnectionContext.effect();
  try {
    const catalog: Awaited<ReturnType<typeof appClient.providers.catalog>> = yield* call([
      appClient.providers,
      appClient.providers.catalog,
    ]);
    const current = yield* selectPrincipalConnectionContext.effect();
    if (connection === current) yield* put(providerCatalogLoaded(catalog));
  } catch (error) {
    logger.warn('providers.catalog hydration failed; keeping previous catalog', { error });
  }
}

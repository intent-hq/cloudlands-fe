import { call, put } from 'typed-redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { providerCatalogLoaded } from '../provider-catalog-slice';
import type * as projections0 from '../../principal/principal-projections';

import type { ReadSelector, ProviderReadState } from '../provider-read-types';

export function createProviderCatalogSaga<State extends ProviderReadState>({
  selectPrincipalConnectionContext,
  providers,
}: {
  selectPrincipalConnectionContext: ReadSelector<
    typeof projections0.getPrincipalConnectionContext,
    State
  >;
  providers: {
    catalog: (
      workspaceId?: string,
    ) => Promise<import('$shared/provider-catalog').ProviderCatalogResult>;
  };
}) {
  const logger = createLogger('ProviderCatalogSaga');

  function* hydrateProviderCatalog() {
    const connection = yield* selectPrincipalConnectionContext.effect();
    try {
      const catalog: Awaited<ReturnType<typeof providers.catalog>> = yield* call([
        providers,
        providers.catalog,
      ]);
      const current = yield* selectPrincipalConnectionContext.effect();
      if (connection === current) yield* put(providerCatalogLoaded(catalog));
    } catch (error) {
      logger.warn('providers.catalog hydration failed; keeping previous catalog', { error });
    }
  }

  return { hydrateProviderCatalog };
}

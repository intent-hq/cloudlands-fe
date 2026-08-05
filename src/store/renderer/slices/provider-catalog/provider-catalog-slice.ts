/**
 * Provider Catalog Slice
 *
 * Holds the daemon's static provider registry (`providers.catalog`,
 * PROTOCOL §5.38) exactly as sent on the wire — the daemon owns the registry
 * and the `visible` gating verdict; nothing is healed or re-derived here.
 * Hydrated by the provider-catalog seeder at connect time and re-hydrated on
 * backend reconnect (the daemon binary — and therefore the registry — may
 * have changed across a restart).
 */
import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { ProviderCatalogResult } from '$shared/provider-catalog';
import type { ProviderCatalogEntry, ProviderCatalogState } from './provider-catalog-types';

export const initialState: ProviderCatalogState = {
  providers: createCollection<ProviderCatalogEntry, 'id'>('id'),
  defaultProviderId: '',
  loaded: false,
};

/**
 * A `providers.catalog` response landed — replace the whole catalog (the
 * registry is atomic; the daemon never sends partial rows).
 */
export const providerCatalogLoaded = createAction<[catalog: ProviderCatalogResult]>(
  'providerCatalog/providerCatalogLoaded',
);

export const providerCatalogReducer = createReducer<ProviderCatalogState>(initialState).with(
  providerCatalogLoaded,
  (state, { payload: [catalog] }) => ({
    ...state,
    providers: createCollection<ProviderCatalogEntry, 'id'>('id', catalog.providers),
    defaultProviderId: catalog.defaultProviderId,
    loaded: true,
  }),
);

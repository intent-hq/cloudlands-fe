/**
 * Provider Catalog Slice
 *
 * Holds the daemon's static provider registry (`providers.catalog`,
 * PROTOCOL §5.38) exactly as sent on the wire — the daemon owns the registry
 * and the `visible` gating verdict; nothing is healed or re-derived here.
 * Hydrated by the root-owned provider availability saga at startup and on
 * backend reconnect (the daemon binary — and therefore the registry — may
 * have changed across a restart).
 */
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { ProviderCatalogResult } from '$shared/provider-catalog';
import type { ProviderCatalogEntry, ProviderCatalogState } from './provider-catalog-types';

export const initialState: ProviderCatalogState = {
  providers: createCollection<ProviderCatalogEntry, 'id'>('id'),
  loaded: false,
};

/**
 * A `providers.catalog` response landed — replace the whole catalog (the
 * registry is atomic; the daemon never sends partial rows).
 */
export const providerCatalogLoaded = createAction<[catalog: ProviderCatalogResult]>(
  'providerCatalog/providerCatalogLoaded',
);

export const providerCatalogReducer = createReducer<ProviderCatalogState>(initialState);
providerCatalogReducer.with(providerCatalogLoaded, (state, { payload: [catalog] }) => ({
  ...state,
  providers: createCollection<ProviderCatalogEntry, 'id'>('id', catalog.providers),
  loaded: true,
}));

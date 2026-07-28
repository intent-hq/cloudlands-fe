/**
 * Provider Catalog Types
 *
 * Renderer-side view of the daemon's static provider registry
 * (`providers.catalog`, PROTOCOL §5.38). The daemon owns the registry —
 * including the env-var / feature-code `visible` verdict — and the data is
 * compiled into the daemon binary; this state only mirrors the wire rows.
 *
 * Rows are stored as a `Collection` (id-keyed map + ordered id list in the
 * daemon's registry order — informational per §5.38, consumers must key rows
 * by `id`, never by array position).
 */
import type { Collection } from '$lib/store-shim/utils/collections/collection-utils';
import type { ProviderCatalogEntry } from '$shared/provider-catalog';

export type { ProviderCatalogEntry, ProviderModelTier } from '$shared/provider-catalog';

export interface ProviderCatalogState {
  /** Wire rows, id-keyed with `ids` preserving the registry order. */
  providers: Collection<ProviderCatalogEntry, 'id'>;
  /** The registry's `isDefault` entry (`defaultProviderId` on the wire). */
  defaultProviderId: string;
  /** Flips true once the first `providers.catalog` hydration lands. */
  loaded: boolean;
}

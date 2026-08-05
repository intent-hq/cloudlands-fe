/**
 * Main-process provider catalog accessor.
 *
 * The renderer reads the daemon's static provider registry from the
 * providerCatalog Redux slice; main-process code has no store, so this
 * module fetches `providers.catalog` (PROTOCOL §5.38) through the shared
 * JSON-RPC client and caches it for the process lifetime. The registry is
 * compiled into the daemon binary, so one successful fetch per daemon
 * connection is authoritative — there is no TTL.
 *
 * `primeProviderCatalog()` is fired (not awaited) during app startup right
 * after the sidecar boot begins; the JSON-RPC client queues requests while
 * connecting, so the prime resolves as soon as the daemon answers. Callers
 * that can await use `fetchProviderCatalog()`; synchronous call sites use
 * the `getCached*` getters, which return `undefined` until hydration.
 */
import { Logger } from '../../shared/logger';
import {
  ProviderCatalogResponseSchema,
  PROVIDERS_CATALOG_METHOD,
  type ProviderCatalogEntry,
  type ProviderCatalogResult,
} from '../../shared/provider-catalog';
import { getBackendClient } from '../../features/backend/main/backend.ipc';

const logger = new Logger('ProviderCatalogAccessor');

let cached: ProviderCatalogResult | undefined;
let inFlight: Promise<ProviderCatalogResult> | undefined;

/**
 * Fetch (and cache) the provider catalog. Concurrent callers share one
 * request; a failure clears the in-flight slot so the next caller retries.
 */
export async function fetchProviderCatalog(): Promise<ProviderCatalogResult> {
  if (cached) return cached;
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const raw = await getBackendClient().request(PROVIDERS_CATALOG_METHOD, {});
        const catalog = ProviderCatalogResponseSchema.parse(raw);
        cached = catalog;
        logger.info('Provider catalog hydrated', {
          providers: catalog.providers.length,
        });
        return catalog;
      } finally {
        inFlight = undefined;
      }
    })();
  }
  return inFlight;
}

/** Kick off catalog hydration without blocking startup (failures log only). */
export function primeProviderCatalog(): void {
  void fetchProviderCatalog().catch((error) => {
    logger.warn('Provider catalog prime failed; sync getters stay empty until retry', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/** The cached catalog, or `undefined` before the first successful fetch. */
export function getCachedProviderCatalog(): ProviderCatalogResult | undefined {
  return cached;
}

/** One cached registry row by id, or `undefined` when unknown/not hydrated. */
export function getCachedProviderCatalogEntry(
  providerId: string,
): ProviderCatalogEntry | undefined {
  return cached?.providers.find((p) => p.id === providerId);
}

/** Test-only: reset module state between tests. */
export function resetProviderCatalogCacheForTests(): void {
  cached = undefined;
  inFlight = undefined;
}

/** Test-only: seed the cache without a live daemon connection. */
export function setProviderCatalogCacheForTests(catalog: ProviderCatalogResult): void {
  cached = catalog;
}

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
  type ProviderCatalogResult,
} from '../../shared/provider-catalog';
import type { JsonRpcClient } from '../../features/backend/main/json-rpc-client';
import { getBackendClient, onBackendReconnected } from '../../features/backend/main/backend.ipc';

const logger = new Logger('ProviderCatalogAccessor');

type CatalogSlot = { cached?: ProviderCatalogResult; inFlight?: Promise<ProviderCatalogResult> };
let slots = new WeakMap<JsonRpcClient, Map<string, CatalogSlot>>();
let testCatalog: ProviderCatalogResult | undefined;
if (typeof onBackendReconnected === 'function')
  onBackendReconnected(() => {
    slots = new WeakMap();
  });
function slotFor(client: JsonRpcClient, workspaceId?: string): CatalogSlot {
  let contexts = slots.get(client);
  if (!contexts) {
    contexts = new Map();
    slots.set(client, contexts);
  }
  const key = JSON.stringify(workspaceId ?? null);
  let slot = contexts.get(key);
  if (!slot) {
    slot = {};
    contexts.set(key, slot);
  }
  return slot;
}

/**
 * Fetch (and cache) the provider catalog. Concurrent callers share one
 * request; a failure clears the in-flight slot so the next caller retries.
 */
export async function fetchProviderCatalog(
  workspaceId?: string,
  client: JsonRpcClient = getBackendClient(),
): Promise<ProviderCatalogResult> {
  const slot = slotFor(client, workspaceId);
  if (slot.cached) return slot.cached;
  if (!slot.inFlight) {
    slot.inFlight = (async () => {
      try {
        const raw = await client.request(
          PROVIDERS_CATALOG_METHOD,
          workspaceId ? { workspaceId } : {},
        );
        const catalog = ProviderCatalogResponseSchema.parse(raw);
        slot.cached = catalog;
        logger.info('Provider catalog hydrated', {
          providers: catalog.providers.length,
        });
        return catalog;
      } finally {
        slot.inFlight = undefined;
      }
    })();
  }
  return slot.inFlight;
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
  return testCatalog ?? slotFor(getBackendClient()).cached;
}

/** Test-only: seed the cache without a live daemon connection. */
export function setProviderCatalogCacheForTests(catalog: ProviderCatalogResult): void {
  testCatalog = catalog;
}

/**
 * Provider catalog seeder.
 *
 * Hydrates the providerCatalog slice from the daemon's `providers.catalog`
 * registry (PROTOCOL §5.38) at connect time — registered early in the seeder
 * barrel so the catalog lands before the pickers/settings surfaces first
 * paint — and re-hydrates on backend reconnect (RESUB-1 idiom): the registry
 * is compiled into the daemon binary, so a daemon restart may have changed it.
 *
 * Failures are folded to a no-op (logged): the slice keeps its previous
 * hydration (`loaded` stays false on a failed first fetch) and consumers fall
 * back to the hardcoded `provider-config.ts` table until that file is retired.
 *
 * Boot-latency note: seeders run sequentially, so the awaited initial fetch
 * gates the seeders behind it. This is deliberate — "catalog hydrated before
 * pickers/settings first paint" is the contract — and on a slow/unreachable
 * daemon the workspaces seed would stall on the same transport anyway.
 */
import { createLogger } from "$lib/utils/client-logger";
import { onBackendReconnected } from "$lib/client/live/backend-transport";
import { registerMockSeeder } from "../mock-bootstrap";
import { providerCatalogLoaded } from "../slices/provider-catalog/provider-catalog-slice";

const logger = createLogger("ProviderCatalogSeeder");

/** Disposer for the reconnect listener (guards repeated seedMockStore runs). */
let offReconnect: (() => void) | undefined;

registerMockSeeder("provider-catalog", async ({ store, client }) => {
  const hydrate = async () => {
    try {
      const catalog = await client.providers.catalog();
      store.dispatch(providerCatalogLoaded(catalog));
    } catch (error) {
      logger.warn("providers.catalog hydration failed; keeping previous catalog", { error });
    }
  };

  await hydrate();

  // Re-hydrate after a daemon reconnect: the connection may now be to a
  // different daemon binary with a different compiled-in registry.
  offReconnect?.();
  offReconnect = onBackendReconnected(() => {
    void hydrate();
  });
});

/**
 * Provider catalog seeder tests.
 *
 * Pins the connect-time hydration contract: the seeder pulls
 * `providers.catalog` (PROTOCOL §5.38) through the AppClient seam and
 * dispatches `providerCatalogLoaded` with the wire payload verbatim; a
 * backend reconnect re-fetches (the daemon binary — and its compiled-in
 * registry — may have changed); a failed fetch keeps the previous catalog
 * (no dispatch, no throw out of the seeder).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProviderCatalogResult } from "$shared/provider-catalog";
import type { AppClient } from "$lib/client";

// FAKE transport seam: capture the reconnect handler so tests can fire it.
const reconnectHandlers: Array<() => void> = [];
vi.mock("$lib/client/live/backend-transport", () => ({
  onBackendReconnected: vi.fn((handler: () => void) => {
    reconnectHandlers.push(handler);
    return () => {
      const i = reconnectHandlers.indexOf(handler);
      if (i >= 0) reconnectHandlers.splice(i, 1);
    };
  }),
}));

import { seedMockStore } from "../mock-bootstrap";
import { providerCatalogLoaded } from "../slices/provider-catalog/provider-catalog-slice";

const CATALOG: ProviderCatalogResult = {
  providers: [
    {
      id: "auggie",
      displayName: "Augment Auggie",
      shortName: "Auggie",
      command: "auggie",
      canBeDisabled: true,
      visible: true,
    },
  ],
};

function makeHarness(catalogImpl: () => Promise<ProviderCatalogResult>) {
  const dispatch = vi.fn();
  const store = { dispatch } as never;
  const catalog = vi.fn(catalogImpl);
  const client = { providers: { catalog } } as unknown as AppClient;
  return { store, client, dispatch, catalog };
}

describe("provider-catalog-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockSeeder` side effect. The
    // barrel is intentionally NOT imported, so only this seeder is registered.
    await import("./provider-catalog-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
    reconnectHandlers.length = 0;
  });

  it("hydrates the slice from providers.catalog at seed time", async () => {
    const { store, client, dispatch, catalog } = makeHarness(async () => CATALOG);

    await seedMockStore(store, client);

    expect(catalog).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(providerCatalogLoaded(CATALOG));
  });

  it("re-fetches and re-dispatches on backend reconnect", async () => {
    const { store, client, dispatch, catalog } = makeHarness(async () => CATALOG);

    await seedMockStore(store, client);
    expect(reconnectHandlers.length).toBe(1);

    reconnectHandlers[0]();
    await vi.waitFor(() => expect(catalog).toHaveBeenCalledTimes(2));
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous catalog on a failed fetch (no dispatch, no throw)", async () => {
    const { store, client, dispatch } = makeHarness(async () => {
      throw new Error("uds boom");
    });

    await expect(seedMockStore(store, client)).resolves.toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

/**
 * Live providers domain backed by the intentd daemon (PROTOCOL §5.38).
 *
 * `providers.catalog` is daemon-global (no `workspaceId`, `{}` params) and
 * returns the full static provider registry — every registered row (gated-off
 * included, `visible` carries the daemon-evaluated verdict) in registry
 * order. The data is compiled into the daemon, so the result only changes
 * when the daemon binary does.
 *
 * The response is validated against the §5.38 Zod schema at the wire
 * boundary; a divergent payload THROWS (never silently absorbed — the BE or
 * PROTOCOL.md is the fix-site). Transport failures also THROW so the seeder
 * decides the fallback (keep the last hydrated catalog).
 */
import {
  PROVIDERS_CATALOG_METHOD,
  ProviderCatalogRequestSchema,
  ProviderCatalogResponseSchema,
  type ProviderCatalogResult,
} from "$shared/provider-catalog";
import type { AppClient, ProvidersClient } from "../app-client";
import { backendRequest } from "./backend-transport";

export class LiveProvidersClient implements ProvidersClient {
  async catalog(): Promise<ProviderCatalogResult> {
    // Parsing the empty params is living documentation that §5.38 takes no
    // parameters — the strict schema throws if anything is ever added here.
    const params = ProviderCatalogRequestSchema.parse({});
    const result = await backendRequest<unknown>(PROVIDERS_CATALOG_METHOD, params);
    return ProviderCatalogResponseSchema.parse(result);
  }
}

// Tied to AppClient["providers"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["providers"] | undefined = undefined as
  | LiveProvidersClient
  | undefined;
void _interfaceCheck;

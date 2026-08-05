/**
 * Typed contract for the daemon's `providers.catalog` RPC (PROTOCOL §5.38,
 * v2.6 — the static provider registry served over the wire, monorepo#928).
 *
 * Daemon-global: no params and no `workspaceId`. The daemon owns the registry
 * (including the env-var / feature-code `visible` verdict); the FE only
 * consumes the rows. Zod schemas validate the request/response shapes at the
 * wire boundary so a divergent payload fails loudly instead of being silently
 * absorbed (FE testing policy — see AGENTS.md "Faithfully reproduce BE state").
 */

import { z } from 'zod';

export const PROVIDERS_CATALOG_METHOD = 'providers.catalog';

/** `providers.catalog` request — `{}`, no parameters (§5.38). */
export const ProviderCatalogRequestSchema = z.object({}).strict();

/**
 * One registry row (§5.38). Optional fields are omitted when unset, never
 * null — clients detect by presence. `.passthrough()` preserves unknown
 * fields so future additive bumps (detected by presence per the PROTOCOL
 * compatibility policy) survive validation instead of being silently
 * stripped. No row carries a default designation: the effective default
 * provider is derived from user settings, never from the registry.
 */
export const ProviderCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string(),
    shortName: z.string(),
    command: z.string(),
    canBeDisabled: z.boolean(),
    loginCommandHint: z.string().optional(),
    loginDocsUrl: z.string().optional(),
    authErrorPatterns: z.array(z.string()).optional(),
    requiresEnvVar: z.string().optional(),
    requiresFeatureCode: z.string().optional(),
    visible: z.boolean(),
  })
  .passthrough();

/**
 * `providers.catalog` response: ALL registered providers (gated-off rows
 * included) in registry order — clients must key rows by `id`, never by
 * array position. `.passthrough()` for the same additive-field preservation
 * as the entry schema.
 */
export const ProviderCatalogResponseSchema = z
  .object({
    providers: z.array(ProviderCatalogEntrySchema),
  })
  .passthrough();

export type ProviderCatalogEntry = z.infer<typeof ProviderCatalogEntrySchema>;
export type ProviderCatalogResult = z.infer<typeof ProviderCatalogResponseSchema>;

/**
 * Whether an error message matches a catalog row's `authErrorPatterns`
 * (case-insensitive substring match). Rows without patterns never match.
 */
export function isProviderAuthenticationErrorForEntry(
  entry: Pick<ProviderCatalogEntry, 'authErrorPatterns'> | undefined,
  errorMessage: string,
): boolean {
  const patterns = entry?.authErrorPatterns;
  if (!patterns || patterns.length === 0) return false;
  const errorLower = errorMessage.toLowerCase();
  return patterns.some((pattern) => errorLower.includes(pattern.toLowerCase()));
}

/**
 * Resolve a provider's effective enabled state from the persisted enabled
 * map. Providers that cannot be disabled are always enabled; every other
 * provider defaults to disabled when unset. An explicit true/false entry
 * always wins once the user toggles the provider.
 */
export function resolveProviderEnabled(
  enabledProviders: Record<string, boolean>,
  providerId: string,
  opts: { canBeDisabled?: boolean } = {},
): boolean {
  if (opts.canBeDisabled === false) return true;
  return enabledProviders[providerId] ?? false;
}

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
 * The static `{ fast, balanced, smart }` tier → model-id table (§5.38).
 * Strict on the three documented tiers so a missing/misspelled tier fails
 * loudly; `.passthrough()` keeps future additive keys.
 */
export const ProviderModelTiersSchema = z
  .object({
    fast: z.string(),
    balanced: z.string(),
    smart: z.string(),
  })
  .passthrough();

/**
 * One registry row (§5.38). Optional fields are omitted when unset, never
 * null — clients detect by presence. `modelTiers` is present only for
 * static-tier providers. `.passthrough()` preserves unknown fields so future
 * additive bumps (detected by presence per the PROTOCOL compatibility
 * policy) survive validation instead of being silently stripped.
 */
export const ProviderCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string(),
    shortName: z.string(),
    command: z.string(),
    isDefault: z.boolean(),
    canBeDisabled: z.boolean(),
    loginCommandHint: z.string().optional(),
    loginDocsUrl: z.string().optional(),
    authErrorPatterns: z.array(z.string()).optional(),
    requiresEnvVar: z.string().optional(),
    requiresFeatureCode: z.string().optional(),
    visible: z.boolean(),
    modelTiers: ProviderModelTiersSchema.optional(),
  })
  .passthrough();

/**
 * `providers.catalog` response: ALL registered providers (gated-off rows
 * included) in registry order — clients must key rows by `id`, never by
 * array position — plus the registry's `isDefault` entry. `.passthrough()`
 * for the same additive-field preservation as the entry schema.
 */
export const ProviderCatalogResponseSchema = z
  .object({
    providers: z.array(ProviderCatalogEntrySchema),
    defaultProviderId: z.string(),
  })
  .passthrough();

export type ProviderCatalogEntry = z.infer<typeof ProviderCatalogEntrySchema>;
export type ProviderCatalogResult = z.infer<typeof ProviderCatalogResponseSchema>;
export type ProviderModelTiersTable = z.infer<typeof ProviderModelTiersSchema>;

/** Capability tier keys of the static `modelTiers` table. */
export type ProviderModelTier = 'fast' | 'balanced' | 'smart';

/** The three capability tiers, in fast→smart order (reverse-lookup order). */
export const PROVIDER_MODEL_TIER_KEYS: readonly ProviderModelTier[] = [
  'fast',
  'balanced',
  'smart',
];

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
 * map. Providers that cannot be disabled are always enabled. The default
 * provider is enabled when it has no persisted entry (fresh state); every
 * other provider defaults to disabled when unset. An explicit true/false
 * entry always wins once the user toggles the provider.
 */
export function resolveProviderEnabled(
  enabledProviders: Record<string, boolean>,
  providerId: string,
  opts: { defaultProviderId: string; canBeDisabled?: boolean },
): boolean {
  if (opts.canBeDisabled === false) return true;
  return enabledProviders[providerId] ?? providerId === opts.defaultProviderId;
}

/**
 * Reverse-map a concrete model id to its capability tier across the catalog
 * rows' static `modelTiers` tables. The preferred provider's table is checked
 * first; otherwise the first match in registry order wins. `undefined` when
 * no static tier table contains the model.
 */
export function getModelTierFromCatalog(
  entries: readonly Pick<ProviderCatalogEntry, 'id' | 'modelTiers'>[],
  modelId: string,
  preferredProviderId?: string,
): ProviderModelTier | undefined {
  const findIn = (tiers: ProviderModelTiersTable | undefined): ProviderModelTier | undefined =>
    tiers ? PROVIDER_MODEL_TIER_KEYS.find((tier) => tiers[tier] === modelId) : undefined;

  if (preferredProviderId) {
    const preferred = entries.find((entry) => entry.id === preferredProviderId);
    const tier = findIn(preferred?.modelTiers);
    if (tier) return tier;
  }
  for (const entry of entries) {
    const tier = findIn(entry.modelTiers);
    if (tier) return tier;
  }
  return undefined;
}

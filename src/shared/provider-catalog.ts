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
